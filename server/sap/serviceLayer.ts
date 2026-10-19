// Adaptador real para a Service Layer do SAP Business One.
//
// ATENÇÃO: escrito contra a API Reference 10.0, NÃO exercitado em base real. É o
// ponto de partida do step 01: cada item marcado "confirmar" precisa ser conferido
// no `$metadata` da instalação antes de valer (D02, D08, D09, D11, D13).
//
// Regras que este arquivo segue e não pode perder:
// - nenhuma escrita é repetida: POST Orders e POST na UDT têm uma tentativa só;
// - falha depois de a requisição sair é "indeterminado", não "não aconteceu";
// - -2028 no POST Orders NÃO prova aprovação (o mesmo código é "nenhum registro"):
//   só o rascunho encontrado por U_PRT_ID prova.

import {
  SapIndeterminado,
  SapIndisponivel,
  SapRecusa,
  type Acesso,
  type Cliente,
  type ConsultaPreco,
  type DocumentoPortal,
  type Endereco,
  type ItemSap,
  type PedidoSap,
  type PrecoEfetivo,
  type PreviaPedido,
  type Reserva,
  type SapGateway,
} from "./tipos.js";

export type ConfigServiceLayer = {
  url: string;
  empresa: string;
  usuario: string;
  senha: string;
  /** Série, filial, depósito e utilização vêm da configuração, nunca do navegador (D12). */
  serie?: number;
  filial?: number;
  deposito?: string;
  utilizacao?: number;
  timeoutMs?: number;
};

type Resposta = { status: number; corpo: any };

const ERROS_DE_CONEXAO = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID"]);

export class ServiceLayer implements SapGateway {
  readonly modo = "service-layer" as const;
  private cookie: string | null = null;
  private readonly base: string;

  constructor(private readonly config: ConfigServiceLayer) {
    this.base = config.url.replace(/\/+$/, "");
  }

  // ---- Leituras ------------------------------------------------------------------

  async buscarAcesso(code: string): Promise<Acesso | null> {
    const r = await this.ler(`U_PRT_ACCESS('${esc(code)}')`);
    if (!r) return null;
    return { code: r.Code, identityHash: r.U_IdentityHash, cardCode: r.U_CardCode, ativo: r.U_Active === "Y" };
  }

  async buscarCliente(cardCode: string): Promise<Cliente | null> {
    const r = await this.ler(`BusinessPartners('${esc(cardCode)}')?$select=CardCode,CardName,Valid,Frozen,U_PRT_WEB`);
    if (!r) return null;
    return {
      cardCode: r.CardCode,
      nome: r.CardName,
      ativo: r.Valid !== "tNO" && r.Frozen !== "tYES",
      habilitadoPortal: r.U_PRT_WEB === "Y",
    };
  }

  async listarItens({ busca, depoisDe, limite }: { busca: string; depoisDe: string | null; limite: number }) {
    const filtros = ["SalesItem eq 'tYES'", "Valid eq 'tYES'", "Frozen eq 'tNO'", "U_PRT_WEB eq 'Y'"];
    const termo = busca.trim();
    if (termo) filtros.push(`(contains(ItemCode,'${esc(termo)}') or contains(ItemName,'${esc(termo)}'))`);
    if (depoisDe) filtros.push(`ItemCode gt '${esc(depoisDe)}'`);
    const r = await this.ler(`Items?$select=${CAMPOS_ITEM}&$filter=${encodeURIComponent(filtros.join(" and "))}&$orderby=ItemCode&$top=${limite}`);
    return (r?.value ?? []).map(paraItem);
  }

  async buscarItens(codigos: string[]): Promise<ItemSap[]> {
    const itens: ItemSap[] = [];
    for (let i = 0; i < codigos.length; i += 20) {
      const filtro = codigos.slice(i, i + 20).map((c) => `ItemCode eq '${esc(c)}'`).join(" or ");
      const r = await this.ler(`Items?$select=${CAMPOS_ITEM}&$filter=${encodeURIComponent(filtro)}&$top=20`);
      itens.push(...(r?.value ?? []).map(paraItem));
    }
    return itens;
  }

