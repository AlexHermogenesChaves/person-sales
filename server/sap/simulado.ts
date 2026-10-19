// SAP Business One simulado, em memória. Serve para a POC rodar de ponta a ponta
// sem homologação disponível e para os testes exercitarem as falhas que a base real
// não deixa provocar (resposta perdida, reinício no meio do envio).
//
// Comporta-se como a Service Layer nos pontos que o desenho depende:
// - reserva na UDT com chave primária: a segunda inclusão do mesmo Code falha;
// - pedido que cai em aprovação vira rascunho (na SL real chega como -2028);
// - rascunho aprovado vira pedido com DocEntry novo, levando os UDFs do portal.

import { arredondar, dec, mul, soma, texto, type Dec } from "../dominio/decimal.js";
import { chaveEnvio, codeDaUdt, identityHash } from "../dominio/chaves.js";
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
  type OrigemPedido,
  type PedidoCliente,
  type PedidoSap,
  type PrecoEfetivo,
  type PreviaPedido,
  type Reserva,
  type SapGateway,
  type UnidadeVenda,
} from "./tipos.js";

export const EMPRESA_DEMO = "SBO_DISTRIBUIDORA_DEMO";
export const ISSUER_DEMO = "https://login.demo.example";
const LIMITE_APROVACAO = dec("5000");
const FRETE_MINIMO = dec("800");
const FRETE = dec("45");

type ItemSeed = {
  itemCode: string;
  descricao: string;
  grupo: string;
  /** [codigoUnidade, preçoLista1, múltiplo] */
  precos: [string, string, string?][];
  aliquota?: string;
  sobConsulta?: boolean;
  ativo?: boolean;
  publicado?: boolean;
  vendavel?: boolean;
  imagem?: string;
};

const UNIDADES: Record<string, { entry: number; descricao: string }> = {
  UN: { entry: 1, descricao: "Pacote" },
  CX: { entry: 2, descricao: "Caixa" },
  FD: { entry: 3, descricao: "Fardo" },
};

// Portfólio do Grupo Farina (grupofarina.com.br, lido em 19/10/2026): Reali Junior,
// Pita Bread, Cabocla Mineira e Tá Pronto. Embalagens e preços de venda são da
// demonstração; códigos PA são fictícios. Fotos servidas pelo CDN do site do cliente.
const CDN = "https://static.wixstatic.com/media";
const F = {
  formaTrad: "b09142_0a4e1ea8481446f287d69f163af70f57~mv2.png",
  formaIntegral: "8779b2_b815ecafbffb42deb084e9e7f0f8d285~mv2.png",
  multigraos: "b09142_0300864ada97454bb0fcb7d15ea6e6b0~mv2.png",
  milho: "b09142_60c0eff76af146d2a850d907508d02d4~mv2.png",
  dozeGraos: "b09142_dbea09407a0d4db7bf9bb3078f9d9849~mv2.png",
  coco: "b09142_0963a3e45e1c48848e9a7071aee8e554~mv2.png",
  castanha: "b09142_23340540a171485b8e4b4bdcc152b5ec~mv2.png",
  hotDog: "8779b2_df07554131844801be91970c40be9c43~mv2.png",
  bisnaguinha: "b09142_2e2b0ab5f5df4176aa2a40363ae60c3e~mv2.png",
  sirioTrad: "b09142_32d73ea9fe4a4c239522dd2171a5549d~mv2.avif",
  sirioIntegral: "b09142_f03eacff3f2946d3b7bfc2e229e23996~mv2.avif",
  sirioExtrafino: "b09142_a48056cbe4fe45279c767ce4d38e86f4~mv2.avif",
  hambTrad: "8779b2_5073e52fa6cf45d29ad0799d40a59baf~mv2.png",
  hambExtraBig: "8779b2_dc4b3077c53a4c1aa27f9492eecc3b40~mv2.png",
  hambCorteDuplo: "8779b2_1826ea47cdf44469a8f3c42570c11bc9~mv2.png",
  hambBrioche: "8779b2_30360f1fc7cb49acaf3db84714173d62~mv2.png",
  hambAustraliano: "8779b2_78dd3d678cc1497596ffee2bac170698~mv2.png",
  boloChocomousse: "b09142_2d0ab1e6b2b447ea9b5d619384c93f6e~mv2.avif",
  boloFuba: "b09142_3bdfebf0f56c4460bf8ace1c7649c3a8~mv2.avif",
  boloAipim: "b09142_11ccc0500b194d4ab7cfc231215b8cde~mv2.avif",
  boloCenoura: "b09142_9e520feddc444bcab6cd10ae732ca473~mv2.avif",
  boloLaranja: "b09142_492c742da8a34eec961ac00fa6ef4ff5~mv2.avif",
  boloMilho: "b09142_8296b88fcb6a4563bfc9fe4021055eee~mv2.avif",
  // Ordem das três tortilhas deduzida da página Tá Pronto: conferir com o cliente.
  tortTrad: "8779b2_bf446f311e794baabea4695545d20012~mv2.png",
  tortIntegral: "8779b2_5a19dc035b874bb5942bf87ebe514e7f~mv2.png",
  tortProteina: "8779b2_8a02e5ece2164fc2a2891785d2898e73~mv2.png",
};
const foto = (id: string) => `${CDN}/${id}/v1/fit/w_240,h_240,q_85,enc_auto/foto.${id.endsWith(".avif") ? "avif" : "png"}`;

