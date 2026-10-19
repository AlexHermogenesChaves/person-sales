import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { identityHash } from "../server/dominio/chaves.js";
import { consultarEnvio, enviarPedido, type ConfigEnvio } from "../server/dominio/envio.js";
import { ErroApi } from "../server/dominio/erros.js";
import { emitirRevisao, type Contexto } from "../server/dominio/revisao.js";
import { hojeComercial, somarDias } from "../server/dominio/validacao.js";
import { EMPRESA_DEMO, PESSOAS, SapSimulado } from "../server/sap/simulado.js";

let sap: SapSimulado;
let relogio = Date.parse("2026-10-19T13:00:00Z");
const config: ConfigEnvio = {
  segredoRevisao: "segredo-de-teste",
  validadeMs: 5 * 60_000,
  processandoIncertoAposMs: 2 * 60_000,
  agora: () => new Date(relogio),
};

const ctx = (pessoa: keyof typeof PESSOAS, cardCode: string): Contexto => ({
  empresa: EMPRESA_DEMO,
  identityHash: identityHash(PESSOAS[pessoa].issuer, PESSOAS[pessoa].sub),
  cardCode,
});
const ANA = ctx("ana", "C00012");
const CARLOS = ctx("carlos", "C00012");
const JULIANA = ctx("juliana", "C00487");

const amanha = () => somarDias(hojeComercial(new Date(relogio)), 2);
const carrinho = (itens: [string, string, number][], shipToCode = "MATRIZ") => ({
  items: itens.map(([itemCode, quantity, uomEntry]) => ({ itemCode, quantity, uomEntry })),
  shipToCode,
  requestedDate: amanha(),
  customerReference: "OC 4471",
  comments: "Entregar pela doca lateral",
});
const PEQUENO_ = () => carrinho([["PA0001", "4", 2], ["PA0023", "2", 1]]);
const GRANDE_ = () => carrinho([["PA0018", "8", 2]]); // 8 caixas × 689,00 = 5.512,00: cai em aprovação

async function revisar(c: Contexto, corpo: unknown) {
  return emitirRevisao(sap, c, corpo, config);
}
async function enviar(c: Contexto, rev: { operationId: string; reviewToken: string }, chave = rev.operationId) {
  return enviarPedido(sap, c, chave, { operationId: rev.operationId, reviewToken: rev.reviewToken }, config, "c-teste");
}
async function falhaDe(p: Promise<unknown>): Promise<ErroApi> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroApi) return e;
    throw e;
  }
  assert.fail("esperava ErroApi");
}
const pedidosDe = (operationId: string) => sap.estado().documentos.filter((d) => d.portalId === operationId);

beforeEach(() => {
  sap = new SapSimulado({ latenciaMs: 0, semHistorico: true });
  relogio = Date.parse("2026-10-19T13:00:00Z");
});

describe("revisão", () => {
  test("preço especial e faixa por quantidade vêm do SAP; lista 2 para o outro cliente", async () => {
    const a1 = await revisar(ANA, carrinho([["PA0001", "1", 2]]));
    const a10 = await revisar(ANA, carrinho([["PA0001", "10", 2]]));
    const b1 = await revisar(JULIANA, carrinho([["PA0001", "1", 2]], "LOJA 01"));
    assert.equal(a1.lines[0].unitPrice, "112.80");
    assert.equal(a1.lines[0].priceOrigin, "ESPECIAL");
    assert.equal(a10.lines[0].unitPrice, "108.00");
    assert.equal(a10.lines[0].priceOrigin, "QUANTIDADE");
    assert.equal(b1.lines[0].unitPrice, "125.93");
  });

  test("impostos, frete abaixo do mínimo e total calculados em decimal exato", async () => {
    const r = await revisar(ANA, carrinho([["PA0023", "3", 1]])); // 3 × 96,40 = 289,20; 12% = 34,70
    assert.equal(r.subtotal, "289.20");
    assert.equal(r.tax, "34.70");
    assert.equal(r.expenses, "45.00");
    assert.equal(r.total, "368.90");
    assert.equal(r.totalsAreFinal, true);
  });

  test("campo de preço no payload é recusado pelo schema", async () => {
    const corpo = { ...PEQUENO_(), items: [{ itemCode: "PA0001", quantity: "1", uomEntry: 2, unitPrice: "0.01" }] };
    assert.equal((await falhaDe(revisar(ANA, corpo))).status, 400);
    assert.equal((await falhaDe(revisar(ANA, { ...PEQUENO_(), cardCode: "C00487" }))).status, 400);
  });

  test("item não publicado, inativo, múltiplo errado e endereço alheio são recusados", async () => {
    assert.equal((await falhaDe(revisar(ANA, carrinho([["PA0042", "1", 3]])))).code, "ORDER_RULES");
    assert.equal((await falhaDe(revisar(ANA, carrinho([["PA0041", "1", 3]])))).code, "ORDER_RULES");
    const multiplo = await falhaDe(revisar(ANA, carrinho([["PA0013", "4", 1]])));
    assert.match(multiplo.fieldErrors[0].mensagem, /múltiplos de 6/);
    assert.equal((await falhaDe(revisar(ANA, carrinho([["PA0001", "1", 2]], "LOJA 01")))).code, "ORDER_RULES");
  });

  test("quantidade com expoente, negativa ou com 4 casas não passa", async () => {
    for (const q of ["1e3", "-1", "1.2345", "0", "NaN", ""]) {
      assert.equal((await falhaDe(revisar(ANA, carrinho([["PA0001", q, 2]])))).status, 400, q);
    }
  });
});