  /** Confirmar (D08): CompanyService_GetItemPrice reproduz preço especial e faixa por quantidade? */
  async precos(cardCode: string, data: string, consultas: ConsultaPreco[]): Promise<PrecoEfetivo[]> {
    const precos: PrecoEfetivo[] = [];
    for (const c of consultas) {
      const r = await this.escreverLeitura("CompanyService_GetItemPrice", {
        ItemPriceParams: { CardCode: cardCode, ItemCode: c.itemCode, Date: data, UoMEntry: c.uomEntry, UoMQuantity: Number(c.quantidade) },
      });
      precos.push({ ...c, precoUnitario: numero(r.Price, 2), origem: Number(r.Discount ?? 0) > 0 ? "ESPECIAL" : "LISTA" });
    }
    return precos;
  }

  async listarEnderecos(cardCode: string): Promise<Endereco[]> {
    const r = await this.ler(`BusinessPartners('${esc(cardCode)}')?$select=BPAddresses`);
    return (r?.BPAddresses ?? [])
      .filter((a: any) => a.AddressType === "bo_ShipTo")
      .map((a: any) => ({
        codigo: a.AddressName,
        logradouro: [a.Street, a.StreetNo].filter(Boolean).join(", "),
        bairro: a.Block ?? "",
        cidade: a.City ?? "",
        uf: a.State ?? "",
        cep: a.ZipCode ?? "",
      }));
  }

  /** Confirmar (D09/D11): OrdersService_Preview e GetApprovalTemplates na versão instalada. */
  async preverPedido(pedido: PedidoSap): Promise<PreviaPedido> {
    const documento = this.montarDocumento(pedido);
    let caiEmAprovacao = false;
    try {
      const modelos = await this.escreverLeitura("OrdersService_GetApprovalTemplates", { Document: documento });
      caiEmAprovacao = Array.isArray(modelos?.value) ? modelos.value.length > 0 : Boolean(modelos);
    } catch (e) {
      if (!(e instanceof SapRecusa)) throw e;
    }
    try {
      const doc = await this.escreverLeitura("OrdersService_Preview", { Document: documento });
      const linhas = (doc.DocumentLines ?? []).map((l: any, i: number) => ({
        itemCode: pedido.linhas[i]?.itemCode ?? l.ItemCode,
        uomEntry: pedido.linhas[i]?.uomEntry ?? l.UoMEntry,
        totalLinha: numero(l.LineTotal, 2),
        imposto: numero(l.TaxTotal ?? 0, 2),
      }));
      const subtotal = linhas.reduce((s: number, l: { totalLinha: string }) => s + Number(l.totalLinha), 0);
      return {
        linhas,
        subtotal: numero(subtotal, 2),
        impostos: numero(doc.VatSum ?? 0, 2),
        despesas: numero((doc.DocTotal ?? 0) - subtotal - (doc.VatSum ?? 0), 2),
        total: numero(doc.DocTotal, 2),
        totaisFinais: true,
        caiEmAprovacao,
      };
    } catch (e) {
      if (!(e instanceof SapRecusa)) throw e;
      // Sem prévia confiável: subtotal informado, encargos pendentes (contrato §Revisão).
      const linhas = pedido.linhas.map((l) => ({
        itemCode: l.itemCode,
        uomEntry: l.uomEntry,
        totalLinha: numero(Number(l.quantidade) * Number(l.precoUnitario), 2),
        imposto: "0.00",
      }));
      return {
        linhas,
        subtotal: numero(linhas.reduce((s, l) => s + Number(l.totalLinha), 0), 2),
        impostos: null,
        despesas: null,
        total: null,
        totaisFinais: false,
        caiEmAprovacao,
      };
    }
  }

  // ---- Controle de envio (UDT @PRT_REQUEST) ------------------------------------------