const ITENS: ItemSeed[] = [
  { itemCode: "PA0001", descricao: "Pão de forma tradicional 500 g – caixa 12 un", grupo: "Reali Junior", precos: [["CX", "118.80"]], imagem: F.formaTrad },
  { itemCode: "PA0002", descricao: "Pão de forma integral 500 g – caixa 12 un", grupo: "Reali Junior", precos: [["CX", "134.40"]], imagem: F.formaIntegral },
  { itemCode: "PA0003", descricao: "Pão de forma integral multigrãos 450 g – caixa 12 un", grupo: "Reali Junior", precos: [["CX", "151.20"]], imagem: F.multigraos },
  { itemCode: "PA0004", descricao: "Pão de forma integral 12 grãos 400 g", grupo: "Reali Junior", precos: [["CX", "158.40"], ["UN", "13.90"]], imagem: F.dozeGraos },
  { itemCode: "PA0005", descricao: "Pão de hot dog tradicional 400 g – caixa 12 un", grupo: "Reali Junior", precos: [["CX", "97.20"]], imagem: F.hotDog },
  { itemCode: "PA0006", descricao: "Pão de hambúrguer tradicional 320 g – caixa 12 un", grupo: "Pita Bread", precos: [["CX", "103.20"]], imagem: F.hambTrad },
  { itemCode: "PA0007", descricao: "Pão de hambúrguer Brioche Duo 480 g – caixa 10 un", grupo: "Pita Bread", precos: [["CX", "139.00"]], imagem: F.hambBrioche },
  { itemCode: "PA0008", descricao: "Bisnaguinha tradicional 300 g", grupo: "Reali Junior", precos: [["CX", "159.00"], ["UN", "8.60"]], imagem: F.bisnaguinha },
  { itemCode: "PA0009", descricao: "Pão de hambúrguer Extra Big com gergelim", grupo: "Pita Bread", precos: [["UN", "12.90", "4"]], sobConsulta: true, imagem: F.hambExtraBig },
  { itemCode: "PA0010", descricao: "Pão de hambúrguer corte duplo – caixa 12 un", grupo: "Pita Bread", precos: [["CX", "118.80"]], imagem: F.hambCorteDuplo },
  { itemCode: "PA0011", descricao: "Pão sírio tradicional 320 g – fardo 20 un", grupo: "Pita Bread", precos: [["FD", "98.00"]], imagem: F.sirioTrad },
  { itemCode: "PA0012", descricao: "Pão sírio integral 63% 320 g – fardo 20 un", grupo: "Pita Bread", precos: [["FD", "112.00"]], imagem: F.sirioIntegral },
  { itemCode: "PA0013", descricao: "Pão sírio extrafino 320 g", grupo: "Pita Bread", precos: [["UN", "7.95", "6"]], imagem: F.sirioExtrafino },
  { itemCode: "PA0014", descricao: "Pão de forma sabor milho 400 g – caixa 12 un", grupo: "Reali Junior", precos: [["CX", "112.80"]], aliquota: "0.04", imagem: F.milho },
  { itemCode: "PA0015", descricao: "Pão de hambúrguer australiano – caixa 10 un", grupo: "Pita Bread", precos: [["CX", "139.00"]], aliquota: "0.04", imagem: F.hambAustraliano },
  { itemCode: "PA0016", descricao: "Pão de forma sabor coco 400 g – caixa 12 un", grupo: "Reali Junior", precos: [["CX", "128.00"]], imagem: F.coco },
  { itemCode: "PA0017", descricao: "Pão de forma integral castanha e quinoa 400 g", grupo: "Reali Junior", precos: [["UN", "14.90"]], sobConsulta: true, imagem: F.castanha },
  { itemCode: "PA0018", descricao: "Bolos sortidos 400 g – display 48 un", grupo: "Cabocla Mineira", precos: [["CX", "689.00"]], imagem: F.boloChocomousse },
  { itemCode: "PA0019", descricao: "Bolo sabor laranja 400 g – caixa 12 un", grupo: "Cabocla Mineira", precos: [["CX", "98.10"]], imagem: F.boloLaranja },
  { itemCode: "PA0020", descricao: "Bolo sabor chocomousse 400 g – caixa 12 un", grupo: "Cabocla Mineira", precos: [["CX", "107.40"]], imagem: F.boloChocomousse },
  { itemCode: "PA0021", descricao: "Bolo sabor fubá 400 g – caixa 12 un", grupo: "Cabocla Mineira", precos: [["CX", "98.10"]], imagem: F.boloFuba },
  { itemCode: "PA0022", descricao: "Bolo sabor milho 400 g – fardo 10 un", grupo: "Cabocla Mineira", precos: [["FD", "89.50"]], imagem: F.boloMilho },
  { itemCode: "PA0023", descricao: "Tortilha tradicional 270 g – display 12 un", grupo: "Tá Pronto", precos: [["UN", "96.40"]], aliquota: "0.12", imagem: F.tortTrad },
  { itemCode: "PA0024", descricao: "Tortilha integral 270 g – display 12 un", grupo: "Tá Pronto", precos: [["UN", "92.80"]], aliquota: "0.12", imagem: F.tortIntegral },
  { itemCode: "PA0025", descricao: "Tortilha proteína (61% integral) 270 g – display 12 un", grupo: "Tá Pronto", precos: [["UN", "98.60"]], aliquota: "0.12", imagem: F.tortProteina },
  { itemCode: "PA0026", descricao: "Bolo sabor aipim 400 g", grupo: "Cabocla Mineira", precos: [["UN", "9.90"]], aliquota: "0.12", imagem: F.boloAipim },
  { itemCode: "PA0027", descricao: "Bolo sabor cenoura 400 g", grupo: "Cabocla Mineira", precos: [["UN", "9.30"]], aliquota: "0.12", imagem: F.boloCenoura },
  { itemCode: "PA0028", descricao: "Bolo sabor formigueiro 400 g", grupo: "Cabocla Mineira", precos: [["UN", "9.30"]], aliquota: "0.12" },
  { itemCode: "PA0029", descricao: "Pão sírio tradicional 400 g – caixa 10 un", grupo: "Pita Bread", precos: [["CX", "92.30"]], imagem: F.sirioTrad },
  { itemCode: "PA0030", descricao: "Pão sírio tradicional 300 g", grupo: "Pita Bread", precos: [["UN", "6.90"]], imagem: F.sirioTrad },
  { itemCode: "PA0031", descricao: "Pão sírio tradicional 640 g", grupo: "Pita Bread", precos: [["UN", "13.60"]], imagem: F.sirioTrad },
  { itemCode: "PA0032", descricao: "Bolos sortidos 400 g – display 72 un", grupo: "Cabocla Mineira", precos: [["CX", "768.00"]], imagem: F.boloLaranja },
  { itemCode: "PA0033", descricao: "Pães de forma sortidos – caixa 36 un", grupo: "Reali Junior", precos: [["CX", "419.70"]], imagem: F.formaTrad },
  { itemCode: "PA0034", descricao: "Pão sírio extrafino 320 g – fardo 24 un", grupo: "Pita Bread", precos: [["FD", "117.60"]], imagem: F.sirioExtrafino },
  { itemCode: "PA0035", descricao: "Tortilha tradicional 270 g – fardo 20 un", grupo: "Tá Pronto", precos: [["FD", "96.80"]], imagem: F.tortTrad },
  { itemCode: "PA0036", descricao: "Tortilha integral 270 g – fardo 20 un", grupo: "Tá Pronto", precos: [["FD", "99.40"]], imagem: F.tortIntegral },
  { itemCode: "PA0037", descricao: "Pão de hot dog 400 g – caixa 10 un (food service)", grupo: "Reali Junior", precos: [["CX", "109.00"]], imagem: F.hotDog },
  { itemCode: "PA0038", descricao: "Pão de hambúrguer tradicional food service (24 un)", grupo: "Pita Bread", precos: [["UN", "18.50"]], aliquota: "0.12", imagem: F.hambTrad },
  { itemCode: "PA0039", descricao: "Pão de hambúrguer brioche food service (24 un)", grupo: "Pita Bread", precos: [["UN", "21.70"]], aliquota: "0.12", imagem: F.hambBrioche },
  { itemCode: "PA0040", descricao: "Pão sírio tradicional food service 1 kg", grupo: "Pita Bread", precos: [["UN", "24.80"]], aliquota: "0.12", imagem: F.sirioTrad },
  { itemCode: "PA0041", descricao: "Pão de forma light 400 g – caixa 12 un", grupo: "Reali Junior", precos: [["CX", "121.20"]], ativo: false },
  { itemCode: "PA0042", descricao: "Bolo sabor banana 400 g (lançamento)", grupo: "Cabocla Mineira", precos: [["CX", "138.00"]], publicado: false },
  { itemCode: "PA0043", descricao: "Cesto plástico retornável de entrega", grupo: "Logística", precos: [["UN", "42.00"]], vendavel: false },
];
/** Preço especial por cliente (OSPP/SPP2): faixas por quantidade mínima. */
const ESPECIAIS: Record<string, Record<string, { minimo: string; preco: string }[]>> = {
  C00012: {
    "PA0001:2": [
      { minimo: "1", preco: "112.80" },
      { minimo: "10", preco: "108.00" },
    ],
    "PA0014:2": [{ minimo: "1", preco: "106.90" }],
  },
};

