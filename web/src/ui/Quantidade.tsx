import { useSyncExternalStore } from "react";
import { normalizarQuantidade, qtd } from "../formato";

// Seletor de quantidade com − e +: no celular, digitar número é o gesto mais caro.
// Os botões andam no múltiplo de venda; o campo continua digitável.

const mil = (s: string) => {
  const [i, f = ""] = s.split(".");
  return BigInt(i) * 1000n + BigInt(f.padEnd(3, "0").slice(0, 3));
};
const deMil = (v: bigint) => {
  const i = v / 1000n;
  const f = (v % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return f ? `${i}.${f}` : `${i}`;
};

export function Quantidade({
  valor,
  multiplo,
  rotulo,
  invalida,
  onChange,
  onEnter,
}: {
  valor: string;
  multiplo: string;
  rotulo: string;
  invalida?: boolean;
  onChange: (texto: string) => void;
  onEnter?: () => void;
}) {
  const passo = mil(multiplo) || 1000n;
  const atual = normalizarQuantidade(valor);
  const passar = (sinal: 1n | -1n) => {
    const base = atual ? mil(atual) : 0n;
    // Volta para o múltiplo mais próximo antes de somar: "7" com múltiplo 6 vira 6 ou 12.
    const alinhado = sinal > 0n ? (base / passo) * passo + passo : ((base + passo - 1n) / passo) * passo - passo;
    const novo = alinhado < passo ? passo : alinhado;
    onChange(qtd(deMil(novo)));
  };
  return (
    <span className={invalida ? "pt-qtd-passo is-invalida" : "pt-qtd-passo"}>
      <button type="button" onClick={() => passar(-1n)} aria-label={`Diminuir ${rotulo}`} disabled={!atual || mil(atual) <= passo}>
        −
      </button>
      <input
        className="nh-num"
        inputMode="decimal"
        aria-label={`Quantidade de ${rotulo}`}
        aria-invalid={invalida || undefined}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      />
      <button type="button" onClick={() => passar(1n)} aria-label={`Aumentar ${rotulo}`}>
        +
      </button>
    </span>
  );
}

const consulta = typeof window !== "undefined" ? window.matchMedia("(max-width: 760px)") : null;

/** Tela estreita (celular): troca tabela por cartões. Acompanha a rotação ao vivo. */
export function useEstreito() {
  return useSyncExternalStore(
    (o) => {
      consulta?.addEventListener("change", o);
      return () => consulta?.removeEventListener("change", o);
    },
    () => consulta?.matches ?? false,
  );
}
