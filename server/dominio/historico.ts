import { dec, soma, texto, type Dec } from "./decimal.js";
import type { EnvioPendente, PedidoCliente } from "../sap/tipos.js";

// Página inicial do comprador: pedidos do cliente lidos do SAP (qualquer origem) e
// indicadores calculados na hora, sobre a mesma leitura. Nada é guardado no portal.
//
// Mudança de escopo de 19/10/2026: a spec v2.0 deixava "histórico completo de
// vendas" fora. A leitura fica limitada a 6 meses e só ao cliente autenticado.
// A situação é medida pelo faturamento (mockup Luminatti): não existe "entregue".

export const MESES_HISTORICO = 6;

export function dataInicial(hoje: string, meses = MESES_HISTORICO) {
  const [a, m] = hoje.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 - (meses - 1), 1));
  return d.toISOString().slice(0, 10);
}

const conta = (p: PedidoCliente) => p.situacao !== "CANCELADO";
const emAberto = (p: PedidoCliente) => p.tipo === "ORDER" && (p.situacao === "APROVADO" || p.situacao === "PARCIAL");
const falta = (p: PedidoCliente): Dec => (conta(p) ? dec(p.total) - dec(p.faturado) : 0n);
const somaTotais = (lista: PedidoCliente[]) => texto(soma(lista.map((p) => dec(p.total))), 2);
const somaFalta = (lista: PedidoCliente[]) => texto(soma(lista.map(falta)), 2);
const mesDe = (data: string) => data.slice(0, 7);
const subtrai = (a: string, b: string) => {
  const r = dec(a) - dec(b);
  return r > 0n ? r : 0n;
};

export function paraDto(p: PedidoCliente) {
  return {
    type: p.tipo,
    docEntry: p.docEntry,
    docNum: p.docNum,
    date: p.data,
    expectedDate: p.dataEntrega,
    total: p.total,
    invoiced: p.faturado,
    pending: texto(falta(p), 2),
    status: p.situacao,
    origin: p.origem,
    customerReference: p.referencia,
    operationId: p.portalId,
    milestones: { sent: p.data, approved: p.marcos.aprovado, invoiced: p.marcos.faturado, completed: p.marcos.concluido },
    lines: p.linhas.map((l) => ({
      itemCode: l.itemCode,
      description: l.descricao,
      quantity: l.quantidade,
      invoicedQuantity: l.faturada,
      pendingQuantity: texto(subtrai(l.quantidade, l.faturada), 3),
      uomEntry: l.uomEntry,
      unit: l.unidade,
      unitPrice: l.precoUnitario,
      lineTotal: l.total,
    })),
  };
}

