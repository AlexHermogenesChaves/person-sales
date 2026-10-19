// Versão estática da demonstração (Vercel): as rotas do portal atendidas dentro da
// própria página, por um interceptador de fetch. Usa o MESMO domínio do servidor —
// revisão assinada, reserva na UDT, uma tentativa de Orders, conciliação — e o mesmo
// SAP simulado. O que muda: não há servidor, então sessão, CSRF e o segredo da revisão
// vivem na aba. É demonstração, não segurança: em produção isso é o Express.
//
// Cada aba tem a sua demo; recarregar a página reinicia o SAP simulado. O login fica
// guardado na aba (sessionStorage) para o reload não pedir MFA de novo.

import { codeDaUdt, idAleatorio, identityHash } from "../../../server/dominio/chaves";
import { enderecosDto, lerConsultaCatalogo, montarCatalogo, resolverVinculo } from "../../../server/dominio/catalogo";
import { consultarEnvio, enviarPedido, type ConfigEnvio } from "../../../server/dominio/envio";
import { ErroApi, erro } from "../../../server/dominio/erros";
import { dataInicial, historicoDePrecos, paraDto, resumir } from "../../../server/dominio/historico";
import { emitirRevisao } from "../../../server/dominio/revisao";
import { hojeComercial, objetoComChaves } from "../../../server/dominio/validacao";
import { EMPRESA_DEMO, PESSOAS, SapSimulado, type Falhas } from "../../../server/sap/simulado";
import { SapIndeterminado, SapIndisponivel, SapRecusa } from "../../../server/sap/tipos";

const CODIGO_MFA_DEMO = "123456";
const CHAVE_PESSOA = "demo.pessoa";

type Sessao = { chave: string; identityHash: string; nome: string; email: string; csrf: string; mfaPendente: boolean };
type Resposta = { status: number; corpo?: unknown; cabecalhos?: Record<string, string> };

const sap = new SapSimulado({ latenciaMs: 300 });
const config: ConfigEnvio = {
  segredoRevisao: idAleatorio(32),
  validadeMs: 5 * 60_000,
  processandoIncertoAposMs: 2 * 60_000,
  agora: () => new Date(),
};
let sessao: Sessao | null = restaurarSessao();

function restaurarSessao(): Sessao | null {
  try {
    const chave = sessionStorage.getItem(CHAVE_PESSOA);
    const p = chave ? PESSOAS[chave] : undefined;
    return p && chave ? novaSessao(chave, false) : null;
  } catch {
    return null;
  }
}

function novaSessao(chave: string, mfaPendente: boolean): Sessao {
  const p = PESSOAS[chave];
  return { chave, identityHash: identityHash(p.issuer, p.sub), nome: p.nome, email: p.email, csrf: idAleatorio(24), mfaPendente };
}

const correlacao = () => `c-${idAleatorio(4).slice(0, 8)}`;

async function contexto() {
  if (!sessao || sessao.mfaPendente) throw erro.semSessao();
  return resolverVinculo(sap, EMPRESA_DEMO, sessao.identityHash, codeDaUdt(sessao.identityHash));
}

function exigirCsrf(cabecalhos: Headers) {
  if (!sessao || cabecalhos.get("x-csrf-token") !== sessao.csrf) throw erro.csrf();
}

