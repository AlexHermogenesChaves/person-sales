import express from "express";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { criarApp } from "./app.js";
import { EMPRESA_DEMO, SapSimulado } from "./sap/simulado.js";
import { ServiceLayer } from "./sap/serviceLayer.js";
import type { SapGateway } from "./sap/tipos.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const producao = process.env.NODE_ENV === "production";
const porta = Number(process.env.PORT ?? 5190);
const origem = process.env.PORTAL_ORIGEM ?? `http://localhost:${porta}`;

function criarSap(): SapGateway {
  if (process.env.SAP_MODE === "service-layer") {
    const obrigatorias = ["SL_URL", "SL_COMPANY", "SL_USER", "SL_PASSWORD"] as const;
    const faltando = obrigatorias.filter((k) => !process.env[k]);
    if (faltando.length) throw new Error(`SAP_MODE=service-layer exige ${faltando.join(", ")}`);
    return new ServiceLayer({
      url: process.env.SL_URL!,
      empresa: process.env.SL_COMPANY!,
      usuario: process.env.SL_USER!,
      senha: process.env.SL_PASSWORD!,
      serie: process.env.SL_SERIE ? Number(process.env.SL_SERIE) : undefined,
      filial: process.env.SL_FILIAL ? Number(process.env.SL_FILIAL) : undefined,
      deposito: process.env.SL_DEPOSITO,
      utilizacao: process.env.SL_UTILIZACAO ? Number(process.env.SL_UTILIZACAO) : undefined,
    });
  }
  return new SapSimulado({ latenciaMs: Number(process.env.SAP_LATENCIA_MS ?? 350) });
}

const sap = criarSap();
const api = criarApp(sap, {
  empresa: process.env.SL_COMPANY ?? EMPRESA_DEMO,
  origem,
  cookieSeguro: origem.startsWith("https://"),
  producao,
  // Sem segredo configurado, cada partida gera um: revisões antigas deixam de valer.
  segredoRevisao: process.env.SEGREDO_REVISAO ?? randomBytes(32).toString("base64url"),
  validadeMs: 5 * 60_000,
  processandoIncertoAposMs: 2 * 60_000,
  agora: () => new Date(),
});

const servidor = express();
servidor.use(api);

if (producao) {
  const dist = path.join(raiz, "dist");
  if (!existsSync(dist)) throw new Error("Rode `npm run build` antes de `npm start`.");
  // index.html sai só pela rota abaixo; o static serve apenas os assets com hash.
  servidor.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "1y", index: false }));
  servidor.get("/tema.js", (_req, res) => res.sendFile(path.join(dist, "tema.js")));
  servidor.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ root: path.join(raiz, "web"), configFile: path.join(raiz, "vite.config.ts"), server: { middlewareMode: true }, appType: "spa" });
  servidor.use(vite.middlewares);
}

servidor.listen(porta, () => {
  console.info(`Portal de pedidos (POC) em ${origem} — SAP ${sap.modo}${producao ? "" : " · modo desenvolvimento"}`);
});