describe("envio", () => {
  test("caminho feliz: 201 com pedido; replay devolve o mesmo documento sem criar outro", async () => {
    const rev = await revisar(ANA, PEQUENO_());
    const r1 = await enviar(ANA, rev);
    assert.equal(r1.http, 201);
    assert.equal(r1.corpo.status, "INTEGRADO");
    const r2 = await enviar(ANA, rev);
    assert.equal(r2.http, 200);
    assert.equal(r2.corpo.document?.docEntry, r1.corpo.document?.docEntry);
    assert.equal(pedidosDe(rev.operationId).length, 1);
  });

  test("T18: duas chamadas simultâneas com o mesmo ID criam um pedido só", async () => {
    sap.latenciaMs = 5;
    const rev = await revisar(ANA, PEQUENO_());
    const respostas = await Promise.all([enviar(ANA, rev), enviar(ANA, rev), enviar(ANA, rev)]);
    assert.equal(respostas.filter((r) => r.http === 201).length, 1);
    assert.equal(pedidosDe(rev.operationId).length, 1);
  });

  test("T15: token adulterado, de outro usuário ou com outra chave não inicia operação", async () => {
    const rev = await revisar(ANA, PEQUENO_());
    const [corpo, assinatura] = rev.reviewToken.split(".");
    const adulterado = `${corpo.slice(0, -2)}AA.${assinatura}`;
    assert.equal((await falhaDe(enviar(ANA, { ...rev, reviewToken: adulterado }))).code, "REVIEW_INVALID");
    assert.equal((await falhaDe(enviar(CARLOS, rev))).code, "REVIEW_NOT_YOURS");
    assert.equal((await falhaDe(enviar(ANA, rev, "11111111-1111-4111-8111-111111111111"))).code, "IDEMPOTENCY_KEY_MISMATCH");
    assert.equal(sap.estado().reservas.length, 0);
  });

  test("T17: preço reajustado no SAP depois da revisão exige nova revisão", async () => {
    const rev = await revisar(JULIANA, carrinho([["PA0016", "2", 2]], "LOJA 01"));
    sap.reajustarPreco("PA0016", 4);
    assert.equal((await falhaDe(enviar(JULIANA, rev))).code, "REVIEW_CHANGED");
    assert.equal(sap.estado().reservas.length, 0);
  });

  test("revisão expirada não abre operação nova", async () => {
    const rev = await revisar(ANA, PEQUENO_());
    relogio += 6 * 60_000;
    assert.equal((await falhaDe(enviar(ANA, rev))).code, "REVIEW_EXPIRED");
  });

  test("T24: SAP fora antes da reserva devolve 503 e não registra nada", async () => {
    const rev = await revisar(ANA, PEQUENO_());
    sap.definirFalha("sapForaDoAr", true);
    assert.equal((await falhaDe(enviar(ANA, rev))).code, "SAP_UNAVAILABLE");
    sap.definirFalha("sapForaDoAr", false);
    assert.equal(sap.estado().reservas.length, 0);
  });

  test("T20: reserva gravada com resposta perdida não chama Orders", async () => {
    const rev = await revisar(ANA, PEQUENO_());
    sap.definirFalha("perderRespostaReserva", true);
    const r = await enviar(ANA, rev);
    assert.equal(r.http, 202);
    assert.equal(r.corpo.status, "RESULTADO_INCERTO");
    assert.equal(pedidosDe(rev.operationId).length, 0);
    sap.definirFalha("perderRespostaReserva", false);
    const replay = await enviar(ANA, rev);
    assert.equal(replay.corpo.status, "RESULTADO_INCERTO");
    assert.equal(pedidosDe(rev.operationId).length, 0);
  });

  test("T22: pedido gravado com resposta perdida é conciliado por U_PRT_ID, sem segundo POST", async () => {
    const rev = await revisar(ANA, PEQUENO_());
    sap.definirFalha("perderRespostaPedido", true);
    const r = await enviar(ANA, rev);
    assert.equal(r.corpo.status, "RESULTADO_INCERTO");
    sap.definirFalha("perderRespostaPedido", false);
    assert.equal((await enviar(ANA, rev)).corpo.status, "RESULTADO_INCERTO");
    const status = await consultarEnvio(sap, ANA, rev.operationId, config, "c-teste");
    assert.equal(status.corpo.status, "INTEGRADO");
    assert.equal(pedidosDe(rev.operationId).length, 1);
  });

  test("T23: falha ao atualizar a UDT depois do pedido não repete Orders", async () => {
    const rev = await revisar(ANA, PEQUENO_());
    sap.definirFalha("falharAtualizacaoReserva", true);
    const r = await enviar(ANA, rev);
    assert.equal(r.http, 201);
    sap.definirFalha("falharAtualizacaoReserva", false);
    assert.equal(sap.estado().reservas[0].estado, "PROCESSANDO");
    assert.equal((await enviar(ANA, rev)).corpo.status, "PROCESSANDO");
    assert.equal((await consultarEnvio(sap, ANA, rev.operationId, config, "c")).corpo.status, "INTEGRADO");
    assert.equal(pedidosDe(rev.operationId).length, 1);
  });

  test("T26: aprovação vira pendência; o pedido convertido no SAP é localizado pelo ID", async () => {
    const rev = await revisar(ANA, GRANDE_());
    assert.equal(rev.approvalExpected, true);
    const r = await enviar(ANA, rev);
    assert.equal(r.http, 202);
    assert.equal(r.corpo.status, "AGUARDANDO_APROVACAO");
    assert.equal(r.corpo.document?.type, "DRAFT");
    sap.aprovarRascunho(r.corpo.document!.docEntry!);
    const status = await consultarEnvio(sap, ANA, rev.operationId, config, "c");
    assert.equal(status.corpo.status, "INTEGRADO");
    assert.equal(status.corpo.document?.type, "ORDER");
    assert.notEqual(status.corpo.document?.docEntry, r.corpo.document?.docEntry);
  });

  test("T25: recusa comercial do SAP é REJEITADO e replay não reenvia", async () => {
    const rev = await revisar(ANA, PEQUENO_());
    sap.definirFalha("recusarPedido", true);
    const r = await enviar(ANA, rev);
    assert.equal(r.http, 422);
    sap.definirFalha("recusarPedido", false);
    const replay = await enviar(ANA, rev);
    assert.equal(replay.corpo.status, "REJEITADO");
    assert.equal(pedidosDe(rev.operationId).length, 0);
  });

  test("T21/T27: PROCESSANDO antigo sem documento vira incerto; o tempo não libera reenvio", async () => {
    const rev = await revisar(ANA, PEQUENO_());
    sap.definirFalha("falharAtualizacaoReserva", true);
    sap.definirFalha("recusarPedido", true); // nem pedido nem atualização: reserva fica PROCESSANDO
    await enviar(ANA, rev);
    sap.definirFalha("falharAtualizacaoReserva", false);
    sap.definirFalha("recusarPedido", false);
    relogio += 3 * 60_000;
    assert.equal((await consultarEnvio(sap, ANA, rev.operationId, config, "c")).corpo.status, "RESULTADO_INCERTO");
    assert.equal((await enviar(ANA, rev)).corpo.status, "RESULTADO_INCERTO");
    assert.equal(pedidosDe(rev.operationId).length, 0);
  });

  test("T28: dois pedidos com o mesmo ID viram incidente", async () => {
    const rev = await revisar(ANA, PEQUENO_());
    sap.definirFalha("perderRespostaPedido", true);
    await enviar(ANA, rev);
    sap.definirFalha("perderRespostaPedido", false);
    const hash = sap.estado().reservas[0].payloadHash;
    const doc = sap.estado().documentos[0];
    await sap.criarPedido({ cardCode: "C00012", dataEntrega: amanha(), shipToCode: "MATRIZ", referencia: "", observacao: "", linhas: [], portalId: doc.portalId, portalHash: hash });
    const status = await consultarEnvio(sap, ANA, rev.operationId, config, "c");
    assert.equal(status.corpo.status, "RESULTADO_INCERTO");
    assert.equal(status.corpo.code, "DUPLICIDADE");
  });

  test("T05: protocolo de outro cliente responde 404", async () => {
    const rev = await revisar(ANA, PEQUENO_());
    await enviar(ANA, rev);
    assert.equal((await falhaDe(consultarEnvio(sap, JULIANA, rev.operationId, config, "c"))).status, 404);
    // Colega do mesmo cliente enxerga o protocolo do cliente.
    assert.equal((await consultarEnvio(sap, CARLOS, rev.operationId, config, "c")).corpo.status, "INTEGRADO");
  });
});
