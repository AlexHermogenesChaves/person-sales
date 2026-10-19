import { useSyncExternalStore } from "react";
import type { Revisao } from "./api";

// Estado do comprador. Carrinho e protocolo pendente vão para o sessionStorage,
// separados por cliente + usuário, com versão de schema. Nada aqui é confiável para
// o servidor: a revisão recalcula tudo. O token de revisão fica só em memória.

export type LinhaCarrinho = {
  itemCode: string;
  description: string;
  uomEntry: number;
  unit: string;
  multiple: string;
  quantity: string;
  refPrice: string | null;
  imagem?: string | null;
};

export type Entrega = {
  shipToCode: string;
  requestedDate: string;
  customerReference: string;
  comments: string;
};

type Estado = {
  linhas: LinhaCarrinho[];
  entrega: Entrega;
  revisao: Revisao | null;
  pendente: string | null;
};

const VERSAO = "v1";
const vazio = (): Estado => ({
  linhas: [],
  entrega: { shipToCode: "", requestedDate: "", customerReference: "", comments: "" },
  revisao: null,
  pendente: null,
});

let estado: Estado = vazio();
let dono = "";
const ouvintes = new Set<() => void>();

const chave = (tipo: string) => `portal:${VERSAO}:${tipo}:${dono}`;

function ler<T>(tipo: string): T | null {
  try {
    const bruto = sessionStorage.getItem(chave(tipo));
    return bruto ? (JSON.parse(bruto) as T) : null;
  } catch {
    return null;
  }
}

function gravar(tipo: string, valor: unknown) {
  try {
    if (valor === null) sessionStorage.removeItem(chave(tipo));
    else sessionStorage.setItem(chave(tipo), JSON.stringify(valor));
  } catch {
    /* modo privado ou cota cheia: o carrinho segue só em memória */
  }
}

function mudar(novo: Estado) {
  estado = novo;
  gravar("carrinho", { linhas: estado.linhas, entrega: estado.entrega });
  gravar("pendente", estado.pendente);
  ouvintes.forEach((o) => o());
}

/** Troca de identidade ou cliente: carrega o carrinho dele, nunca o de outro. */
export function abrirCarrinho(customerCode: string, email: string) {
  dono = `${customerCode}:${email}`;
  const salvo = ler<{ linhas: LinhaCarrinho[]; entrega: Entrega }>("carrinho");
  const linhas = Array.isArray(salvo?.linhas) ? salvo.linhas.filter(linhaValida).slice(0, 100) : [];
  estado = { ...vazio(), linhas, entrega: { ...vazio().entrega, ...(salvo?.entrega ?? {}) }, pendente: ler<string>("pendente") };
  ouvintes.forEach((o) => o());
}

export function fecharCarrinho() {
  gravar("carrinho", null);
  gravar("pendente", null);
  dono = "";
  estado = vazio();
  ouvintes.forEach((o) => o());
}

const linhaValida = (l: LinhaCarrinho) =>
  l && typeof l.itemCode === "string" && typeof l.quantity === "string" && Number.isInteger(l.uomEntry);

// Qualquer edição invalida a revisão: o aceite valia para outro conteúdo.

export function adicionar(linha: LinhaCarrinho) {
  const existe = estado.linhas.find((l) => l.itemCode === linha.itemCode && l.uomEntry === linha.uomEntry);
  const linhas = existe
    ? estado.linhas.map((l) => (l === existe ? { ...l, quantity: somar(l.quantity, linha.quantity) } : l))
    : [...estado.linhas, linha];
  mudar({ ...estado, linhas, revisao: null });
}

export function alterarQuantidade(itemCode: string, uomEntry: number, quantity: string) {
  mudar({ ...estado, linhas: estado.linhas.map((l) => (l.itemCode === itemCode && l.uomEntry === uomEntry ? { ...l, quantity } : l)), revisao: null });
}

export function remover(itemCode: string, uomEntry: number) {
  mudar({ ...estado, linhas: estado.linhas.filter((l) => !(l.itemCode === itemCode && l.uomEntry === uomEntry)), revisao: null });
}

export function alterarEntrega(parcial: Partial<Entrega>) {
  mudar({ ...estado, entrega: { ...estado.entrega, ...parcial }, revisao: null });
}

export function guardarRevisao(revisao: Revisao | null) {
  mudar({ ...estado, revisao });
}

/** Grava o protocolo ANTES de enviar: um reload no meio consulta, não reenvia. */
export function marcarPendente(operationId: string | null) {
  mudar({ ...estado, pendente: operationId });
}

export function concluirPedido() {
  mudar({ ...vazio(), entrega: { ...vazio().entrega, shipToCode: estado.entrega.shipToCode } });
}

export function useCarrinho() {
  return useSyncExternalStore(
    (ouvinte) => {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
    () => estado,
  );
}

function somar(a: string, b: string) {
  const casas = Math.max((a.split(".")[1] ?? "").length, (b.split(".")[1] ?? "").length);
  const f = 10 ** casas;
  return String((Math.round(Number(a) * f) + Math.round(Number(b) * f)) / f);
}
