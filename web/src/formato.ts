// O contrato trafega decimal em string com ponto; aqui só se formata para leitura.

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

export const brl = (valor: string | null | undefined) => (valor == null ? "—" : moeda.format(Number(valor)));
export const qtd = (valor: string) => numero.format(Number(valor));

export const dataBr = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

export const dataHoraBr = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function haQuanto(iso: string, agora = Date.now()) {
  const min = Math.round((agora - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

/** Data local (fuso do navegador) no formato YYYY-MM-DD, com deslocamento em dias. */
export function dataLocal(dias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Soma decimal exata em centavos para o resumo do carrinho (valor de referência). */
export function somaReferencia(linhas: { quantity: string; refPrice: string | null }[]) {
  let centavos = 0n;
  for (const l of linhas) {
    if (!l.refPrice) continue;
    const [qi, qf = ""] = l.quantity.split(".");
    const q = BigInt(qi) * 1000n + BigInt(qf.padEnd(3, "0").slice(0, 3));
    const [pi, pf = ""] = l.refPrice.split(".");
    const p = BigInt(pi) * 100n + BigInt(pf.padEnd(2, "0").slice(0, 2));
    centavos += (q * p + 500n) / 1000n;
  }
  return `${centavos / 100n}.${String(centavos % 100n).padStart(2, "0")}`;
}

/** Quantidade digitada em pt-BR ("1,5") para o formato do contrato ("1.5"). */
export function normalizarQuantidade(texto: string): string | null {
  const limpo = texto.trim().replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(limpo)) return null;
  const n = limpo.replace(/^0+(?=\d)/, "");
  return Number(n) > 0 ? n : null;
}