  /** Confirmar (D06): código de chave duplicada na UDT. -2035 é o esperado. */
  async criarReserva(reserva: Reserva): Promise<"CRIADA" | "JA_EXISTE"> {
    try {
      await this.escrever("POST", "U_PRT_REQUEST", { Code: reserva.code, Name: reserva.operationId, ...paraUdt(reserva) });
      return "CRIADA";
    } catch (e) {
      if (e instanceof SapRecusa && (e.codigo === "-2035" || /already exists/i.test(e.message))) return "JA_EXISTE";
      throw e;
    }
  }

  async lerReserva(code: string): Promise<Reserva | null> {
    const r = await this.ler(`U_PRT_REQUEST('${esc(code)}')`);
    if (!r) return null;
    return {
      code: r.Code,
      keyHash: r.U_KeyHash,
      operationId: r.U_OperationId,
      cardCode: r.U_CardCode,
      actorHash: r.U_ActorHash,
      payloadHash: r.U_PayloadHash,
      estado: r.U_State,
      criadoUtc: r.U_CreatedUtc,
      atualizadoUtc: r.U_UpdatedUtc,
      correlation: r.U_Correlation,
      docType: r.U_DocType || null,
      docEntry: r.U_DocEntry ? Number(r.U_DocEntry) : null,
      docNum: r.U_DocNum ? Number(r.U_DocNum) : null,
      erro: r.U_ErrorCode || null,
    };
  }

  async atualizarReserva(code: string, mudanca: Partial<Reserva>) {
    await this.escrever("PATCH", `U_PRT_REQUEST('${esc(code)}')`, paraUdt({ ...mudanca, atualizadoUtc: new Date().toISOString() }));
  }

  // ---- Pedido ---------------------------------------------------------------------------

  async criarPedido(pedido: PedidoSap): Promise<DocumentoPortal> {
    try {
      const r = await this.escrever("POST", "Orders", this.montarDocumento(pedido));
      return {
        tipo: "ORDER",
        docEntry: r.DocEntry,
        docNum: r.DocNum,
        cardCode: pedido.cardCode,
        portalId: pedido.portalId ?? "",
        portalHash: pedido.portalHash ?? "",
        total: numero(r.DocTotal, 2),
      };
    } catch (e) {
      if (!(e instanceof SapRecusa) || e.codigo !== "-2028") throw e;
      // Aprovação: o SAP criou o rascunho e devolveu -2028. Só o rascunho prova.
      const rascunhos = (await this.buscarDocumentosPortal(pedido.cardCode, pedido.portalId ?? "")).filter((d) => d.tipo === "DRAFT");
      if (rascunhos.length === 1) return rascunhos[0];
      throw new SapIndeterminado("Orders devolveu -2028 sem rascunho localizável.");
    }
  }

  async buscarDocumentosPortal(cardCode: string, portalId: string): Promise<DocumentoPortal[]> {
    const filtro = `CardCode eq '${esc(cardCode)}' and U_PRT_ID eq '${esc(portalId)}' and U_PRT_ORIG eq 'PORTAL'`;
    const select = "$select=DocEntry,DocNum,DocTotal,U_PRT_HASH";
    const [pedidos, rascunhos] = await Promise.all([
      this.ler(`Orders?${select}&$filter=${encodeURIComponent(`${filtro} and Cancelled eq 'tNO'`)}`),
      this.ler(`Drafts?${select}&$filter=${encodeURIComponent(`${filtro} and DocObjectCode eq 'oOrders' and DocumentStatus eq 'bost_Open'`)}`),
    ]);
    const mapear = (tipo: "ORDER" | "DRAFT") => (d: any): DocumentoPortal => ({
      tipo,
      docEntry: d.DocEntry,
      docNum: d.DocNum,
      cardCode,
      portalId,
      portalHash: d.U_PRT_HASH ?? "",
      total: numero(d.DocTotal, 2),
    });
    return [...(pedidos?.value ?? []).map(mapear("ORDER")), ...(rascunhos?.value ?? []).map(mapear("DRAFT"))];
  }