type Pessoa = { issuer: string; sub: string; nome: string; email: string };

export const PESSOAS: Record<string, Pessoa & { descricao: string }> = {
  ana: { issuer: ISSUER_DEMO, sub: "9f1c2e6a-0001", nome: "Ana Ribeiro", email: "ana.ribeiro@maissabor.example", descricao: "Compradora · Rede Mais Sabor Supermercados" },
  carlos: { issuer: ISSUER_DEMO, sub: "9f1c2e6a-0002", nome: "Carlos Menezes", email: "carlos.menezes@maissabor.example", descricao: "Comprador · mesma rede, outro usuário" },
  juliana: { issuer: ISSUER_DEMO, sub: "9f1c2e6a-0003", nome: "Juliana Prado", email: "juliana.prado@bompreco.example", descricao: "Compradora · Supermercado Bom Preço" },
  marcos: { issuer: ISSUER_DEMO, sub: "9f1c2e6a-0004", nome: "Marcos Lima", email: "marcos.lima@maissabor.example", descricao: "Vínculo desativado no SAP" },
  visitante: { issuer: ISSUER_DEMO, sub: "9f1c2e6a-0005", nome: "Renata Souza", email: "renata.souza@exemplo.example", descricao: "Login válido, sem vínculo com cliente" },
};
export type Falhas = {
  sapForaDoAr: boolean;
  perderRespostaReserva: boolean;
  perderRespostaPedido: boolean;
  recusarPedido: boolean;
  falharAtualizacaoReserva: boolean;
};

