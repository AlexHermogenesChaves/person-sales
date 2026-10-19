import { chaveEnvio, codeDaUdt } from "./chaves.js";
import { ErroApi, erro } from "./erros.js";
import { lerRevisao, resolverCondicoes, type ConfigRevisao, type Contexto } from "./revisao.js";
import { ehUuid, objetoComChaves } from "./validacao.js";
import {
  SapIndeterminado,
  SapIndisponivel,
  SapRecusa,
  type DocumentoPortal,
  type EstadoEnvio,
  type Reserva,
  type SapGateway,
} from "../sap/tipos.js";

// Envio do pedido — a sequência obrigatória do step 05. Sem banco, sem fila: a
// barreira contra duplicidade é a chave primária da UDT @PRT_REQUEST no SAP, e só a
// requisição que comprovadamente criou a reserva chama Orders, uma vez.

export type ConfigEnvio = ConfigRevisao & {
  /** PROCESSANDO mais velho que isto é tratado como incerto. Tempo não libera reenvio. */
  processandoIncertoAposMs: number;
};

export type RespostaEnvio = {
  http: number;
  corpo: {
    operationId: string;
    status: EstadoEnvio;
    document: { type: "ORDER" | "DRAFT"; docEntry: number | null; docNum: number | null } | null;
    statusUrl: string;
    correlationId: string;
    code?: string;
    message: string;
  };
};