  /**
   * Pedidos do cliente de qualquer origem. Confirmar: paginação (odata.maxpagesize e
   * @odata.nextLink), campo que distingue EDI de vendedor e tratamento de linhas
   * parcialmente atendidas (RemainingOpenQuantity) na versão instalada.
   */
  async listarPedidosCliente(cardCode: string, desde: string) {
    const select = "$select=DocEntry,DocNum,DocDate,DocDueDate,DocTotal,DocumentStatus,Cancelled,NumAtCard,UpdateDate,U_PRT_ID,U_PRT_ORIG,DocumentLines";
    const filtro = `CardCode eq '${esc(cardCode)}' and DocDate ge '${esc(desde)}'`;
    const pedidos: any[] = [];
    let proximo: string | null = `Orders?${select}&$filter=${encodeURIComponent(filtro)}&$orderby=DocEntry desc`;
    for (let pagina = 0; proximo && pagina < 20; pagina++) {
      const r = await this.ler(proximo);
      pedidos.push(...(r?.value ?? []));
      proximo = r?.["odata.nextLink"] ?? r?.["@odata.nextLink"] ?? null;
    }
    const rascunhos = await this.ler(
      `Drafts?${select}&$filter=${encodeURIComponent(`${filtro} and DocObjectCode eq 'oOrders' and DocumentStatus eq 'bost_Open'`)}`,
    );
    // Confirmar: RemainingOpenQuantity cai também com entrega (ODLN), não só com nota.
    // Se a operação entrega antes de faturar, medir faturado pelas linhas de OINV
    // com BaseType 17 / BaseEntry = DocEntry do pedido.
    const mapear = (tipo: "ORDER" | "DRAFT") => (d: any) => {
      const linhas = (d.DocumentLines ?? []).map((l: any) => {
        const restante = Number(l.RemainingOpenQuantity ?? (d.DocumentStatus === "bost_Open" ? l.Quantity : 0));
        return {
          itemCode: l.ItemCode,
          descricao: l.ItemDescription ?? l.ItemCode,
          quantidade: String(l.Quantity),
          uomEntry: l.UoMEntry ?? -1,
          unidade: l.UoMCode ?? "",
          precoUnitario: numero(l.Price ?? l.UnitPrice, 2),
          total: numero(l.LineTotal, 2),
          faturada: String(Math.max(0, Number(l.Quantity) - restante)),
        };
      });
      const qtdFaturada = linhas.reduce((s: number, l: { faturada: string }) => s + Number(l.faturada), 0);
      const situacao =
        tipo === "DRAFT" ? "AGUARDANDO_APROVACAO" : d.Cancelled === "tYES" ? "CANCELADO" : d.DocumentStatus === "bost_Close" ? "FATURADO" : qtdFaturada > 0 ? "PARCIAL" : "APROVADO";
      const valorLinhas = linhas.reduce((s: number, l: { total: string }) => s + Number(l.total), 0);
      const valorFaturado = linhas.reduce((s: number, l: { faturada: string; precoUnitario: string }) => s + Number(l.faturada) * Number(l.precoUnitario), 0);
      return {
        tipo,
        docEntry: d.DocEntry,
        docNum: d.DocNum,
        data: String(d.DocDate).slice(0, 10),
        dataEntrega: String(d.DocDueDate).slice(0, 10),
        total: numero(d.DocTotal, 2),
        faturado: numero(situacao === "FATURADO" ? d.DocTotal : valorLinhas ? (Number(d.DocTotal) * valorFaturado) / valorLinhas : 0, 2),
        situacao,
        origem: d.U_PRT_ORIG === "PORTAL" ? "PORTAL" : "VENDEDOR",
        referencia: d.NumAtCard ?? "",
        portalId: d.U_PRT_ID || null,
        // Confirmar: datas de aprovação (OWDD) e da primeira nota exigem consultas próprias.
        marcos: { aprovado: tipo === "DRAFT" ? null : String(d.DocDate).slice(0, 10), faturado: null, concluido: d.DocumentStatus === "bost_Close" ? String(d.UpdateDate ?? d.DocDueDate).slice(0, 10) : null },
        linhas,
      } as const;
    };
    return [...pedidos.map(mapear("ORDER")), ...(rascunhos?.value ?? []).map(mapear("DRAFT"))];
  }