type Documento = DocumentoPortal & {
  criadoUtc: string;
  aberto: boolean;
  data: string;
  dataEntrega: string;
  referencia: string;
  itens: PedidoCliente["linhas"];
};

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const agoraIso = () => new Date().toISOString();
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export class SapSimulado implements SapGateway {
  readonly modo = "simulado" as const;
  latenciaMs: number;
  falhas: Falhas = semFalhas();

  private acessos = new Map<string, Acesso>();
  private clientes = new Map<string, Cliente & { lista: 1 | 2 }>();
  private enderecos = new Map<string, Endereco[]>();
  private itens = new Map<string, ItemSap & { seed: ItemSeed }>();
  private precosLista = new Map<string, Dec>();
  private reservas = new Map<string, Reserva>();
  private documentos: Documento[] = [];
  /** Pedidos que não nasceram no portal: vendedor e EDI, meses para trás. */
  private historico: (PedidoCliente & { cardCode: string })[] = [];
  private proximoDocEntry = 8812;
  private proximoDocNum = 10483;
  private proximoRascunho = 3311;

  constructor(opcoes: { latenciaMs?: number; semHistorico?: boolean } = {}) {
    this.latenciaMs = opcoes.latenciaMs ?? 350;
    this.semear(opcoes.semHistorico ?? false);
  }

  // ---- Gateway --------------------------------------------------------------

  async buscarAcesso(code: string) {
    await this.ida();
    return structuredClone(this.acessos.get(code) ?? null);
  }

  async buscarCliente(cardCode: string) {
    await this.ida();
    const c = this.clientes.get(cardCode);
    return c ? { cardCode: c.cardCode, nome: c.nome, ativo: c.ativo, habilitadoPortal: c.habilitadoPortal } : null;
  }

  async listarItens({ busca, depoisDe, limite }: { busca: string; depoisDe: string | null; limite: number }) {
    await this.ida();
    const termo = normalizar(busca.trim());
    return [...this.itens.values()]
      .filter((i) => i.vendavel && i.ativo && i.publicado)
      .filter((i) => !termo || normalizar(i.itemCode).includes(termo) || normalizar(i.descricao).includes(termo) || normalizar(i.grupo).includes(termo))
      .filter((i) => !depoisDe || i.itemCode > depoisDe)
      .sort((a, b) => (a.itemCode < b.itemCode ? -1 : 1))
      .slice(0, limite)
      .map(publico);
  }

  async buscarItens(codigos: string[]) {
    await this.ida();
    return codigos.flatMap((c) => {
      const item = this.itens.get(c);
      return item ? [publico(item)] : [];
    });
  }

  async precos(cardCode: string, _data: string, consultas: ConsultaPreco[]): Promise<PrecoEfetivo[]> {
    await this.ida();
    const cliente = this.clientes.get(cardCode);
    if (!cliente) throw new SapRecusa("-1", "Parceiro de negócios não encontrado.");
    return consultas.map((c) => this.precoEfetivo(cliente, c));
  }

  async listarEnderecos(cardCode: string) {
    await this.ida();
    return structuredClone(this.enderecos.get(cardCode) ?? []);
  }

  async preverPedido(pedido: PedidoSap): Promise<PreviaPedido> {
    await this.ida();
    return this.calcular(pedido);
  }

  async criarReserva(reserva: Reserva): Promise<"CRIADA" | "JA_EXISTE"> {
    await this.ida();
    // Checagem e gravação no mesmo tique: é a chave primária da UDT.
    if (this.reservas.has(reserva.code)) return "JA_EXISTE";
    this.reservas.set(reserva.code, structuredClone(reserva));
    if (this.falhas.perderRespostaReserva) {
      throw new SapIndeterminado("Tempo esgotado aguardando a Service Layer (reserva).");
    }
    return "CRIADA";
  }

  async lerReserva(code: string) {
    await this.ida();
    return structuredClone(this.reservas.get(code) ?? null);
  }

  async atualizarReserva(code: string, mudanca: Partial<Reserva>) {
    await this.ida();
    if (this.falhas.falharAtualizacaoReserva) {
      throw new SapIndisponivel("Falha ao atualizar @PRT_REQUEST.");
    }
    const atual = this.reservas.get(code);
    if (!atual) throw new SapRecusa("-2028", "Registro não encontrado em @PRT_REQUEST."); // -2028 = "no matching records" na SL
    this.reservas.set(code, { ...atual, ...mudanca, atualizadoUtc: agoraIso() });
  }

  async criarPedido(pedido: PedidoSap): Promise<DocumentoPortal> {
    await this.ida();
    if (this.falhas.recusarPedido) {
      throw new SapRecusa("-10", "Cliente com limite de crédito excedido. O pedido não pode ser incluído.");
    }
    const previa = this.calcular(pedido);
    const documento: Documento = previa.caiEmAprovacao
      ? // Na SL real: POST Orders interceptado pela aprovação cria o rascunho e devolve
        // -2028. O adaptador real trata isso e procura o rascunho por U_PRT_ID.
        {
          tipo: "DRAFT",
          docEntry: this.proximoRascunho,
          docNum: this.proximoRascunho++,
          ...this.dadosDocumento(pedido, previa),
        }
      : {
          tipo: "ORDER",
          docEntry: this.proximoDocEntry++,
          docNum: this.proximoDocNum++,
          ...this.dadosDocumento(pedido, previa),
        };
    this.documentos.push(documento);
    if (this.falhas.perderRespostaPedido) {
      throw new SapIndeterminado("Tempo esgotado aguardando a Service Layer (Orders).");
    }
    return paraPortal(documento);
  }

  async buscarDocumentosPortal(cardCode: string, portalId: string) {
    await this.ida();
    return this.documentos
      .filter((d) => d.cardCode === cardCode && d.portalId === portalId && d.aberto)
      .map(paraPortal);
  }

  async listarPedidosCliente(cardCode: string, desde: string): Promise<PedidoCliente[]> {
    await this.ida();
    const doPortal = this.documentos
      .filter((d) => d.cardCode === cardCode && d.aberto && d.data >= desde && d.docEntry !== null)
      .map((d): PedidoCliente => ({
        tipo: d.tipo,
        docEntry: d.docEntry!,
        docNum: d.docNum!,
        data: d.data,
        dataEntrega: d.dataEntrega,
        total: d.total ?? "0.00",
        faturado: "0.00",
        // Pedido do portal ainda não faturado: o SAP simulado não emite nota.
        situacao: d.tipo === "DRAFT" ? "AGUARDANDO_APROVACAO" : "APROVADO",
        origem: "PORTAL",
        referencia: d.referencia,
        portalId: d.portalId,
        marcos: { aprovado: d.tipo === "DRAFT" ? null : d.data, faturado: null, concluido: null },
        linhas: d.itens,
      }));
    const outros = this.historico
      .filter((p) => p.data >= desde && p.cardCode === cardCode)
      .map(({ cardCode: _c, ...p }): PedidoCliente => p);
    return structuredClone([...doPortal, ...outros]).sort((a, b) => (a.data === b.data ? b.docNum - a.docNum : a.data < b.data ? 1 : -1));
  }

  async listarEnviosPendentes(cardCode: string) {
    await this.ida();
    return [...this.reservas.values()]
      .filter((r) => r.cardCode === cardCode && (r.estado === "PROCESSANDO" || r.estado === "RESULTADO_INCERTO"))
      .map((r) => ({ operationId: r.operationId, estado: r.estado as "PROCESSANDO" | "RESULTADO_INCERTO", criadoUtc: r.criadoUtc }));
  }

  // ---- Bastidores da demonstração ------------------------------------------

  estado() {
    return {
      falhas: this.falhas,
      latenciaMs: this.latenciaMs,
      reservas: [...this.reservas.values()].sort((a, b) => (a.criadoUtc < b.criadoUtc ? 1 : -1)),
      documentos: [...this.documentos]
        .sort((a, b) => (a.criadoUtc < b.criadoUtc ? 1 : -1))
        .map(({ itens, ...d }) => ({ ...d, linhas: itens.length })),
      acessos: [...this.acessos.values()].map((a) => ({
        ...a,
        pessoa: Object.entries(PESSOAS).find(([, p]) => codeDaUdt(identityHash(p.issuer, p.sub)) === a.code)?.[1].nome ?? "—",
        cliente: this.clientes.get(a.cardCode)?.nome ?? a.cardCode,
      })),
      precosAlteraveis: [...this.itens.values()]
        .filter((i) => i.publicado && i.ativo && i.vendavel)
        .slice(0, 12)
        .map((i) => ({ itemCode: i.itemCode, descricao: i.descricao })),
    };
  }

  /** O que o aprovador faz no SAP: o rascunho vira pedido com DocEntry novo. */
  aprovarRascunho(docEntry: number) {
    const rascunho = this.documentos.find((d) => d.tipo === "DRAFT" && d.docEntry === docEntry && d.aberto);
    if (!rascunho) return null;
    rascunho.aberto = false;
    const pedido: Documento = {
      ...rascunho,
      tipo: "ORDER",
      docEntry: this.proximoDocEntry++,
      docNum: this.proximoDocNum++,
      criadoUtc: agoraIso(),
      aberto: true,
    };
    this.documentos.push(pedido);
    return pedido;
  }

  /** Reajuste de lista no SAP — para mostrar a revisão sendo recusada no envio. */
  reajustarPreco(itemCode: string, percentual: number) {
    const item = this.itens.get(itemCode);
    if (!item) return false;
    for (const u of item.unidades) {
      const chave = `${itemCode}:${u.entry}`;
      const atual = this.precosLista.get(chave);
      if (atual !== undefined) {
        this.precosLista.set(chave, arredondar(mul(atual, dec(String(1 + percentual / 100))), 2));
      }
    }
    return true;
  }

  alternarVinculo(code: string) {
    const acesso = this.acessos.get(code);
    if (!acesso) return null;
    acesso.ativo = !acesso.ativo;
    return acesso.ativo;
  }

  definirFalha(chave: keyof Falhas, valor: boolean) {
    this.falhas[chave] = valor;
  }

  reiniciar() {
    this.falhas = semFalhas();
    this.semear(false);
  }

  // ---- Interno ---------------------------------------------------------------

  private async ida() {
    if (this.latenciaMs > 0) await espera(this.latenciaMs);
    if (this.falhas.sapForaDoAr) throw new SapIndisponivel("Service Layer não respondeu à conexão.");
  }

  private precoEfetivo(cliente: { cardCode: string; lista: 1 | 2 }, consulta: ConsultaPreco): PrecoEfetivo {
    const base = this.precosLista.get(`${consulta.itemCode}:${consulta.uomEntry}`);
    if (base === undefined) throw new SapRecusa("-5002", `Sem preço para ${consulta.itemCode} nesta unidade.`);
    const quantidade = dec(consulta.quantidade);
    const faixas = ESPECIAIS[cliente.cardCode]?.[`${consulta.itemCode}:${consulta.uomEntry}`];
    const faixa = faixas?.filter((f) => quantidade >= dec(f.minimo)).at(-1);
    if (faixa) {
      return {
        ...consulta,
        precoUnitario: faixa.preco,
        origem: faixa === faixas?.[0] ? "ESPECIAL" : "QUANTIDADE",
      };
    }
    const lista = cliente.lista === 2 ? arredondar(mul(base, dec("1.06")), 2) : base;
    return { ...consulta, precoUnitario: texto(lista, 2), origem: "LISTA" };
  }

  private calcular(pedido: PedidoSap): PreviaPedido {
    const linhas = pedido.linhas.map((l) => {
      const item = this.itens.get(l.itemCode);
      const totalLinha = arredondar(mul(dec(l.quantidade), dec(l.precoUnitario)), 2);
      const imposto = arredondar(mul(totalLinha, dec(item?.seed.aliquota ?? "0")), 2);
      return { itemCode: l.itemCode, uomEntry: l.uomEntry, totalLinha, imposto };
    });
    const subtotal = soma(linhas.map((l) => l.totalLinha));
    const impostos = soma(linhas.map((l) => l.imposto));
    const despesas = subtotal >= FRETE_MINIMO ? 0n : FRETE;
    const total = subtotal + impostos + despesas;
    return {
      linhas: linhas.map((l) => ({ ...l, totalLinha: texto(l.totalLinha, 2), imposto: texto(l.imposto, 2) })),
      subtotal: texto(subtotal, 2),
      impostos: texto(impostos, 2),
      despesas: texto(despesas, 2),
      total: texto(total, 2),
      totaisFinais: true,
      caiEmAprovacao: total > LIMITE_APROVACAO,
    };
  }

  private dadosDocumento(pedido: PedidoSap, previa: PreviaPedido) {
    return {
      cardCode: pedido.cardCode,
      portalId: pedido.portalId ?? "",
      portalHash: pedido.portalHash ?? "",
      total: previa.total,
      criadoUtc: agoraIso(),
      aberto: true,
      data: hojeLocal(),
      dataEntrega: pedido.dataEntrega,
      referencia: pedido.referencia,
      itens: pedido.linhas.map((l, i) => ({
        itemCode: l.itemCode,
        descricao: this.itens.get(l.itemCode)?.descricao ?? l.itemCode,
        quantidade: l.quantidade,
        uomEntry: l.uomEntry,
        unidade: this.itens.get(l.itemCode)?.unidades.find((u) => u.entry === l.uomEntry)?.codigo ?? "",
        precoUnitario: l.precoUnitario,
        total: previa.linhas[i]?.totalLinha ?? "0.00",
        faturada: "0",
      })),
    };
  }

  /** Linhas com o preço que o cliente teria pago, para montar histórico coerente. */
  /**
   * `fatorPreco` desconta o reajuste acumulado: o preço de meses atrás era menor, e o
   * histórico de preço por item precisa mostrar isso.
   */
  private montarLinhas(cardCode: string, escolhas: [string, number, number][], fatorPreco = "1") {
    const cliente = this.clientes.get(cardCode)!;
    const itens = escolhas.map(([itemCode, uomEntry, quantidade]) => {
      const preco = this.precoEfetivo(cliente, { itemCode, uomEntry, quantidade: String(quantidade) });
      const item = this.itens.get(itemCode)!;
      const unitario = arredondar(mul(dec(preco.precoUnitario), dec(fatorPreco)), 2);
      const total = arredondar(mul(dec(String(quantidade)), unitario), 2);
      const imposto = arredondar(mul(total, dec(item.seed.aliquota ?? "0")), 2);
      return {
        itemCode,
        descricao: item.descricao,
        quantidade: String(quantidade),
        uomEntry,
        unidade: item.unidades.find((u) => u.entry === uomEntry)?.codigo ?? "",
        precoUnitario: texto(unitario, 2),
        total,
        imposto,
      };
    });
    const subtotal = soma(itens.map((i) => i.total));
    const total = subtotal + soma(itens.map((i) => i.imposto)) + (subtotal >= FRETE_MINIMO ? 0n : FRETE);
    return {
      itens: itens.map(({ imposto: _i, total: t, ...resto }) => ({ ...resto, total: texto(t, 2), faturada: "0" })),
      total: texto(total, 2),
    };
  }

  /** Seis meses de pedidos de vendedor e EDI, determinísticos: a demo abre sempre igual. */
  private semearPedidosAnteriores() {
    const sorteio = mulberry32(20261019);
    const hoje = hojeLocal();
    const gerados: (PedidoCliente & { cardCode: string })[] = [];
    const perfis: { cardCode: string; intervalo: number; linhas: [number, number]; cesta: [string, number, number, number][]; origem: () => OrigemPedido }[] = [
      {
        cardCode: "C00012",
        intervalo: 6,
        linhas: [3, 7],
        origem: () => "VENDEDOR",
        cesta: [
          ["PA0001", 2, 8, 20], ["PA0005", 2, 3, 8], ["PA0008", 2, 2, 5], ["PA0011", 3, 2, 6], ["PA0014", 2, 1, 4],
          ["PA0022", 3, 1, 3], ["PA0006", 2, 2, 5], ["PA0023", 1, 2, 6], ["PA0019", 2, 1, 3], ["PA0026", 1, 6, 12],
        ],
      },
      {
        cardCode: "C00487",
        intervalo: 9,
        linhas: [5, 10],
        origem: () => (sorteio() < 0.6 ? "EDI" : "VENDEDOR"),
        cesta: [
          ["PA0016", 2, 5, 15], ["PA0002", 2, 5, 12], ["PA0003", 2, 3, 8], ["PA0020", 2, 3, 8], ["PA0019", 2, 3, 8],
          ["PA0034", 3, 2, 6], ["PA0027", 1, 6, 18], ["PA0031", 1, 6, 12], ["PA0030", 1, 6, 18], ["PA0004", 2, 2, 5],
          ["PA0029", 2, 3, 8], ["PA0035", 3, 2, 4],
        ],
      },
    ];
    for (const perfil of perfis) {
      let recentes = 0;
      for (let dias = 180; dias >= 2; dias -= perfil.intervalo - 2 + Math.floor(sorteio() * 5)) {
        const data = somarDiasLocal(hoje, -dias);
        const n = perfil.linhas[0] + Math.floor(sorteio() * (perfil.linhas[1] - perfil.linhas[0] + 1));
        const cesta = [...perfil.cesta].sort(() => sorteio() - 0.5).slice(0, n);
        const escolhas = cesta.map(([item, uom, min, max]): [string, number, number] => [item, uom, min + Math.floor(sorteio() * (max - min + 1))]);
        // ~0,7% de reajuste por mês, com ruído: o histórico de preço não sai reto.
        const fator = (1 - (dias / 30) * 0.007 + (sorteio() - 0.5) * 0.01).toFixed(4);
        const { itens, total } = this.montarLinhas(perfil.cardCode, escolhas, fator);
        const dataEntrega = somarDiasLocal(data, 2 + Math.floor(sorteio() * 4));
        let situacao: PedidoCliente["situacao"] = "FATURADO";
        if (dias > 7 && sorteio() < 0.06) situacao = "CANCELADO";
        else if (dataEntrega >= hoje) situacao = "APROVADO";
        else if (dias <= 16) {
          // Recentes com previsão passada: ciclo fixo para a demo sempre ter parcial e atraso.
          situacao = (["PARCIAL", "APROVADO", "PARCIAL", "FATURADO"] as const)[recentes++ % 4]; // aprovado aqui = previsão vencida
        }
        const linhas = itens.map((l, i) => ({
          ...l,
          faturada:
            situacao === "FATURADO" ? l.quantidade : situacao === "PARCIAL" && i % 2 === 0 ? String(Math.floor(Number(l.quantidade) / 2) || 1) : situacao === "PARCIAL" && i === 1 ? l.quantidade : "0",
        }));
        const valorLinhas = soma(itens.map((l) => dec(l.total)));
        const valorFaturado = soma(linhas.map((l) => arredondar(mul(dec(l.faturada), dec(l.precoUnitario)), 2)));
        const faturado = valorLinhas > 0n ? texto((dec(total) * valorFaturado) / valorLinhas, 2) : "0.00";
        const dataNota = dataEntrega < hoje ? somarDiasLocal(dataEntrega, -1) : null;
        gerados.push({
          cardCode: perfil.cardCode,
          tipo: "ORDER",
          docEntry: 0,
          docNum: 0,
          data,
          dataEntrega,
          total,
          faturado: situacao === "CANCELADO" ? "0.00" : faturado,
          situacao,
          origem: perfil.origem(),
          referencia: sorteio() < 0.7 ? `OC ${3900 + Math.floor(sorteio() * 500)}` : "",
          portalId: null,
          marcos: {
            aprovado: data,
            faturado: situacao === "FATURADO" || situacao === "PARCIAL" ? dataNota : null,
            concluido: situacao === "FATURADO" ? dataNota : situacao === "CANCELADO" ? somarDiasLocal(data, 1) : null,
          },
          linhas: situacao === "CANCELADO" ? linhas.map((l) => ({ ...l, faturada: "0" })) : linhas,
        });
      }
    }
    // Numeração única do SAP, em ordem de data, terminando antes do primeiro pedido do portal.
    gerados.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    gerados.forEach((p, i) => {
      p.docNum = 10482 - gerados.length + i;
      p.docEntry = 8811 - gerados.length + i;
    });
    this.historico = gerados;
  }

  private semear(semHistorico: boolean) {
    this.acessos.clear();
    this.clientes.clear();
    this.enderecos.clear();
    this.itens.clear();
    this.precosLista.clear();
    this.reservas.clear();
    this.documentos = [];
    this.historico = [];

    this.clientes.set("C00012", { cardCode: "C00012", nome: "Rede Mais Sabor Supermercados Ltda", ativo: true, habilitadoPortal: true, lista: 1 });
    this.clientes.set("C00487", {
      cardCode: "C00487",
      nome: "Supermercado Bom Preço do Bairro Comércio de Alimentos Ltda",
      ativo: true,
      habilitadoPortal: true,
      lista: 2,
    });
    this.clientes.set("C00999", { cardCode: "C00999", nome: "Lanchonete Sabor Mineiro Ltda", ativo: true, habilitadoPortal: false, lista: 1 });

    this.enderecos.set("C00012", [
      { codigo: "MATRIZ", logradouro: "Av. Sapopemba, 4120", bairro: "Vila Prudente", cidade: "São Paulo", uf: "SP", cep: "03345-000" },
      { codigo: "LOJA GUARULHOS", logradouro: "Av. Tiradentes, 1930", bairro: "Centro", cidade: "Guarulhos", uf: "SP", cep: "07090-000" },
    ]);
    this.enderecos.set("C00487", [
      { codigo: "LOJA 01", logradouro: "Rua José Lucas, 210", bairro: "Centro", cidade: "Atibaia", uf: "SP", cep: "12940-210" },
    ]);

    const vinculos: [keyof typeof PESSOAS, string, boolean][] = [
      ["ana", "C00012", true],
      ["carlos", "C00012", true],
      ["juliana", "C00487", true],
      ["marcos", "C00012", false],
    ];
    for (const [pessoa, cardCode, ativo] of vinculos) {
      const p = PESSOAS[pessoa];
      const hash = identityHash(p.issuer, p.sub);
      this.acessos.set(codeDaUdt(hash), { code: codeDaUdt(hash), identityHash: hash, cardCode, ativo });
    }

    for (const seed of ITENS) {
      const unidades: UnidadeVenda[] = seed.precos.map(([codigo, , multiplo]) => ({
        entry: UNIDADES[codigo].entry,
        codigo,
        descricao: UNIDADES[codigo].descricao,
        multiplo: multiplo ?? "1",
      }));
      for (const [codigo, preco] of seed.precos) {
        this.precosLista.set(`${seed.itemCode}:${UNIDADES[codigo].entry}`, dec(preco));
      }
      this.itens.set(seed.itemCode, {
        itemCode: seed.itemCode,
        descricao: seed.descricao,
        grupo: seed.grupo,
        vendavel: seed.vendavel ?? true,
        ativo: seed.ativo ?? true,
        publicado: seed.publicado ?? true,
        unidades,
        disponibilidade: seed.sobConsulta ? "SOB_CONSULTA" : "DISPONIVEL",
        imagem: seed.imagem ? foto(seed.imagem) : null,
        precoPorQuantidade: Object.values(ESPECIAIS).some((porItem) =>
          Object.entries(porItem).some(([chave, faixas]) => chave.startsWith(`${seed.itemCode}:`) && faixas.length > 1),
        ),
        seed,
      });
    }

    this.proximoDocEntry = 8812;
    this.proximoDocNum = 10483;
    this.proximoRascunho = 3311;
    if (!semHistorico) {
      this.semearPedidosAnteriores();
      this.semearHistorico();
    }
  }

  /** A demo não abre zerada: um pedido integrado, uma aprovação e um caso incerto. */
  private semearHistorico() {
    const ontem = (h: number, m: number) => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const ana = identityHash(PESSOAS.ana.issuer, PESSOAS.ana.sub);
    const juliana = identityHash(PESSOAS.juliana.issuer, PESSOAS.juliana.sub);
    const ontemData = somarDiasLocal(hojeLocal(), -1);
    const pedidoAna = this.montarLinhas("C00012", [["PA0001", 2, 10], ["PA0005", 2, 4], ["PA0011", 3, 4], ["PA0014", 2, 2], ["PA0006", 2, 3], ["PA0023", 1, 4]]);
    const rascunhoJuliana = this.montarLinhas("C00487", [
      ["PA0016", 2, 12], ["PA0002", 2, 10], ["PA0003", 2, 6], ["PA0020", 2, 6], ["PA0019", 2, 6], ["PA0034", 3, 4], ["PA0027", 1, 12],
      ["PA0031", 1, 10], ["PA0030", 1, 12], ["PA0004", 2, 4], ["PA0029", 2, 6], ["PA0035", 3, 3], ["PA0018", 2, 3], ["PA0032", 2, 2],
    ]);
    const docSeed = (tipo: "ORDER" | "DRAFT", docEntry: number, docNum: number, linhas: { itens: Documento["itens"]; total: string }, criadoUtc: string, entrega: number, referencia: string) => ({
      tipo, docEntry, docNum, total: linhas.total, criadoUtc, aberto: true, data: ontemData, dataEntrega: somarDiasLocal(ontemData, entrega), referencia, itens: linhas.itens,
    });
    const historico: (Omit<Reserva, "code" | "keyHash" | "atualizadoUtc"> & { doc?: Omit<Documento, "cardCode" | "portalId" | "portalHash"> })[] = [
      {
        operationId: "3b7e0c55-1d4a-4f7e-9a51-6d2f0e8a4c11",
        cardCode: "C00012",
        actorHash: ana,
        payloadHash: "c1".repeat(32),
        estado: "INTEGRADO",
        criadoUtc: ontem(9, 12),
        correlation: "c-7f21a0",
        docType: "ORDER",
        docEntry: 8811,
        docNum: 10482,
        erro: null,
        doc: docSeed("ORDER", 8811, 10482, pedidoAna, ontem(9, 12), 3, "OC 4466"),
      },
      {
        operationId: "a90d4e2b-5c3f-4b6a-8e1d-2f7c9b0a5e33",
        cardCode: "C00012",
        actorHash: ana,
        payloadHash: "d4".repeat(32),
        estado: "RESULTADO_INCERTO",
        criadoUtc: ontem(16, 47),
        correlation: "c-81b3c2",
        docType: null,
        docEntry: null,
        docNum: null,
        erro: "TIMEOUT_ORDERS",
      },
      {
        operationId: "e2f81a6c-7b9d-4c3e-a5f0-1b8d6c2e9f44",
        cardCode: "C00487",
        actorHash: juliana,
        payloadHash: "e7".repeat(32),
        estado: "AGUARDANDO_APROVACAO",
        criadoUtc: ontem(11, 5),
        correlation: "c-5a9d14",
        docType: "DRAFT",
        docEntry: 3310,
        docNum: 3310,
        erro: null,
        doc: docSeed("DRAFT", 3310, 3310, rascunhoJuliana, ontem(11, 5), 4, "OC BP-2291"),
      },
    ];
    for (const { doc, ...r } of historico) {
      const keyHash = chaveEnvio(EMPRESA_DEMO, r.cardCode, r.operationId);
      this.reservas.set(codeDaUdt(keyHash), { ...r, code: codeDaUdt(keyHash), keyHash, atualizadoUtc: r.criadoUtc });
      if (doc) this.documentos.push({ ...doc, cardCode: r.cardCode, portalId: r.operationId, portalHash: r.payloadHash });
    }
  }
}

function hojeLocal() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function somarDiasLocal(data: string, dias: number) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** PRNG pequeno e determinístico: a mesma semente gera a mesma demo. */
function mulberry32(semente: number) {
  let a = semente;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function semFalhas(): Falhas {
  return {
    sapForaDoAr: false,
    perderRespostaReserva: false,
    perderRespostaPedido: false,
    recusarPedido: false,
    falharAtualizacaoReserva: false,
  };
}

function publico(item: ItemSap & { seed?: ItemSeed }): ItemSap {
  const { seed: _seed, ...resto } = item;
  return structuredClone(resto);
}

function paraPortal(d: Documento): DocumentoPortal {
  return {
    tipo: d.tipo,
    docEntry: d.docEntry,
    docNum: d.docNum,
    cardCode: d.cardCode,
    portalId: d.portalId,
    portalHash: d.portalHash,
    total: d.total,
  };
}