export async function enviarPedido(
  sap: SapGateway,
  ctx: Contexto,
  idempotencyKey: string | undefined,
  corpo: unknown,
  config: ConfigEnvio,
  correlationId: string,
): Promise<RespostaEnvio> {
  // 1–2. Schema, chave de idempotência e token.
  const obj = objetoComChaves(corpo, ["operationId", "reviewToken"]);
  if (!ehUuid(obj.operationId) || idempotencyKey !== obj.operationId) {
    throw new ErroApi(400, "IDEMPOTENCY_KEY_MISMATCH", "Idempotency-Key deve ser igual ao operationId da revisão.");
  }
  const revisao = lerRevisao(obj.reviewToken, config.segredoRevisao);
  if (
    revisao.operationId !== obj.operationId ||
    revisao.empresa !== ctx.empresa ||
    revisao.identityHash !== ctx.identityHash ||
    revisao.cardCode !== ctx.cardCode
  ) {
    throw new ErroApi(403, "REVIEW_NOT_YOURS", "Esta revisão não pertence ao seu usuário ou cliente.");
  }

  const keyHash = chaveEnvio(ctx.empresa, ctx.cardCode, revisao.operationId);
  const code = codeDaUdt(keyHash);

  // 3. Reserva já existe: replay. Devolve o estado, nunca cria de novo.
  const existente = await lerReservaOuIndisponivel(sap, code);
  if (existente) return replay(existente, keyHash, revisao.hash, ctx, correlationId);

  // 4. Operação nova exige revisão no prazo e condições que ainda valem.
  if (config.agora().getTime() > revisao.exp) {
    throw new ErroApi(409, "REVIEW_EXPIRED", "A revisão expirou. Revise o pedido novamente para conferir preços.");
  }
  const condicoes = await resolverCondicoes(sap, ctx, revisao.entrada, config.agora());
  if (condicoes.hash !== revisao.hash) {
    throw new ErroApi(409, "REVIEW_CHANGED", "As condições foram alteradas. Revise o pedido novamente.");
  }

  // 5. Reserva PROCESSANDO. Só quem recebeu "CRIADA" segue.
  const agoraIso = config.agora().toISOString();
  const reserva: Reserva = {
    code,
    keyHash,
    operationId: revisao.operationId,
    cardCode: ctx.cardCode,
    actorHash: ctx.identityHash,
    payloadHash: revisao.hash,
    estado: "PROCESSANDO",
    criadoUtc: agoraIso,
    atualizadoUtc: agoraIso,
    correlation: correlationId,
    docType: null,
    docEntry: null,
    docNum: null,
    erro: null,
  };
  let resultadoReserva: "CRIADA" | "JA_EXISTE";
  try {
    resultadoReserva = await sap.criarReserva(reserva);
  } catch (e) {
    if (e instanceof SapIndisponivel) throw erro.sapFora();
    if (e instanceof SapRecusa) {
      // Recusa explícita da UDT (campo, tamanho, permissão): nada foi gravado.
      throw new ErroApi(503, "RESERVATION_REJECTED", "Não foi possível registrar o envio agora. Seu carrinho foi mantido.");
    }
    // 6. Resposta da reserva perdida: não criar pedido. Só conferir se ela existe.
    return reservaSemConfirmacao(sap, code, revisao.operationId, correlationId);
  }
  if (resultadoReserva === "JA_EXISTE") {
    const vencedora = await lerReservaOuIndisponivel(sap, code);
    if (!vencedora) throw reservaDesconhecida(revisao.operationId, correlationId);
    return replay(vencedora, keyHash, revisao.hash, ctx, correlationId);
  }

  // 7. Uma única tentativa em Orders.
  let documento: DocumentoPortal;
  try {
    documento = await sap.criarPedido({ ...condicoes.pedido, portalId: revisao.operationId, portalHash: revisao.hash });
  } catch (e) {
    if (e instanceof SapRecusa) {
      await atualizarSemRepetir(sap, code, { estado: "REJEITADO", erro: e.codigo });
      return resposta(422, revisao.operationId, "REJEITADO", null, correlationId, "SAP_REJECTED", `O SAP recusou o pedido: ${e.message}`);
    }
    // Timeout, conexão caída depois do envio, resposta ilegível: pode ter gravado.
    await atualizarSemRepetir(sap, code, { estado: "RESULTADO_INCERTO", erro: e instanceof SapIndeterminado ? "TIMEOUT_ORDERS" : "ERRO_ORDERS" });
    return resposta(202, revisao.operationId, "RESULTADO_INCERTO", null, correlationId, "RESULT_UNCERTAIN", MENSAGEM.RESULTADO_INCERTO);
  }

  // 8. Registrar o resultado. Se a atualização falhar, o pedido existe: não repetir.
  const estado: EstadoEnvio = documento.tipo === "ORDER" ? "INTEGRADO" : "AGUARDANDO_APROVACAO";
  const divergente = documento.total !== null && condicoes.previa.total !== null && documento.total !== condicoes.previa.total;
  await atualizarSemRepetir(sap, code, {
    estado,
    docType: documento.tipo,
    docEntry: documento.docEntry,
    docNum: documento.docNum,
    erro: divergente ? "TOTAL_DIVERGENTE" : null,
  });
  if (divergente) {
    return resposta(202, revisao.operationId, estado, documento, correlationId, "TOTAL_MISMATCH", MENSAGEM.TOTAL_DIVERGENTE);
  }
  return resposta(estado === "INTEGRADO" ? 201 : 202, revisao.operationId, estado, documento, correlationId, undefined, MENSAGEM[estado]);
}

/** GET /submissions/{id}: consulta e concilia, nunca cria nem reenvia. */
export async function consultarEnvio(
  sap: SapGateway,
  ctx: Contexto,
  operationId: string,
  config: ConfigEnvio,
  correlationId: string,
): Promise<RespostaEnvio> {
  if (!ehUuid(operationId)) throw erro.naoEncontrado();
  const keyHash = chaveEnvio(ctx.empresa, ctx.cardCode, operationId);
  const reserva = await lerReservaOuIndisponivel(sap, codeDaUdt(keyHash));
  // Protocolo de outro cliente responde igual a inexistente: não confirma existência.
  if (!reserva || reserva.keyHash !== keyHash || reserva.cardCode !== ctx.cardCode) throw erro.naoEncontrado();

  const conciliada = await conciliar(sap, reserva, config);
  return resposta(
    conciliada.estado === "INTEGRADO" ? 200 : conciliada.estado === "REJEITADO" ? 200 : 202,
    operationId,
    conciliada.estado,
    conciliada.docType ? { tipo: conciliada.docType, docEntry: conciliada.docEntry, docNum: conciliada.docNum } : null,
    correlationId,
    conciliada.erro ?? undefined,
    mensagemDoEstado(conciliada),
  );
}