async function atender(metodo: string, url: URL, cabecalhos: Headers, corpo: unknown, correlationId: string): Promise<Resposta> {
  const rota = `${metodo} ${url.pathname}`;
  const query = Object.fromEntries(url.searchParams.entries());
  const semQuery = () => {
    if (url.searchParams.size) throw erro.schema([{ campo: "query", mensagem: "Esta rota não aceita parâmetros." }]);
  };

  // ---- Login simulado -------------------------------------------------------------
  if (rota === "GET /auth/demo/pessoas") {
    return {
      status: 200,
      corpo: {
        pessoas: Object.entries(PESSOAS).map(([chave, p]) => ({ chave, nome: p.nome, email: p.email, descricao: p.descricao })),
        codigoMfa: CODIGO_MFA_DEMO,
      },
    };
  }
  if (rota === "POST /auth/demo/login") {
    const { pessoa } = objetoComChaves(corpo, ["pessoa"]);
    if (typeof pessoa !== "string" || !PESSOAS[pessoa]) throw erro.schema([{ campo: "pessoa", mensagem: "Identidade de teste desconhecida." }]);
    sessao = novaSessao(pessoa, true);
    return { status: 200, corpo: { mfaRequired: true } };
  }
  if (rota === "POST /auth/demo/mfa") {
    const { codigo } = objetoComChaves(corpo, ["codigo"]);
    if (!sessao || !sessao.mfaPendente) throw erro.semSessao();
    if (codigo !== CODIGO_MFA_DEMO) throw new ErroApi(401, "MFA_INVALID", "Código de verificação incorreto.");
    sessao = novaSessao(sessao.chave, false);
    try {
      sessionStorage.setItem(CHAVE_PESSOA, sessao.chave);
    } catch {
      /* sem storage: o login vale até recarregar */
    }
    return { status: 200, corpo: { ok: true } };
  }
  if (rota === "POST /auth/logout") {
    exigirCsrf(cabecalhos);
    sessao = null;
    try {
      sessionStorage.removeItem(CHAVE_PESSOA);
    } catch {
      /* nada a limpar */
    }
    return { status: 204 };
  }

  // ---- API do portal -----------------------------------------------------------------
  if (rota === "GET /api/v1/me") {
    if (!sessao || sessao.mfaPendente) throw erro.semSessao();
    try {
      const ctx = await contexto();
      return {
        status: 200,
        corpo: {
          user: { name: sessao.nome, email: sessao.email },
          customer: { code: ctx.cardCode, name: ctx.clienteNome },
          permissions: ["catalog:read", "orders:create"],
          csrfToken: sessao.csrf,
          sapMode: sap.modo,
        },
      };
    } catch (e) {
      if (e instanceof ErroApi && e.status === 403) {
        throw new ErroApi(e.status, e.code, e.message, [], { user: { name: sessao.nome, email: sessao.email }, csrfToken: sessao.csrf });
      }
      throw e;
    }
  }
  if (rota === "GET /api/v1/catalog") {
    const ctx = await contexto();
    return { status: 200, corpo: await montarCatalogo(sap, ctx, lerConsultaCatalogo(query)) };
  }
  if (rota === "GET /api/v1/addresses") {
    const ctx = await contexto();
    return { status: 200, corpo: enderecosDto(await sap.listarEnderecos(ctx.cardCode)) };
  }
  if (rota === "POST /api/v1/reviews") {
    exigirCsrf(cabecalhos);
    const ctx = await contexto();
    return { status: 200, corpo: await emitirRevisao(sap, ctx, corpo, config) };
  }
  if (rota === "POST /api/v1/orders") {
    exigirCsrf(cabecalhos);
    const ctx = await contexto();
    const r = await enviarPedido(sap, ctx, cabecalhos.get("idempotency-key") ?? undefined, corpo, config, correlationId);
    return { status: r.http, corpo: r.corpo };
  }
  if (metodo === "GET" && url.pathname.startsWith("/api/v1/submissions/")) {
    const ctx = await contexto();
    const r = await consultarEnvio(sap, ctx, decodeURIComponent(url.pathname.split("/").pop() ?? ""), config, correlationId);
    return { status: r.http, corpo: r.corpo };
  }
  if (rota === "GET /api/v1/orders" || rota === "GET /api/v1/summary" || rota === "GET /api/v1/items/history") {
    semQuery();
    const ctx = await contexto();
    const hoje = hojeComercial(config.agora());
    const pedidos = await sap.listarPedidosCliente(ctx.cardCode, dataInicial(hoje));
    if (rota === "GET /api/v1/orders") return { status: 200, corpo: { from: dataInicial(hoje), orders: pedidos.slice(0, 300).map(paraDto) } };
    if (rota === "GET /api/v1/items/history") return { status: 200, corpo: { from: dataInicial(hoje), items: historicoDePrecos(pedidos) } };
    return { status: 200, corpo: resumir(pedidos, await sap.listarEnviosPendentes(ctx.cardCode), hoje) };
  }

  // ---- Bastidores -----------------------------------------------------------------------
  if (rota === "GET /demo/estado") return { status: 200, corpo: sap.estado() };
  if (rota === "POST /demo/falha") {
    const { chave, valor } = objetoComChaves(corpo, ["chave", "valor"]);
    if (typeof chave !== "string" || !(chave in sap.falhas) || typeof valor !== "boolean") throw erro.schema();
    sap.definirFalha(chave as keyof Falhas, valor);
    return { status: 200, corpo: sap.estado() };
  }
  if (rota === "POST /demo/aprovar") {
    const { docEntry } = objetoComChaves(corpo, ["docEntry"]);
    if (typeof docEntry !== "number" || !sap.aprovarRascunho(docEntry)) throw erro.naoEncontrado();
    return { status: 200, corpo: sap.estado() };
  }
  if (rota === "POST /demo/reajuste") {
    const { itemCode, percentual } = objetoComChaves(corpo, ["itemCode", "percentual"]);
    if (typeof itemCode !== "string" || typeof percentual !== "number" || !sap.reajustarPreco(itemCode, percentual)) throw erro.schema();
    return { status: 200, corpo: sap.estado() };
  }
  if (rota === "POST /demo/vinculo") {
    const { code } = objetoComChaves(corpo, ["code"]);
    if (typeof code !== "string" || sap.alternarVinculo(code) === null) throw erro.naoEncontrado();
    return { status: 200, corpo: sap.estado() };
  }
  if (rota === "POST /demo/reiniciar") {
    sap.reiniciar();
    return { status: 200, corpo: sap.estado() };
  }

  throw new ErroApi(404, "NOT_FOUND", "Rota inexistente.");
}

