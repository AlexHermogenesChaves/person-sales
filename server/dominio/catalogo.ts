import { deBase64Url, paraBase64Url } from "./chaves.js";
import { erro } from "./erros.js";
import { SapIndeterminado, SapIndisponivel, type ItemSap, type SapGateway } from "../sap/tipos.js";
import type { Contexto } from "./revisao.js";

// Peças da API que não dependem de framework: usadas pelo Express (server/app.ts) e
// pela versão estática da demonstração, que roda no navegador (web/src/demo).

const CODIGO_ITEM = /^[A-Za-z0-9._-]{1,50}$/;

export type ConsultaCatalogo = { search: string; pageSize: number; cursor: string | null };

/** Só search, pageSize e cursor; nada de $filter ou parâmetro OData livre. */
export function lerConsultaCatalogo(query: Record<string, unknown>): ConsultaCatalogo {
  const permitidas = new Set(["search", "pageSize", "cursor"]);
  for (const chave of Object.keys(query)) {
    if (!permitidas.has(chave)) throw erro.schema([{ campo: chave, mensagem: "Parâmetro não permitido." }]);
  }
  const search = typeof query.search === "string" ? query.search : "";
  if (search.length > 60) throw erro.schema([{ campo: "search", mensagem: "Busca com até 60 caracteres." }]);
  const pageSize = query.pageSize === undefined ? 20 : Number(query.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw erro.schema([{ campo: "pageSize", mensagem: "Entre 1 e 50." }]);
  let cursor: string | null = null;
  if (typeof query.cursor === "string" && query.cursor) {
    const bytes = deBase64Url(query.cursor);
    cursor = bytes ? new TextDecoder().decode(bytes) : "";
    if (!CODIGO_ITEM.test(cursor)) throw erro.schema([{ campo: "cursor", mensagem: "Cursor inválido." }]);
  }
  return { search, pageSize, cursor };
}

/** Página do catálogo com o preço do cliente autenticado, no DTO do contrato. */
export async function montarCatalogo(sap: SapGateway, ctx: Contexto, { search, pageSize, cursor }: ConsultaCatalogo) {
  const encontrados = await sap.listarItens({ busca: search, depoisDe: cursor, limite: pageSize + 1 });
  const pagina = encontrados.slice(0, pageSize);
  const consultas = pagina.flatMap((i) => i.unidades.map((u) => ({ itemCode: i.itemCode, uomEntry: u.entry, quantidade: u.multiplo })));
  const precos = consultas.length ? await sap.precos(ctx.cardCode, new Date().toISOString().slice(0, 10), consultas) : [];
  const precoDe = (item: ItemSap, entry: number) => precos.find((p) => p.itemCode === item.itemCode && p.uomEntry === entry);
  return {
    items: pagina.map((i) => ({
      itemCode: i.itemCode,
      description: i.descricao,
      group: i.grupo,
      units: i.unidades.map((u) => ({
        entry: u.entry,
        label: u.codigo,
        description: u.descricao,
        multiple: u.multiplo,
        referenceUnitPrice: precoDe(i, u.entry)?.precoUnitario ?? null,
        priceOrigin: precoDe(i, u.entry)?.origem ?? null,
      })),
      currency: "BRL",
      availability: i.disponibilidade === "DISPONIVEL" ? "AVAILABLE" : "ON_REQUEST",
      priceRequiresReview: i.precoPorQuantidade,
      imageUrl: i.imagem,
    })),
    nextCursor: encontrados.length > pageSize ? paraBase64Url(new TextEncoder().encode(pagina.at(-1)!.itemCode)) : null,
  };
}

/** RF08: o vínculo é conferido no SAP a cada operação comercial, não só no login. */
export async function resolverVinculo(sap: SapGateway, empresa: string, identityHash: string, code: string) {
  let acesso, cliente;
  try {
    acesso = await sap.buscarAcesso(code);
    if (!acesso || acesso.identityHash !== identityHash) throw erro.semVinculo();
    if (!acesso.ativo) throw erro.bloqueado();
    cliente = await sap.buscarCliente(acesso.cardCode);
  } catch (e) {
    if (e instanceof SapIndisponivel || e instanceof SapIndeterminado) throw erro.sapFora();
    throw e;
  }
  if (!cliente || !cliente.ativo || !cliente.habilitadoPortal) throw erro.semVinculo();
  return { empresa, identityHash, cardCode: cliente.cardCode, clienteNome: cliente.nome };
}

export const enderecosDto = (enderecos: Awaited<ReturnType<SapGateway["listarEnderecos"]>>) => ({
  addresses: enderecos.map((e) => ({ code: e.codigo, street: e.logradouro, district: e.bairro, city: e.cidade, state: e.uf, zip: e.cep })),
});
