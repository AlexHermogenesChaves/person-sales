import { useSyncExternalStore } from "react";

// Três estados: sistema (padrão, segue o SO ao vivo), claro e escuro. A escolha
// explícita vai para o localStorage e ganha do sistema. `tema.js` aplica antes do
// React; aqui só se lê e troca.

export type Tema = "sistema" | "claro" | "escuro";

const CHAVE = "portal.tema";
const ouvintes = new Set<() => void>();
const consulta = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function ler(): Tema {
  try {
    const t = localStorage.getItem(CHAVE);
    return t === "claro" || t === "escuro" ? t : "sistema";
  } catch {
    return "sistema";
  }
}

let atual: Tema = ler();

export function definirTema(tema: Tema) {
  atual = tema;
  try {
    if (tema === "sistema") localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, tema);
  } catch {
    /* sem storage: vale só nesta aba */
  }
  if (tema === "sistema") document.documentElement.removeAttribute("data-tema");
  else document.documentElement.setAttribute("data-tema", tema);
  ouvintes.forEach((o) => o());
}

const PROXIMO: Record<Tema, Tema> = { sistema: "claro", claro: "escuro", escuro: "sistema" };
export const proximoTema = (t: Tema) => PROXIMO[t];

export function useTema() {
  const tema = useSyncExternalStore(
    (o) => {
      ouvintes.add(o);
      return () => ouvintes.delete(o);
    },
    () => atual,
  );
  const sistemaEscuro = useSyncExternalStore(
    (o) => {
      consulta?.addEventListener("change", o);
      return () => consulta?.removeEventListener("change", o);
    },
    () => consulta?.matches ?? false,
  );
  return { tema, escuro: tema === "escuro" || (tema === "sistema" && sistemaEscuro) };
}