function paraErro(e: unknown, correlationId: string): Resposta {
  let falha: ErroApi;
  if (e instanceof ErroApi) falha = e;
  else if (e instanceof SapIndisponivel || e instanceof SapIndeterminado) falha = erro.sapFora();
  else if (e instanceof SapRecusa) falha = new ErroApi(422, "SAP_REJECTED", e.message);
  else {
    console.error("demo: erro interno", e);
    falha = new ErroApi(500, "INTERNAL_ERROR", "Erro inesperado. Informe o protocolo de atendimento.");
  }
  return {
    status: falha.status,
    corpo: { code: falha.code, message: falha.message, correlationId, fieldErrors: falha.fieldErrors, ...falha.extra },
    cabecalhos: falha.status === 429 && typeof falha.extra.retryAfter === "number" ? { "Retry-After": String(falha.extra.retryAfter) } : {},
  };
}

/** Troca o fetch da página: /api, /auth e /demo vão para cá; o resto segue para a rede. */
export function instalarBackendNavegador() {
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada), window.location.origin);
    const ehNosso = url.origin === window.location.origin && /^\/(api|auth|demo)\//.test(url.pathname);
    if (!ehNosso) return fetchOriginal(entrada as RequestInfo, init);

    const metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
    const cabecalhos = new Headers(init?.headers);
    let corpo: unknown;
    try {
      corpo = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    } catch {
      corpo = Symbol("json-invalido");
    }
    const correlationId = correlacao();
    let r: Resposta;
    try {
      if (typeof corpo === "symbol") throw erro.schema([{ campo: "corpo", mensagem: "JSON inválido." }]);
      r = await atender(metodo, url, cabecalhos, corpo, correlationId);
    } catch (e) {
      r = paraErro(e, correlationId);
    }
    const headers = { "Content-Type": "application/json", "X-Correlation-Id": correlationId, ...r.cabecalhos };
    return new Response(r.status === 204 || r.corpo === undefined ? null : JSON.stringify(r.corpo), { status: r.status, headers });
  };
}