  async listarEnviosPendentes(cardCode: string) {
    const filtro = `U_CardCode eq '${esc(cardCode)}' and (U_State eq 'PROCESSANDO' or U_State eq 'RESULTADO_INCERTO')`;
    const r = await this.ler(`U_PRT_REQUEST?$select=U_OperationId,U_State,U_CreatedUtc&$filter=${encodeURIComponent(filtro)}`);
    return (r?.value ?? []).map((x: any) => ({ operationId: x.U_OperationId, estado: x.U_State, criadoUtc: x.U_CreatedUtc }));
  }

  // ---- Interno --------------------------------------------------------------------------

  private montarDocumento(pedido: PedidoSap) {
    const c = this.config;
    return {
      CardCode: pedido.cardCode,
      DocDate: new Date().toISOString().slice(0, 10),
      DocDueDate: pedido.dataEntrega,
      ShipToCode: pedido.shipToCode,
      NumAtCard: pedido.referencia || undefined,
      Comments: pedido.observacao || undefined,
      ...(c.serie ? { Series: c.serie } : {}),
      ...(c.filial ? { BPL_IDAssignedToInvoice: c.filial } : {}),
      ...(pedido.portalId ? { U_PRT_ID: pedido.portalId, U_PRT_ORIG: "PORTAL", U_PRT_HASH: pedido.portalHash } : {}),
      DocumentLines: pedido.linhas.map((l) => ({
        ItemCode: l.itemCode,
        Quantity: Number(l.quantidade),
        UoMEntry: l.uomEntry,
        UnitPrice: Number(l.precoUnitario),
        ...(c.deposito ? { WarehouseCode: c.deposito } : {}),
        ...(c.utilizacao ? { Usage: c.utilizacao } : {}),
      })),
    };
  }

