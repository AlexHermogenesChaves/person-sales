import { assinar, jsonCanonico, novoUuid, sha256, verificar } from "./chaves.js";
import { dec, ehMultiplo, lerDecimal, texto } from "./decimal.js";
import { ErroApi, erro, type ErroDeCampo } from "./erros.js";
import { dataValida, hojeComercial, inteiroPositivo, objetoComChaves, somarDias, textoLimitado } from "./validacao.js";
import type { Endereco, ItemSap, PedidoSap, PreviaPedido, SapGateway } from "../sap/tipos.js";

export type Contexto = {
  empresa: string;
  identityHash: string;
  cardCode: string;
};

export type ConfigRevisao = {
  segredoRevisao: string;
  validadeMs: number;
  agora: () => Date;
};

export type LinhaEntrada = { itemCode: string; quantity: string; uomEntry: number };

export type EntradaRevisao = {
  items: LinhaEntrada[];
  shipToCode: string;
  requestedDate: string;
  customerReference: string;
  comments: string;
};

const MAX_LINHAS = 100;
const MAX_OBSERVACAO = 500;
const MAX_REFERENCIA = 100;
const DIAS_MAXIMOS_ENTREGA = 60;
const VERSAO_REGRAS = "2026-10-19";
const CODIGO_ITEM = /^[A-Za-z0-9._-]{1,50}$/;

/** Schema do POST /reviews. Preço, desconto, depósito ou CardCode não têm onde entrar. */
export function lerEntradaRevisao(corpo: unknown): EntradaRevisao {
  const obj = objetoComChaves(corpo, ["items", "shipToCode", "requestedDate"], ["customerReference", "comments"]);
  if (!Array.isArray(obj.items) || obj.items.length === 0 || obj.items.length > MAX_LINHAS) {
    throw erro.schema([{ campo: "items", mensagem: `Informe de 1 a ${MAX_LINHAS} linhas.` }]);
  }
  const items = obj.items.map((linha, i): LinhaEntrada => {
    const l = objetoComChaves(linha, ["itemCode", "quantity", "uomEntry"], [], `items[${i}]`);
    const quantity = typeof l.quantity === "string" ? l.quantity : "";
    if (lerDecimal(quantity, 3) === null || dec(quantity) === 0n) {
      throw erro.schema([{ campo: `items[${i}].quantity`, mensagem: "Quantidade positiva com até 3 casas, separador ponto." }]);
    }
    return {
      itemCode: textoLimitado(l.itemCode, `items[${i}].itemCode`, 50, CODIGO_ITEM),
      quantity,
      uomEntry: inteiroPositivo(l.uomEntry, `items[${i}].uomEntry`),
    };
  });
  const chaves = new Set<string>();
  for (const [i, l] of items.entries()) {
    const chave = `${l.itemCode}:${l.uomEntry}`;
    if (chaves.has(chave)) throw erro.schema([{ campo: `items[${i}]`, mensagem: "Item repetido na mesma unidade." }]);
    chaves.add(chave);
  }
  return {
    items,
    shipToCode: textoLimitado(obj.shipToCode, "shipToCode", 50),
    requestedDate: textoLimitado(obj.requestedDate, "requestedDate", 10),
    customerReference: textoLimitado(obj.customerReference ?? "", "customerReference", MAX_REFERENCIA),
    comments: textoLimitado(obj.comments ?? "", "comments", MAX_OBSERVACAO),
  };
}

export type LinhaRevisada = {
  itemCode: string;
  description: string;
  uomEntry: number;
  unit: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  tax: string;
  priceOrigin: "LISTA" | "ESPECIAL" | "QUANTIDADE";
};

export type Condicoes = {
  pedido: PedidoSap;
  previa: PreviaPedido;
  linhas: LinhaRevisada[];
  endereco: Endereco;
  hash: string;
};

/**
 * Consulta o SAP e monta as condições do pedido. Roda na revisão e de novo no envio:
 * se o hash mudou entre uma e outra, o comprador aceitou algo que não vale mais.
 */
