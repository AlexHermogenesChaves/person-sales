// Decimal exato em BigInt com 6 casas. Quantidade e valor nunca passam por float:
// o contrato trafega strings ("25.90") e o cálculo é feito aqui.

const ESCALA = 6;
const FATOR = 10n ** BigInt(ESCALA);

export type Dec = bigint;

const FORMATO = /^(0|[1-9]\d{0,11})(\.\d+)?$/;

/** Lê string decimal com ponto. Recusa sinal, expoente, NaN e casas além de `maxCasas`. */
export function lerDecimal(texto: unknown, maxCasas: number): Dec | null {
  if (typeof texto !== "string" || !FORMATO.test(texto)) return null;
  const [inteiro, fracao = ""] = texto.split(".");
  const casas = fracao.replace(/^\./, "");
  if (texto.includes(".") && casas.length === 0) return null;
  if (casas.length > maxCasas) return null;
  return BigInt(inteiro) * FATOR + BigInt(casas.padEnd(ESCALA, "0"));
}

export function dec(texto: string): Dec {
  const valor = lerDecimal(texto, ESCALA);
  if (valor === null) throw new Error(`decimal inválido: ${texto}`);
  return valor;
}

/** Arredonda meio para cima na casa pedida (padrão do SAP B1 para preço e total). */
export function arredondar(valor: Dec, casas: number): Dec {
  const passo = 10n ** BigInt(ESCALA - casas);
  const resto = valor % passo;
  const base = valor - resto;
  return resto * 2n >= passo ? base + passo : base;
}

export function mul(a: Dec, b: Dec): Dec {
  const bruto = a * b;
  const resto = bruto % FATOR;
  const base = bruto / FATOR;
  return resto * 2n >= FATOR ? base + 1n : base;
}

export function soma(valores: Dec[]): Dec {
  return valores.reduce((acc, v) => acc + v, 0n);
}

export function texto(valor: Dec, casas: number): string {
  const arred = arredondar(valor, casas);
  const inteiro = arred / FATOR;
  const fracao = (arred % FATOR).toString().padStart(ESCALA, "0").slice(0, casas);
  return casas === 0 ? inteiro.toString() : `${inteiro}.${fracao}`;
}

/** `valor` é múltiplo exato de `passo`? (quantidade em múltiplos permitidos) */
export function ehMultiplo(valor: Dec, passo: Dec): boolean {
  return passo > 0n && valor % passo === 0n;
}

export const ZERO: Dec = 0n;