export function resumir(pedidos: PedidoCliente[], pendentes: EnvioPendente[], hoje: string) {
  const pedidosFinais = pedidos.filter((p) => p.tipo === "ORDER" && conta(p));
  const abertos = pedidos.filter(emAberto);
  const aprovacao = pedidos.filter((p) => p.situacao === "AGUARDANDO_APROVACAO");
  const atrasados = abertos.filter((p) => p.dataEntrega < hoje);
  const parciais = abertos.filter((p) => p.situacao === "PARCIAL");

  const mesAtual = mesDe(hoje);
  const [a, m, d] = hoje.split("-").map(Number);
  const anterior = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7);
  const diaLimite = String(d).padStart(2, "0");
  const doMes = pedidosFinais.filter((p) => mesDe(p.data) === mesAtual);
  const mesmoPeriodoAnterior = pedidosFinais.filter((p) => mesDe(p.data) === anterior && p.data.slice(8, 10) <= diaLimite);

  const proximas = abertos.filter((p) => p.dataEntrega >= hoje).sort((x, y) => (x.dataEntrega < y.dataEntrega ? -1 : 1));

  const meses: { month: string; total: string; orders: number }[] = [];
  for (let i = MESES_HISTORICO - 1; i >= 0; i--) {
    const mes = new Date(Date.UTC(a, m - 1 - i, 1)).toISOString().slice(0, 7);
    const doPeriodo = pedidosFinais.filter((p) => mesDe(p.data) === mes);
    meses.push({ month: mes, total: somaTotais(doPeriodo), orders: doPeriodo.length });
  }

  const desde90 = somarDias(hoje, -90);
  const recentes = pedidosFinais.filter((p) => p.data >= desde90);
  const topItems = historicoDePrecos(recentes)
    .slice(0, 5)
    .map(({ points: _p, ...i }) => i);

  const origens = { PORTAL: 0, VENDEDOR: 0, EDI: 0 };
  for (const p of pedidos.filter(conta)) origens[p.origem]++;

  return {
    asOf: hoje,
    open: { orders: abertos.length, total: somaTotais(abertos), pending: somaFalta(abertos) },
    // "Precisa da sua atenção": não depende do período escolhido, olha o hoje.
    attention: {
      awaitingApproval: { orders: aprovacao.length, total: somaTotais(aprovacao) },
      overdue: { orders: atrasados.length, pending: somaFalta(atrasados), oldest: atrasados.map((p) => p.dataEntrega).sort()[0] ?? null },
      partial: { orders: parciais.length, pending: somaFalta(parciais) },
      uncertainSubmissions: pendentes
        .filter((e) => e.estado === "RESULTADO_INCERTO")
        .map((e) => ({ operationId: e.operationId, createdAt: e.criadoUtc })),
    },
    nextDelivery: proximas[0]
      ? { date: proximas[0].dataEntrega, docNum: proximas[0].docNum, orders: proximas.filter((p) => p.dataEntrega === proximas[0].dataEntrega).length }
      : null,
    monthToDate: { total: somaTotais(doMes), orders: doMes.length, previousSamePeriod: somaTotais(mesmoPeriodoAnterior) },
    averageTicket90d: recentes.length ? texto(soma(recentes.map((p) => dec(p.total))) / BigInt(recentes.length), 2) : "0.00",
    monthly: meses,
    topItems,
    origins: origens,
  };
}

/**
 * Preço pago por item ao longo do tempo, por unidade de venda. Média ponderada pela
 * quantidade — média simples de preço engana quando uma compra é dez vezes maior.
 */
export function historicoDePrecos(pedidos: PedidoCliente[]) {
  type Acumulado = {
    itemCode: string;
    description: string;
    unit: string;
    uomEntry: number;
    quantity: Dec;
    total: Dec;
    purchases: number;
    points: { date: string; price: string; quantity: string; docNum: number }[];
  };
  const porItem = new Map<string, Acumulado>();
  for (const p of pedidos.filter((x) => x.tipo === "ORDER" && conta(x))) {
    for (const l of p.linhas) {
      const chave = `${l.itemCode}:${l.uomEntry}`;
      const atual = porItem.get(chave) ?? { itemCode: l.itemCode, description: l.descricao, unit: l.unidade, uomEntry: l.uomEntry, quantity: 0n, total: 0n, purchases: 0, points: [] };
      atual.quantity += dec(l.quantidade);
      atual.total += dec(l.total);
      atual.purchases += 1;
      atual.points.push({ date: p.data, price: l.precoUnitario, quantity: l.quantidade, docNum: p.docNum });
      porItem.set(chave, atual);
    }
  }
  return [...porItem.values()]
    .sort((x, y) => (y.total > x.total ? 1 : y.total < x.total ? -1 : 0))
    .map((i) => {
      const pontos = [...i.points].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
      const precos = pontos.map((pt) => dec(pt.price));
      const ultimo = pontos.at(-1)!;
      const media = i.quantity > 0n ? (i.total * 1_000_000n) / i.quantity : 0n;
      return {
        itemCode: i.itemCode,
        description: i.description,
        unit: i.unit,
        uomEntry: i.uomEntry,
        quantity: texto(i.quantity, 3),
        orders: i.purchases,
        total: texto(i.total, 2),
        lastPrice: ultimo.price,
        lastDate: ultimo.date,
        averagePrice: texto(media, 2),
        minPrice: texto(precos.reduce((x, y) => (y < x ? y : x)), 2),
        maxPrice: texto(precos.reduce((x, y) => (y > x ? y : x)), 2),
        points: pontos,
      };
    });
}

function somarDias(data: string, dias: number) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