/**
 * Procura Orders e Drafts por U_PRT_ID, sempre restrito ao cliente e à origem portal.
 * Mais de um pedido para o mesmo ID é incidente; consulta vazia não prova nada.
 */
export async function conciliar(sap: SapGateway, reserva: Reserva, config: ConfigEnvio): Promise<Reserva> {
  if (reserva.estado === "INTEGRADO" && reserva.erro === null) return reserva;
  if (reserva.estado === "REJEITADO") return reserva;

  let documentos: DocumentoPortal[];
  try {
    documentos = await sap.buscarDocumentosPortal(reserva.cardCode, reserva.operationId);
  } catch (e) {
    if (e instanceof SapIndisponivel || e instanceof SapIndeterminado) throw erro.sapFora();
    throw e;
  }
  const pedidos = documentos.filter((d) => d.tipo === "ORDER");
  const rascunhos = documentos.filter((d) => d.tipo === "DRAFT");
  let mudanca: Partial<Reserva> | null = null;

  if (pedidos.length > 1) {
    mudanca = { estado: "RESULTADO_INCERTO", erro: "DUPLICIDADE" };
  } else if (documentos.some((d) => d.portalHash !== reserva.payloadHash)) {
    mudanca = { estado: "RESULTADO_INCERTO", erro: "HASH_DIVERGENTE" };
  } else if (pedidos.length === 1) {
    const p = pedidos[0];
    if (reserva.estado !== "INTEGRADO" || reserva.docEntry !== p.docEntry) {
      mudanca = { estado: "INTEGRADO", docType: "ORDER", docEntry: p.docEntry, docNum: p.docNum, erro: reserva.erro === "TOTAL_DIVERGENTE" ? reserva.erro : null };
    }
  } else if (rascunhos.length >= 1) {
    const r = rascunhos[0];
    if (reserva.estado !== "AGUARDANDO_APROVACAO" || reserva.docEntry !== r.docEntry) {
      mudanca = { estado: "AGUARDANDO_APROVACAO", docType: "DRAFT", docEntry: r.docEntry, docNum: r.docNum };
    }
  } else if (reserva.estado === "PROCESSANDO") {
    const idade = config.agora().getTime() - new Date(reserva.atualizadoUtc).getTime();
    if (idade > config.processandoIncertoAposMs) mudanca = { estado: "RESULTADO_INCERTO", erro: reserva.erro ?? "PROCESSANDO_INTERROMPIDO" };
  }

  if (!mudanca) return reserva;
  await atualizarSemRepetir(sap, reserva.code, mudanca);
  return { ...reserva, ...mudanca };
}

// ---- Auxiliares ---------------------------------------------------------------

const MENSAGEM: Record<EstadoEnvio | "TOTAL_DIVERGENTE", string> = {
  INTEGRADO: "Pedido registrado no SAP.",
  AGUARDANDO_APROVACAO: "Pedido recebido e aguardando aprovação comercial. Ainda não é um pedido confirmado.",
  PROCESSANDO: "Pedido em processamento. Consulte este protocolo em instantes.",
  REJEITADO: "O SAP recusou o pedido. Corrija e revise novamente.",
  RESULTADO_INCERTO:
    "Não recebemos a confirmação do SAP. O pedido pode ter sido registrado: não envie de novo. Nossa equipe vai conferir este protocolo.",
  TOTAL_DIVERGENTE:
    "O pedido foi registrado, mas o valor calculado pelo SAP difere do aceito. Nossa equipe comercial vai entrar em contato.",
};

