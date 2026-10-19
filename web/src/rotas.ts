import { useSyncExternalStore } from "react";

// Roteamento por hash: seis telas não justificam uma dependência.

export type Rota =
  | { tela: "inicio" }
  | { tela: "itens" }
  | { tela: "catalogo" }
  | { tela: "carrinho" }
  | { tela: "revisao" }
  | { tela: "protocolo"; operationId: string };

export function lerRota(hash = window.location.hash): Rota {
  const [, tela, id] = hash.replace(/^#/, "").split("/");
  if (tela === "itens") return { tela: "itens" };
  if (tela === "catalogo") return { tela: "catalogo" };
  if (tela === "carrinho") return { tela: "carrinho" };
  if (tela === "revisao") return { tela: "revisao" };
  if (tela === "protocolo" && id) return { tela: "protocolo", operationId: id };
  return { tela: "inicio" };
}

export function ir(rota: Rota) {
  window.location.hash = rota.tela === "protocolo" ? `/protocolo/${rota.operationId}` : `/${rota.tela}`;
}

const assinar = (fn: () => void) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};

export function useRota(): Rota {
  const hash = useSyncExternalStore(assinar, () => window.location.hash);
  return lerRota(hash);
}
