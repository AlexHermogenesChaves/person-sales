import { erro, type ErroDeCampo } from "./erros.js";

// Validação estrita de DTO: campo desconhecido é erro, não é ignorado.

export function objetoComChaves(
  valor: unknown,
  obrigatorias: string[],
  opcionais: string[] = [],
  caminho = "",
): Record<string, unknown> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    throw erro.schema([{ campo: caminho || "corpo", mensagem: "Esperado um objeto." }]);
  }
  const obj = valor as Record<string, unknown>;
  const permitidas = new Set([...obrigatorias, ...opcionais]);
  const problemas: ErroDeCampo[] = [];
  for (const chave of Object.keys(obj)) {
    if (!permitidas.has(chave)) problemas.push({ campo: junta(caminho, chave), mensagem: "Campo não permitido." });
  }
  for (const chave of obrigatorias) {
    if (obj[chave] === undefined) problemas.push({ campo: junta(caminho, chave), mensagem: "Campo obrigatório." });
  }
  if (problemas.length) throw erro.schema(problemas);
  return obj;
}

export function textoLimitado(valor: unknown, campo: string, max: number, padrao?: RegExp): string {
  if (typeof valor !== "string" || valor.length > max || (padrao && !padrao.test(valor))) {
    throw erro.schema([{ campo, mensagem: `Texto inválido (máximo ${max} caracteres).` }]);
  }
  return valor;
}

export function inteiroPositivo(valor: unknown, campo: string): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor <= 0) {
    throw erro.schema([{ campo, mensagem: "Número inteiro positivo esperado." }]);
  }
  return valor;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ehUuid = (valor: unknown): valor is string => typeof valor === "string" && UUID.test(valor);

const junta = (caminho: string, chave: string) => (caminho ? `${caminho}.${chave}` : chave);

/** Data comercial de hoje no fuso da operação — não muda de dia por UTC. */
export function hojeComercial(agora: Date, fuso = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function dataValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(`${texto}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}
