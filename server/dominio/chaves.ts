import { hmac } from "@noble/hashes/hmac";
import { sha256 as sha256Bytes } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

// Chaves conforme o step 01: SHA-256 de uma tupla serializada como array JSON
// (inequívoca, sem concatenação), hash completo de 64 hex guardado para detectar
// colisão e os primeiros 40 hex como Code da UDT.
//
// Sem node:crypto de propósito: o mesmo código roda no Node e no navegador (versão
// estática da demonstração). @noble/hashes é síncrono nos dois lados.

export function sha256(texto: string): string {
  return bytesToHex(sha256Bytes(utf8ToBytes(texto)));
}

export function hashTupla(partes: string[]): string {
  return sha256(JSON.stringify(partes));
}

export const codeDaUdt = (hashCompleto: string) => hashCompleto.slice(0, 40);

export function identityHash(issuer: string, sub: string): string {
  return hashTupla([issuer, sub]);
}

export function chaveEnvio(empresa: string, cardCode: string, operationId: string): string {
  return hashTupla([empresa, cardCode, operationId]);
}

/** JSON com chaves ordenadas: o mesmo conteúdo dá sempre o mesmo hash. */
export function jsonCanonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;
  if (valor && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${jsonCanonico(v)}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

const assinatura = (corpo: string, segredo: string) => hmac(sha256Bytes, utf8ToBytes(segredo), utf8ToBytes(corpo));

export function assinar(conteudo: unknown, segredo: string): string {
  const corpo = paraBase64Url(utf8ToBytes(JSON.stringify(conteudo)));
  return `${corpo}.${paraBase64Url(assinatura(corpo, segredo))}`;
}

/** Devolve o conteúdo se a assinatura confere; `null` para qualquer adulteração. */
export function verificar(token: unknown, segredo: string): unknown | null {
  if (typeof token !== "string" || token.length > 64_000) return null;
  const [corpo, recebidaTexto, sobra] = token.split(".");
  if (!corpo || !recebidaTexto || sobra !== undefined) return null;
  const esperada = assinatura(corpo, segredo);
  const recebida = deBase64Url(recebidaTexto);
  if (!recebida || !iguaisEmTempoConstante(recebida, esperada)) return null;
  try {
    const bytes = deBase64Url(corpo);
    return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  } catch {
    return null;
  }
}

function iguaisEmTempoConstante(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  return diferenca === 0;
}

export function paraBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deBase64Url(texto: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(texto)) return null;
  try {
    const binario = atob(texto.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binario, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Identificador aleatório opaco (sessão, CSRF). Web Crypto: existe no Node 22 e no navegador. */
export function idAleatorio(bytes = 32): string {
  return paraBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

export const novoUuid = () => globalThis.crypto.randomUUID();
