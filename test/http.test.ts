import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { criarApp } from "../server/app.js";
import { codeDaUdt, identityHash } from "../server/dominio/chaves.js";
import { EMPRESA_DEMO, PESSOAS, SapSimulado } from "../server/sap/simulado.js";

let base = "";
let fechar: () => void;
const sap = new SapSimulado({ latenciaMs: 0 });

before(async () => {
  const app = criarApp(sap, {
    empresa: EMPRESA_DEMO,
    origem: "http://portal.teste",
    cookieSeguro: false,
    producao: false,
    segredoRevisao: "s",
    validadeMs: 300_000,
    processandoIncertoAposMs: 120_000,
    agora: () => new Date(),
  });
  const servidor = app.listen(0);
  await new Promise((r) => servidor.once("listening", r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  fechar = () => servidor.close();
});
after(() => fechar());

const ORIGEM = { Origin: "http://portal.teste", "Content-Type": "application/json" };

async function entrar(pessoa: string) {
  const login = await fetch(`${base}/auth/demo/login`, { method: "POST", headers: ORIGEM, body: JSON.stringify({ pessoa }) });
  const cookieLogin = login.headers.getSetCookie()[0].split(";")[0];
  const mfa = await fetch(`${base}/auth/demo/mfa`, { method: "POST", headers: { ...ORIGEM, Cookie: cookieLogin }, body: JSON.stringify({ codigo: "123456" }) });
  const setCookie = mfa.headers.getSetCookie()[0];
  const cookie = setCookie.split(";")[0];
  assert.notEqual(cookie, cookieLogin, "sessão rotaciona após o segundo fator");
  const me = await fetch(`${base}/api/v1/me`, { headers: { Cookie: cookie } });
  const corpo = await me.json();
  return { cookie, setCookie, status: me.status, corpo, csrf: corpo.csrfToken as string };
}

describe("HTTP", () => {
  test("T01: sem sessão é 401 JSON, e rota de API inexistente é 404 JSON", async () => {
    const r = await fetch(`${base}/api/v1/catalog`);
    assert.equal(r.status, 401);
    assert.equal((await r.json()).code, "SESSION_REQUIRED");
    const inexistente = await fetch(`${base}/api/v1/nao-existe`);
    assert.equal(inexistente.status, 404);
    assert.match(inexistente.headers.get("content-type") ?? "", /json/);
  });

  test("T02: MFA errado não abre sessão", async () => {
    const login = await fetch(`${base}/auth/demo/login`, { method: "POST", headers: ORIGEM, body: JSON.stringify({ pessoa: "ana" }) });
    const cookie = login.headers.getSetCookie()[0].split(";")[0];
    const mfa = await fetch(`${base}/auth/demo/mfa`, { method: "POST", headers: { ...ORIGEM, Cookie: cookie }, body: JSON.stringify({ codigo: "000000" }) });
    assert.equal(mfa.status, 401);
    assert.equal((await fetch(`${base}/api/v1/me`, { headers: { Cookie: cookie } })).status, 401);
  });

  test("T03: sem vínculo e vínculo desativado são 403", async () => {
    assert.equal((await entrar("visitante")).corpo.code, "ACCESS_NOT_LINKED");
    assert.equal((await entrar("marcos")).corpo.code, "ACCESS_BLOCKED");
  });

  test("cookie de sessão é HttpOnly e SameSite=Lax; resposta privada sem cache", async () => {
    const s = await entrar("ana");
    assert.equal(s.status, 200);
    assert.match(s.setCookie, /HttpOnly/i);
    assert.match(s.setCookie, /SameSite=Lax/i);
    const r = await fetch(`${base}/api/v1/catalog`, { headers: { Cookie: s.cookie } });
    assert.equal(r.headers.get("cache-control"), "no-store");
  });

  test("T07: mutação sem CSRF ou com origem estranha é recusada", async () => {
    const s = await entrar("ana");
    const corpo = JSON.stringify({ items: [], shipToCode: "MATRIZ", requestedDate: "2030-01-01" });
    const semCsrf = await fetch(`${base}/api/v1/reviews`, { method: "POST", headers: { ...ORIGEM, Cookie: s.cookie }, body: corpo });
    assert.equal(semCsrf.status, 403);
    const outraOrigem = await fetch(`${base}/api/v1/reviews`, {
      method: "POST",
      headers: { ...ORIGEM, Origin: "https://ataque.example", Cookie: s.cookie, "X-CSRF-Token": s.csrf },
      body: corpo,
    });
    assert.equal(outraOrigem.status, 403);
  });

  test("T04: vínculo desativado no SAP com sessão aberta bloqueia a próxima operação", async () => {
    const s = await entrar("carlos");
    assert.equal((await fetch(`${base}/api/v1/addresses`, { headers: { Cookie: s.cookie } })).status, 200);
    const p = PESSOAS.carlos;
    sap.alternarVinculo(codeDaUdt(identityHash(p.issuer, p.sub)));
    const r = await fetch(`${base}/api/v1/addresses`, { headers: { Cookie: s.cookie } });
    assert.equal(r.status, 403);
    sap.alternarVinculo(codeDaUdt(identityHash(p.issuer, p.sub)));
  });

  test("T08: logout invalida a sessão", async () => {
    const s = await entrar("ana");
    const sair = await fetch(`${base}/auth/logout`, { method: "POST", headers: { ...ORIGEM, Cookie: s.cookie, "X-CSRF-Token": s.csrf }, body: "{}" });
    assert.equal(sair.status, 204);
    assert.equal((await fetch(`${base}/api/v1/me`, { headers: { Cookie: s.cookie } })).status, 401);
  });

  test("T29: catálogo recusa parâmetro OData livre e busca grande demais", async () => {
    const s = await entrar("ana");
    assert.equal((await fetch(`${base}/api/v1/catalog?$filter=1 eq 1`, { headers: { Cookie: s.cookie } })).status, 400);
    assert.equal((await fetch(`${base}/api/v1/catalog?search=${"x".repeat(61)}`, { headers: { Cookie: s.cookie } })).status, 400);
    const ok = await fetch(`${base}/api/v1/catalog?search=farinha%27%20or%201%3D1`, { headers: { Cookie: s.cookie } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).items.length, 0);
  });

  test("T10: catálogo devolve o preço do cliente autenticado", async () => {
    const preco = async (pessoa: string) => {
      const s = await entrar(pessoa);
      const r = await (await fetch(`${base}/api/v1/catalog?search=PA0001`, { headers: { Cookie: s.cookie } })).json();
      return r.items[0].units[0].referenceUnitPrice;
    };
    assert.equal(await preco("ana"), "112.80");
    assert.equal(await preco("juliana"), "125.93");
  });

  test("página inicial: pedidos e indicadores só do cliente autenticado", async () => {
    const ana = await entrar("ana");
    const juliana = await entrar("juliana");
    const pedidosAna = (await (await fetch(`${base}/api/v1/orders`, { headers: { Cookie: ana.cookie } })).json()).orders;
    const pedidosJu = (await (await fetch(`${base}/api/v1/orders`, { headers: { Cookie: juliana.cookie } })).json()).orders;
    assert.ok(pedidosAna.length > 20, "seis meses de histórico");
    const numerosAna = new Set(pedidosAna.map((p: { docNum: number }) => p.docNum));
    assert.ok(pedidosJu.every((p: { docNum: number }) => !numerosAna.has(p.docNum)), "nenhum pedido de outro cliente");
    assert.ok(pedidosJu.some((p: { status: string }) => p.status === "AGUARDANDO_APROVACAO"));
    const resumo = await (await fetch(`${base}/api/v1/summary`, { headers: { Cookie: ana.cookie } })).json();
    assert.equal(resumo.monthly.length, 6);
    assert.ok(resumo.open.orders >= 1);
    assert.equal(resumo.topItems[0].itemCode, "PA0001");
    assert.equal((await fetch(`${base}/api/v1/orders?cardCode=C00487`, { headers: { Cookie: ana.cookie } })).status, 400);
  });

  test("situação por faturamento: falta chegar = total − faturado, sem 'entregue'", async () => {
    const ana = await entrar("ana");
    const pedidos = (await (await fetch(`${base}/api/v1/orders`, { headers: { Cookie: ana.cookie } })).json()).orders;
    const situacoes = new Set(pedidos.map((p: { status: string }) => p.status));
    assert.ok(!situacoes.has("ENTREGUE") && !situacoes.has("ABERTO"));
    for (const p of pedidos) {
      if (p.status === "CANCELADO") continue;
      assert.equal(Number(p.pending).toFixed(2), (Number(p.total) - Number(p.invoiced)).toFixed(2), `pedido ${p.docNum}`);
      if (p.status === "FATURADO") assert.equal(p.pending, "0.00");
      if (p.status === "APROVADO") assert.equal(p.invoiced, "0.00");
    }
    assert.ok(pedidos.some((p: { status: string }) => p.status === "PARCIAL"));
  });

  test("precisa da sua atenção traz o envio incerto do cliente e só dele", async () => {
    const ana = await entrar("ana");
    const juliana = await entrar("juliana");
    const resumoAna = await (await fetch(`${base}/api/v1/summary`, { headers: { Cookie: ana.cookie } })).json();
    const resumoJu = await (await fetch(`${base}/api/v1/summary`, { headers: { Cookie: juliana.cookie } })).json();
    assert.ok(resumoAna.attention.uncertainSubmissions.some((e: { operationId: string }) => e.operationId.startsWith("a90d4e2b")));
    assert.equal(resumoJu.attention.uncertainSubmissions.length, 0);
    assert.equal(resumoJu.attention.awaitingApproval.orders, 1);
  });

  test("histórico de preço por item: média ponderada dentro de menor–maior, pontos em ordem", async () => {
    const ana = await entrar("ana");
    const { items } = await (await fetch(`${base}/api/v1/items/history`, { headers: { Cookie: ana.cookie } })).json();
    assert.ok(items.length >= 5);
    for (const i of items) {
      assert.ok(Number(i.minPrice) <= Number(i.averagePrice) + 0.01 && Number(i.averagePrice) <= Number(i.maxPrice) + 0.01, i.itemCode);
      const datas = i.points.map((p: { date: string }) => p.date);
      assert.deepEqual(datas, [...datas].sort());
      assert.equal(i.lastPrice, i.points.at(-1).price);
    }
    const farinha = items.find((i: { itemCode: string }) => i.itemCode === "PA0001");
    assert.ok(Number(farinha.maxPrice) > Number(farinha.minPrice), "reajuste ao longo dos meses aparece no histórico");
  });

  test("T30: payload acima de 256 KB é 413", async () => {
    const s = await entrar("ana");
    const r = await fetch(`${base}/api/v1/reviews`, {
      method: "POST",
      headers: { ...ORIGEM, Cookie: s.cookie, "X-CSRF-Token": s.csrf },
      body: JSON.stringify({ comments: "x".repeat(300_000) }),
    });
    assert.equal(r.status, 413);
  });
});