function mensagemDoEstado(r: Reserva) {
  if (r.erro === "TOTAL_DIVERGENTE") return MENSAGEM.TOTAL_DIVERGENTE;
  if (r.erro === "DUPLICIDADE" || r.erro === "HASH_DIVERGENTE") {
    return "Encontramos uma inconsistência neste protocolo. Ele foi bloqueado e nossa equipe vai analisar.";
  }
  return MENSAGEM[r.estado];
}

function replay(existente: Reserva, keyHash: string, hash: string, ctx: Contexto, correlationId: string): RespostaEnvio {
  if (existente.keyHash !== keyHash || existente.cardCode !== ctx.cardCode) {
    // Colisão dos 40 hex do Code: hash completo diferente. Nunca seguir.
    throw new ErroApi(409, "KEY_COLLISION", "Não foi possível registrar esta operação. Revise o pedido novamente.");
  }
  if (existente.payloadHash !== hash) {
    throw new ErroApi(409, "IDEMPOTENCY_CONFLICT", "Este protocolo já foi usado com outro conteúdo.");
  }
  const http = existente.estado === "PROCESSANDO" || existente.estado === "RESULTADO_INCERTO" || existente.estado === "AGUARDANDO_APROVACAO" ? 202 : 200;
  return resposta(
    http,
    existente.operationId,
    existente.estado,
    existente.docType ? { tipo: existente.docType, docEntry: existente.docEntry, docNum: existente.docNum } : null,
    correlationId,
    existente.erro ?? undefined,
    mensagemDoEstado(existente),
  );
}

async function reservaSemConfirmacao(sap: SapGateway, code: string, operationId: string, correlationId: string) {
  let lida: Reserva | null;
  try {
    lida = await sap.lerReserva(code);
  } catch {
    throw reservaDesconhecida(operationId, correlationId);
  }
  if (!lida) throw reservaDesconhecida(operationId, correlationId);
  // Ela existe, mas esta requisição não recebeu a confirmação: não assume, não envia.
  await atualizarSemRepetir(sap, code, { estado: "RESULTADO_INCERTO", erro: "RESERVA_SEM_CONFIRMACAO" });
  return resposta(202, operationId, "RESULTADO_INCERTO", null, correlationId, "RESULT_UNCERTAIN", MENSAGEM.RESULTADO_INCERTO);
}

function reservaDesconhecida(operationId: string, correlationId: string) {
  return new ErroApi(
    503,
    "RESERVATION_UNKNOWN",
    "Não foi possível confirmar o registro do envio. Consulte este protocolo antes de tentar outro pedido.",
    [],
    { operationId, statusUrl: `/api/v1/submissions/${operationId}`, correlationId },
  );
}

async function lerReservaOuIndisponivel(sap: SapGateway, code: string) {
  try {
    return await sap.lerReserva(code);
  } catch (e) {
    if (e instanceof SapIndisponivel || e instanceof SapIndeterminado) throw erro.sapFora();
    throw e;
  }
}

/** Atualização do controle técnico: falha aqui é registrada em log, nunca vira novo POST. */
async function atualizarSemRepetir(sap: SapGateway, code: string, mudanca: Partial<Reserva>) {
  try {
    await sap.atualizarReserva(code, mudanca);
  } catch (e) {
    console.warn(JSON.stringify({ evento: "reserva.atualizacao_falhou", code, estado: mudanca.estado, erro: (e as Error).message }));
  }
}

function resposta(
  http: number,
  operationId: string,
  status: EstadoEnvio,
  documento: Pick<DocumentoPortal, "tipo" | "docEntry" | "docNum"> | null,
  correlationId: string,
  code: string | undefined,
  message: string,
): RespostaEnvio {
  return {
    http,
    corpo: {
      operationId,
      status,
      document: documento ? { type: documento.tipo, docEntry: documento.docEntry, docNum: documento.docNum } : null,
      statusUrl: `/api/v1/submissions/${operationId}`,
      correlationId,
      ...(code ? { code } : {}),
      message,
    },
  };
}