  /** GET. Erro de rede é indisponibilidade; 404 é "não existe". Sessão expirada: novo login, uma vez. */
  private async ler(caminho: string): Promise<any | null> {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const r = await this.chamar("GET", caminho, undefined, false);
      if (r.status === 401 && tentativa === 0) {
        this.cookie = null;
        continue;
      }
      if (r.status === 404) return null;
      if (r.status >= 400) throw recusa(r);
      return r.corpo;
    }
    throw new SapIndisponivel("Sessão da Service Layer recusada.");
  }

  /** POST de consulta (serviços RPC sem efeito). Pode renovar a sessão. */
  private async escreverLeitura(servico: string, corpo: unknown): Promise<any> {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const r = await this.chamar("POST", servico, corpo, false);
      if (r.status === 401 && tentativa === 0) {
        this.cookie = null;
        continue;
      }
      if (r.status >= 400) throw recusa(r);
      return r.corpo;
    }
    throw new SapIndisponivel("Sessão da Service Layer recusada.");
  }

  /** Escrita com efeito: uma tentativa. Renovar a sessão não autoriza repetir. */
  private async escrever(metodo: "POST" | "PATCH", caminho: string, corpo: unknown): Promise<any> {
    const r = await this.chamar(metodo, caminho, corpo, true);
    if (r.status === 401) throw new SapIndisponivel("Sessão da Service Layer expirada antes da escrita.");
    if (r.status >= 500) throw new SapIndeterminado(`Service Layer respondeu ${r.status} a uma escrita.`);
    if (r.status >= 400) throw recusa(r);
    return r.corpo;
  }

  private async chamar(metodo: string, caminho: string, corpo: unknown, escrita: boolean): Promise<Resposta> {
    if (!this.cookie) await this.login();
    let res: globalThis.Response;
    try {
      res = await fetch(`${this.base}/${caminho}`, {
        method: metodo,
        headers: { Cookie: this.cookie ?? "", "Content-Type": "application/json", Accept: "application/json" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 20_000),
      });
    } catch (e) {
      throw classificarFalhaDeRede(e, escrita);
    }
    const texto = await res.text().catch(() => "");
    let json: any = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      if (escrita && res.ok) throw new SapIndeterminado("Resposta ilegível da Service Layer após escrita.");
    }
    return { status: res.status, corpo: json };
  }

  private async login() {
    let res: globalThis.Response;
    try {
      res = await fetch(`${this.base}/Login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CompanyDB: this.config.empresa, UserName: this.config.usuario, Password: this.config.senha }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (e) {
      throw classificarFalhaDeRede(e, false);
    }
    if (!res.ok) throw new SapIndisponivel(`Login na Service Layer recusado (${res.status}).`);
    this.cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter((c) => c.startsWith("B1SESSION=") || c.startsWith("ROUTEID="))
      .join("; ");
  }
}

const CAMPOS_ITEM = "ItemCode,ItemName,ItemsGroupCode,SalesItem,Valid,Frozen,U_PRT_WEB,SalesUnit,DefaultSalesUoMEntry,QuantityOnStock";

function paraItem(r: any): ItemSap {
  return {
    itemCode: r.ItemCode,
    descricao: r.ItemName,
    grupo: String(r.ItemsGroupCode ?? ""),
    vendavel: r.SalesItem === "tYES",
    ativo: r.Valid === "tYES" && r.Frozen !== "tYES",
    publicado: r.U_PRT_WEB === "Y",
    // Confirmar (D13): unidades vendáveis do grupo de UoM e múltiplos. Aqui só a padrão.
    unidades: [{ entry: r.DefaultSalesUoMEntry ?? -1, codigo: r.SalesUnit ?? "UN", descricao: r.SalesUnit ?? "Unidade", multiplo: "1" }],
    disponibilidade: Number(r.QuantityOnStock ?? 0) > 0 ? "DISPONIVEL" : "SOB_CONSULTA",
    precoPorQuantidade: false,
    imagem: null, // Confirmar: de onde vem a foto aprovada (anexo do item, URL em UDF ou CDN do cliente).
  };
}

function paraUdt(r: Partial<Reserva>) {
  const campos: Record<string, unknown> = {
    U_KeyHash: r.keyHash,
    U_OperationId: r.operationId,
    U_CardCode: r.cardCode,
    U_ActorHash: r.actorHash,
    U_PayloadHash: r.payloadHash,
    U_State: r.estado,
    U_CreatedUtc: r.criadoUtc,
    U_UpdatedUtc: r.atualizadoUtc,
    U_Correlation: r.correlation,
    U_DocType: r.docType === undefined ? undefined : r.docType ?? "",
    U_DocEntry: r.docEntry === undefined ? undefined : r.docEntry ?? 0,
    U_DocNum: r.docNum === undefined ? undefined : r.docNum ?? 0,
    U_ErrorCode: r.erro === undefined ? undefined : r.erro ?? "",
  };
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
}

function recusa(r: Resposta): SapRecusa {
  const e = r.corpo?.error;
  const codigo = String(e?.code ?? r.status);
  const mensagem = typeof e?.message === "string" ? e.message : e?.message?.value ?? `HTTP ${r.status}`;
  return new SapRecusa(codigo, mensagem);
}

function classificarFalhaDeRede(e: unknown, escrita: boolean) {
  const causa = (e as { cause?: { code?: string } })?.cause?.code;
  if (causa && ERROS_DE_CONEXAO.has(causa)) return new SapIndisponivel(`Sem conexão com a Service Layer (${causa}).`);
  // Timeout ou conexão caída no meio: numa escrita, pode ter gravado.
  return escrita ? new SapIndeterminado("Resposta da Service Layer perdida.") : new SapIndisponivel("Service Layer não respondeu.");
}

/** Escape de literal OData: aspa simples dobrada. */
const esc = (valor: string) => valor.replace(/'/g, "''");

const numero = (valor: unknown, casas: number) => Number(valor ?? 0).toFixed(casas);
