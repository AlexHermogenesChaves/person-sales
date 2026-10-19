import express, { type NextFunction, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { codeDaUdt, identityHash } from "./dominio/chaves.js";
import { enderecosDto, lerConsultaCatalogo, montarCatalogo, resolverVinculo as resolverVinculoNoSap } from "./dominio/catalogo.js";
import { consultarEnvio, enviarPedido, type ConfigEnvio } from "./dominio/envio.js";
import { ErroApi, erro } from "./dominio/erros.js";
import { emitirRevisao, type Contexto } from "./dominio/revisao.js";
import { dataInicial, historicoDePrecos, paraDto, resumir } from "./dominio/historico.js";
import { hojeComercial, objetoComChaves } from "./dominio/validacao.js";
import { Limitador } from "./http/limites.js";
import { Sessoes, type Sessao } from "./http/sessoes.js";
import { PESSOAS, SapSimulado, type Falhas } from "./sap/simulado.js";
import { SapIndeterminado, SapIndisponivel, SapRecusa, type SapGateway } from "./sap/tipos.js";

export type ConfigApp = ConfigEnvio & {
  empresa: string;
  /** Origem pública do portal. Mutação com Origin diferente é recusada. */
  origem: string;
  cookieSeguro: boolean;
  producao: boolean;
};

const CODIGO_MFA_DEMO = "123456";

type Req = Request & { correlationId: string; sessao?: Sessao; ctx?: Contexto & { clienteNome: string } };

export function criarApp(sap: SapGateway, config: ConfigApp) {
  const app = express();
  const sessoes = new Sessoes({ inatividadeMs: 15 * 60_000, absolutaMs: 8 * 3_600_000, maximo: 2_000 });
  const leitura = new Limitador(120, 60_000);
  const envios = new Limitador(10, 10 * 60_000);
  const nomeCookie = config.cookieSeguro ? "__Host-portal-session" : "portal-session";
  const simulado = sap instanceof SapSimulado ? sap : null;

  app.disable("x-powered-by");
  app.set("trust proxy", false); // IP só de proxy conhecido; aqui não há nenhum.

  app.use((req, res, next) => {
    (req as Req).correlationId = `c-${randomBytes(4).toString("hex")}`;
    res.setHeader("X-Correlation-Id", (req as Req).correlationId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (config.producao) {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://static.wixstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }
    if (req.path.startsWith("/api") || req.path.startsWith("/auth") || req.path.startsWith("/demo")) {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });

  app.use(["/api", "/auth", "/demo"], express.json({ limit: "256kb", strict: true, type: () => true }));

  // ---- Sessão, CSRF e contexto --------------------------------------------------

  const lerSessao = (req: Request) => sessoes.obter(lerCookie(req, nomeCookie));

  const gravarCookie = (res: Response, sessao: Sessao) =>
    res.cookie(nomeCookie, sessao.id, {
      httpOnly: true,
      secure: config.cookieSeguro,
      sameSite: "lax",
      path: "/",
    });

  /** Mutação: Origin igual à do portal, JSON e (com sessão) token CSRF. */
  const exigirMutacaoSegura = (comCsrf: boolean) => (req: Request, _res: Response, next: NextFunction) => {
    if (req.get("origin") !== config.origem) return next(erro.csrf());
    if (!req.is("application/json")) return next(new ErroApi(415, "UNSUPPORTED_MEDIA_TYPE", "Envie application/json."));
    if (comCsrf) {
      const sessao = lerSessao(req);
      if (!sessao || req.get("x-csrf-token") !== sessao.csrf) return next(erro.csrf());
    }
    next();
  };

  const resolverVinculo = (sessao: Sessao) => resolverVinculoNoSap(sap, config.empresa, sessao.identityHash, codeDaUdt(sessao.identityHash));

  const contextoComercial = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const sessao = lerSessao(req);
      if (!sessao || sessao.mfaPendente) throw erro.semSessao();
      const espera = leitura.consumir(sessao.identityHash);
      if (espera) throw erro.limite(espera);
      (req as Req).sessao = sessao;
      (req as Req).ctx = await resolverVinculo(sessao);
      next();
    } catch (e) {
      next(e);
    }
  };

  const auditar = (req: Request, operacao: string, resultado: string | number) => {
    const r = req as Req;
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        correlationId: r.correlationId,
        ator: r.sessao?.identityHash.slice(0, 12),
        cliente: r.ctx?.cardCode,
        operacao,
        resultado,
      }),
    );
  };

  // ---- Login (simulação do provedor OIDC + MFA) -------------------------------------
  //
  // Na implantação: GET /auth/login → provedor existente (Authorization Code + PKCE),
  // GET /auth/callback valida issuer, audience, assinatura, state e nonce. Aqui o
  // provedor é substituído por uma lista de identidades de teste e um código fixo.

  app.get("/auth/demo/pessoas", (_req, res) => {
    res.json({
      pessoas: Object.entries(PESSOAS).map(([chave, p]) => ({ chave, nome: p.nome, email: p.email, descricao: p.descricao })),
      codigoMfa: CODIGO_MFA_DEMO,
    });
  });

  app.post("/auth/demo/login", exigirMutacaoSegura(false), (req, res, next) => {
    try {
      const { pessoa } = objetoComChaves(req.body, ["pessoa"]);
      const p = typeof pessoa === "string" ? PESSOAS[pessoa] : undefined;
      if (!p) throw erro.schema([{ campo: "pessoa", mensagem: "Identidade de teste desconhecida." }]);
      sessoes.encerrar(lerCookie(req, nomeCookie));
      const sessao = sessoes.criar({ identityHash: identityHash(p.issuer, p.sub), nome: p.nome, email: p.email, mfaPendente: true });
      gravarCookie(res, sessao);
      res.json({ mfaRequired: true });
    } catch (e) {
      next(e);
    }
  });

  app.post("/auth/demo/mfa", exigirMutacaoSegura(false), (req, res, next) => {
    try {
      const { codigo } = objetoComChaves(req.body, ["codigo"]);
      const sessao = lerSessao(req);
      if (!sessao || !sessao.mfaPendente) throw erro.semSessao();
      if (codigo !== CODIGO_MFA_DEMO) throw new ErroApi(401, "MFA_INVALID", "Código de verificação incorreto.");
      const nova = sessoes.rotacionar({ ...sessao, mfaPendente: false });
      gravarCookie(res, nova);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.post("/auth/logout", exigirMutacaoSegura(true), (req, res) => {
    sessoes.encerrar(lerCookie(req, nomeCookie));
    res.clearCookie(nomeCookie, { path: "/", httpOnly: true, secure: config.cookieSeguro, sameSite: "lax" });
    res.status(204).end();
  });

  // ---- API do portal -------------------------------------------------------------------

  app.get("/api/v1/me", async (req, res, next) => {
    const sessao = lerSessao(req);
    try {
      if (!sessao || sessao.mfaPendente) throw erro.semSessao();
      const ctx = await resolverVinculo(sessao);
      res.json({
        user: { name: sessao.nome, email: sessao.email },
        customer: { code: ctx.cardCode, name: ctx.clienteNome },
        permissions: ["catalog:read", "orders:create"],
        csrfToken: sessao.csrf,
        sapMode: sap.modo,
      });
    } catch (e) {
      // Sem vínculo a tela precisa mostrar quem entrou e permitir sair.
      if (e instanceof ErroApi && e.status === 403 && sessao) {
        return next(new ErroApi(e.status, e.code, e.message, [], { user: { name: sessao.nome, email: sessao.email }, csrfToken: sessao.csrf }));
      }
      next(e);
    }
  });

  app.get("/api/v1/catalog", contextoComercial, async (req, res, next) => {
    try {
      const ctx = (req as Req).ctx!;
      res.json(await montarCatalogo(sap, ctx, lerConsultaCatalogo(req.query as Record<string, unknown>)));
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/v1/addresses", contextoComercial, async (req, res, next) => {
    try {
      const enderecos = await sap.listarEnderecos((req as Req).ctx!.cardCode);
      res.json(enderecosDto(enderecos));
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/v1/reviews", exigirMutacaoSegura(true), contextoComercial, async (req, res, next) => {
    try {
      const revisao = await emitirRevisao(sap, (req as Req).ctx!, req.body, config);
      auditar(req, "revisao", 200);
      res.json(revisao);
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/v1/orders", exigirMutacaoSegura(true), contextoComercial, async (req, res, next) => {
    try {
      const ctx = (req as Req).ctx!;
      const espera = envios.consumir(`${ctx.empresa}:${ctx.cardCode}`);
      if (espera) throw erro.limite(espera);
      const r = await enviarPedido(sap, ctx, req.get("idempotency-key"), req.body, config, (req as Req).correlationId);
      auditar(req, "envio", `${r.http} ${r.corpo.status}`);
      res.status(r.http).json(r.corpo);
    } catch (e) {
      auditar(req, "envio", e instanceof ErroApi ? `${e.status} ${e.code}` : 500);
      next(e);
    }
  });

  // Página inicial: pedidos do cliente no SAP (qualquer origem) e indicadores.
  const lerPedidosDoCliente = async (req: Request) => {
    if (Object.keys(req.query).length) throw erro.schema([{ campo: "query", mensagem: "Esta rota não aceita parâmetros." }]);
    const hoje = hojeComercial(config.agora());
    return { hoje, pedidos: await sap.listarPedidosCliente((req as Req).ctx!.cardCode, dataInicial(hoje)) };
  };

  app.get("/api/v1/orders", contextoComercial, async (req, res, next) => {
    try {
      const { pedidos, hoje } = await lerPedidosDoCliente(req);
      res.json({ from: dataInicial(hoje), orders: pedidos.slice(0, 300).map(paraDto) });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/v1/summary", contextoComercial, async (req, res, next) => {
    try {
      const { pedidos, hoje } = await lerPedidosDoCliente(req);
      const pendentes = await sap.listarEnviosPendentes((req as Req).ctx!.cardCode);
      res.json(resumir(pedidos, pendentes, hoje));
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/v1/items/history", contextoComercial, async (req, res, next) => {
    try {
      const { pedidos, hoje } = await lerPedidosDoCliente(req);
      res.json({ from: dataInicial(hoje), items: historicoDePrecos(pedidos) });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/v1/submissions/:operationId", contextoComercial, async (req, res, next) => {
    try {
      const r = await consultarEnvio(sap, (req as Req).ctx!, req.params.operationId, config, (req as Req).correlationId);
      res.status(r.http).json(r.corpo);
    } catch (e) {
      next(e);
    }
  });

  // ---- Bastidores (só com SAP simulado) ------------------------------------------------

  if (simulado) {
    const demo = express.Router();
    demo.get("/estado", (_req, res) => res.json(simulado.estado()));
    demo.post("/falha", exigirMutacaoSegura(false), (req, res, next) => {
      try {
        const { chave, valor } = objetoComChaves(req.body, ["chave", "valor"]);
        if (typeof chave !== "string" || !(chave in simulado.falhas) || typeof valor !== "boolean") throw erro.schema();
        simulado.definirFalha(chave as keyof Falhas, valor);
        res.json(simulado.estado());
      } catch (e) {
        next(e);
      }
    });
    demo.post("/aprovar", exigirMutacaoSegura(false), (req, res, next) => {
      try {
        const { docEntry } = objetoComChaves(req.body, ["docEntry"]);
        if (typeof docEntry !== "number" || !simulado.aprovarRascunho(docEntry)) throw erro.naoEncontrado();
        res.json(simulado.estado());
      } catch (e) {
        next(e);
      }
    });
    demo.post("/reajuste", exigirMutacaoSegura(false), (req, res, next) => {
      try {
        const { itemCode, percentual } = objetoComChaves(req.body, ["itemCode", "percentual"]);
        if (typeof itemCode !== "string" || typeof percentual !== "number" || !simulado.reajustarPreco(itemCode, percentual)) throw erro.schema();
        res.json(simulado.estado());
      } catch (e) {
        next(e);
      }
    });
    demo.post("/vinculo", exigirMutacaoSegura(false), (req, res, next) => {
      try {
        const { code } = objetoComChaves(req.body, ["code"]);
        if (typeof code !== "string" || simulado.alternarVinculo(code) === null) throw erro.naoEncontrado();
        res.json(simulado.estado());
      } catch (e) {
        next(e);
      }
    });
    demo.post("/reiniciar", exigirMutacaoSegura(false), (_req, res) => {
      simulado.reiniciar();
      res.json(simulado.estado());
    });
    app.use("/demo", demo);
  }

  // Todo caminho de API tem saída própria: rota inexistente não cai no index.html.
  app.all(["/api/*", "/auth/*", "/demo/*"], (_req, _res, next) => next(new ErroApi(404, "NOT_FOUND", "Rota inexistente.")));

  app.use((e: unknown, req: Request, res: Response, _next: NextFunction) => {
    const correlationId = (req as Req).correlationId;
    let falha: ErroApi;
    if (e instanceof ErroApi) falha = e;
    else if (e instanceof SapIndisponivel || e instanceof SapIndeterminado) falha = erro.sapFora();
    else if (e instanceof SapRecusa) falha = new ErroApi(422, "SAP_REJECTED", e.message);
    else if (isTipo(e, "entity.too.large")) falha = new ErroApi(413, "PAYLOAD_TOO_LARGE", "Requisição grande demais.");
    else if (isTipo(e, "entity.parse.failed")) falha = erro.schema([{ campo: "corpo", mensagem: "JSON inválido." }]);
    else {
      console.error(JSON.stringify({ evento: "erro_interno", correlationId, erro: (e as Error)?.stack ?? String(e) }));
      falha = new ErroApi(500, "INTERNAL_ERROR", "Erro inesperado. Informe o protocolo de atendimento.");
    }
    if (falha.status === 429 && typeof falha.extra.retryAfter === "number") res.setHeader("Retry-After", String(falha.extra.retryAfter));
    res.status(falha.status).json({
      code: falha.code,
      message: falha.message,
      correlationId,
      fieldErrors: falha.fieldErrors,
      ...falha.extra,
    });
  });

  return app;
}

function lerCookie(req: Request, nome: string): string | undefined {
  const cabecalho = req.headers.cookie;
  if (!cabecalho) return undefined;
  for (const parte of cabecalho.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nome) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

const isTipo = (e: unknown, tipo: string) => typeof e === "object" && e !== null && (e as { type?: string }).type === tipo;
