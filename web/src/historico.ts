import { api, type ItemCatalogo } from "./api";
import { adicionar } from "./estado";
import { ir } from "./rotas";

// Tipos e ações do histórico do cliente (página inicial, painel do pedido, itens e preços).

export type Situacao = "AGUARDANDO_APROVACAO" | "APROVADO" | "PARCIAL" | "FATURADO" | "CANCELADO";

export type LinhaPedido = {
  itemCode: string;
  description: string;
  quantity: string;
  invoicedQuantity: string;
  pendingQuantity: string;
  uomEntry: number;
  unit: string;
  unitPrice: string;
  lineTotal: string;
};

export type Pedido = {
  type: "ORDER" | "DRAFT";
  docEntry: number;
  docNum: number;
  date: string;
  expectedDate: string;
  total: string;
  invoiced: string;
  pending: string;
  status: Situacao;
  origin: "PORTAL" | "VENDEDOR" | "EDI";
  customerReference: string;
  operationId: string | null;
  milestones: { sent: string; approved: string | null; invoiced: string | null; completed: string | null };
  lines: LinhaPedido[];
};

export type HistoricoItem = {
  itemCode: string;
  description: string;
  unit: string;
  uomEntry: number;
  quantity: string;
  orders: number;
  total: string;
  lastPrice: string;
  lastDate: string;
  averagePrice: string;
  minPrice: string;
  maxPrice: string;
  points: { date: string; price: string; quantity: string; docNum: number }[];
};

export const SITUACAO: Record<Situacao, { rotulo: string; tom: "neutral" | "info" | "ok" | "warn" | "danger" }> = {
  AGUARDANDO_APROVACAO: { rotulo: "Aguardando aprovação", tom: "warn" },
  APROVADO: { rotulo: "Aprovado", tom: "info" },
  PARCIAL: { rotulo: "Parcialmente faturado", tom: "info" },
  FATURADO: { rotulo: "Faturado", tom: "ok" },
  CANCELADO: { rotulo: "Cancelado", tom: "neutral" },
};

export const ORIGEM = { PORTAL: "Portal", VENDEDOR: "Vendedor", EDI: "EDI" } as const;

export const emAberto = (p: Pedido) => p.status === "APROVADO" || p.status === "PARCIAL";
export const previsaoVencida = (p: Pedido, hoje: string) => emAberto(p) && p.expectedDate < hoje;

/**
 * Comprar de novo: o item volta para o carrinho com o preço de hoje, consultado no
 * catálogo — nunca o preço antigo. Devolve os códigos que não estão mais liberados.
 */
export async function comprarDeNovo(linhas: { itemCode: string; uomEntry: number; quantity: string }[]): Promise<{ fora: string[] }> {
  const respostas = await Promise.all(
    [...new Set(linhas.map((l) => l.itemCode))].map((c) => api<{ items: ItemCatalogo[] }>(`/api/v1/catalog?search=${encodeURIComponent(c)}&pageSize=5`)),
  );
  const catalogo = new Map(respostas.flatMap((r) => r.dados.items).map((i) => [i.itemCode, i]));
  const fora: string[] = [];
  for (const l of linhas) {
    const item = catalogo.get(l.itemCode);
    const unidade = item?.units.find((u) => u.entry === l.uomEntry);
    if (!item || !unidade) {
      fora.push(l.itemCode);
      continue;
    }
    adicionar({
      itemCode: item.itemCode,
      description: item.description,
      uomEntry: unidade.entry,
      unit: unidade.label,
      multiple: unidade.multiple,
      quantity: l.quantity,
      refPrice: unidade.referenceUnitPrice,
      imagem: item.imageUrl,
    });
  }
  if (fora.length < linhas.length) {
    if (fora.length) {
      try {
        sessionStorage.setItem("portal:aviso-repetir", `${fora.join(", ")} não está mais no catálogo e ficou de fora.`);
      } catch {
        /* sem storage: o aviso se perde, o carrinho não */
      }
    }
    ir({ tela: "carrinho" });
  }
  return { fora };
}