export async function resolverCondicoes(
  sap: SapGateway,
  ctx: Contexto,
  entrada: EntradaRevisao,
  agora: Date,
): Promise<Condicoes> {
  const problemas: ErroDeCampo[] = [];
  const linhasOrdenadas = [...entrada.items].sort((a, b) =>
    a.itemCode === b.itemCode ? a.uomEntry - b.uomEntry : a.itemCode < b.itemCode ? -1 : 1,
  );

  const hoje = hojeComercial(agora);
  if (!dataValida(entrada.requestedDate)) {
    problemas.push({ campo: "requestedDate", mensagem: "Data inválida." });
  } else if (entrada.requestedDate <= hoje || entrada.requestedDate > somarDias(hoje, DIAS_MAXIMOS_ENTREGA)) {
    problemas.push({ campo: "requestedDate", mensagem: `A entrega deve ser entre amanhã e ${DIAS_MAXIMOS_ENTREGA} dias.` });
  }

  const [itens, enderecos] = await Promise.all([
    sap.buscarItens([...new Set(linhasOrdenadas.map((l) => l.itemCode))]),
    sap.listarEnderecos(ctx.cardCode),
  ]);
  const porCodigo = new Map(itens.map((i) => [i.itemCode, i]));
  const endereco = enderecos.find((e) => e.codigo === entrada.shipToCode);
  if (!endereco) problemas.push({ campo: "shipToCode", mensagem: "Endereço de entrega não pertence ao cliente." });

  for (const linha of linhasOrdenadas) {
    const item = porCodigo.get(linha.itemCode);
    const campo = `items[${entrada.items.indexOf(linha)}]`;
    if (!item || !podeVender(item)) {
      problemas.push({ campo: `${campo}.itemCode`, mensagem: `${linha.itemCode} não está disponível para venda no portal.` });
      continue;
    }
    const unidade = item.unidades.find((u) => u.entry === linha.uomEntry);
    if (!unidade) {
      problemas.push({ campo: `${campo}.uomEntry`, mensagem: `Unidade não permitida para ${item.itemCode}.` });
    } else if (!ehMultiplo(dec(linha.quantity), dec(unidade.multiplo))) {
      problemas.push({ campo: `${campo}.quantity`, mensagem: `${item.itemCode} é vendido em múltiplos de ${unidade.multiplo} ${unidade.codigo}.` });
    }
  }
  if (problemas.length) {
    throw new ErroApi(422, "ORDER_RULES", "Alguns itens ou dados de entrega precisam de ajuste.", problemas);
  }

  const precos = await sap.precos(ctx.cardCode, entrada.requestedDate, linhasOrdenadas.map((l) => ({
    itemCode: l.itemCode,
    uomEntry: l.uomEntry,
    quantidade: l.quantity,
  })));

  const pedido: PedidoSap = {
    cardCode: ctx.cardCode,
    dataEntrega: entrada.requestedDate,
    shipToCode: entrada.shipToCode,
    referencia: entrada.customerReference,
    observacao: entrada.comments,
    linhas: linhasOrdenadas.map((l, i) => ({
      itemCode: l.itemCode,
      quantidade: texto(dec(l.quantity), 3),
      uomEntry: l.uomEntry,
      precoUnitario: precos[i].precoUnitario,
    })),
  };
  const previa = await sap.preverPedido(pedido);

  const linhas: LinhaRevisada[] = pedido.linhas.map((l, i) => {
    const item = porCodigo.get(l.itemCode) as ItemSap;
    const unidade = item.unidades.find((u) => u.entry === l.uomEntry);
    return {
      itemCode: l.itemCode,
      description: item.descricao,
      uomEntry: l.uomEntry,
      unit: unidade?.codigo ?? "",
      quantity: l.quantidade,
      unitPrice: l.precoUnitario,
      lineTotal: previa.linhas[i].totalLinha,
      tax: previa.linhas[i].imposto,
      priceOrigin: precos[i].origem,
    };
  });

  const hash = sha256(
    jsonCanonico({
      versaoRegras: VERSAO_REGRAS,
      empresa: ctx.empresa,
      cardCode: ctx.cardCode,
      pedido,
      totais: {
        subtotal: previa.subtotal,
        impostos: previa.impostos,
        despesas: previa.despesas,
        total: previa.total,
        totaisFinais: previa.totaisFinais,
      },
    }),
  );
  return { pedido, previa, linhas, endereco: endereco as Endereco, hash };
}

const podeVender = (i: ItemSap) => i.vendavel && i.ativo && i.publicado;

export type ConteudoRevisao = {
  v: 1;
  operationId: string;
  empresa: string;
  identityHash: string;
  cardCode: string;
  entrada: EntradaRevisao;
  hash: string;
  exp: number;
};

export async function emitirRevisao(sap: SapGateway, ctx: Contexto, corpo: unknown, config: ConfigRevisao) {
  const entrada = lerEntradaRevisao(corpo);
  const agora = config.agora();
  const condicoes = await resolverCondicoes(sap, ctx, entrada, agora);
  const operationId = novoUuid();
  const exp = agora.getTime() + config.validadeMs;
  const conteudo: ConteudoRevisao = {
    v: 1,
    operationId,
    empresa: ctx.empresa,
    identityHash: ctx.identityHash,
    cardCode: ctx.cardCode,
    entrada,
    hash: condicoes.hash,
    exp,
  };
  const { previa } = condicoes;
  return {
    operationId,
    reviewToken: assinar(conteudo, config.segredoRevisao),
    expiresAt: new Date(exp).toISOString(),
    currency: "BRL",
    subtotal: previa.subtotal,
    tax: previa.totaisFinais ? previa.impostos : null,
    expenses: previa.totaisFinais ? previa.despesas : null,
    total: previa.totaisFinais ? previa.total : null,
    totalsAreFinal: previa.totaisFinais,
    approvalExpected: previa.caiEmAprovacao,
    lines: condicoes.linhas,
    shipTo: condicoes.endereco,
    requestedDate: entrada.requestedDate,
    customerReference: entrada.customerReference,
    comments: entrada.comments,
  };
}

/** Lê o token de revisão. Assinatura inválida e formato estranho caem no mesmo erro. */
export function lerRevisao(token: unknown, segredo: string): ConteudoRevisao {
  const conteudo = verificar(token, segredo) as ConteudoRevisao | null;
  if (!conteudo || conteudo.v !== 1 || typeof conteudo.operationId !== "string" || typeof conteudo.hash !== "string") {
    throw new ErroApi(400, "REVIEW_INVALID", "A revisão do pedido não é válida. Revise o pedido novamente.");
  }
  return conteudo;
}
