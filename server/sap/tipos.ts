// Contrato entre o portal e o SAP. O domínio só conhece esta interface; quem fala
// OData mora em `serviceLayer.ts` (real) ou `simulado.ts` (POC sem SAP).

export type Acesso = {
  code: string;
  identityHash: string;
  cardCode: string;
  ativo: boolean;
};

export type Cliente = {
  cardCode: string;
  nome: string;
  ativo: boolean;
  habilitadoPortal: boolean;
};

export type UnidadeVenda = {
  entry: number;
  codigo: string;
  descricao: string;
  /** Múltiplo de venda nesta unidade ("1", "10"). */
  multiplo: string;
};

export type ItemSap = {
  itemCode: string;
  descricao: string;
  grupo: string;
  vendavel: boolean;
  ativo: boolean;
  publicado: boolean;
  unidades: UnidadeVenda[];
  disponibilidade: "DISPONIVEL" | "SOB_CONSULTA";
  /** Há faixa de preço por quantidade: o preço do catálogo é referência. */
  precoPorQuantidade: boolean;
  /** URL de foto de origem aprovada (contrato: imageUrl), ou null. */
  imagem: string | null;
};

export type Endereco = {
  codigo: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
};

export type ConsultaPreco = { itemCode: string; uomEntry: number; quantidade: string };

export type PrecoEfetivo = ConsultaPreco & {
  precoUnitario: string;
  origem: "LISTA" | "ESPECIAL" | "QUANTIDADE";
};

export type LinhaPedido = {
  itemCode: string;
  quantidade: string;
  uomEntry: number;
  precoUnitario: string;
};

/** Pedido montado pelo servidor. Nenhum campo vem livre do navegador. */
export type PedidoSap = {
  cardCode: string;
  dataEntrega: string;
  shipToCode: string;
  referencia: string;
  observacao: string;
  linhas: LinhaPedido[];
  portalId?: string;
  portalHash?: string;
};

export type PreviaPedido = {
  linhas: { itemCode: string; uomEntry: number; totalLinha: string; imposto: string }[];
  subtotal: string;
  impostos: string | null;
  despesas: string | null;
  total: string | null;
  totaisFinais: boolean;
  caiEmAprovacao: boolean;
};

export type EstadoEnvio =
  | "PROCESSANDO"
  | "INTEGRADO"
  | "AGUARDANDO_APROVACAO"
  | "REJEITADO"
  | "RESULTADO_INCERTO";

/** Linha da UDT @PRT_REQUEST. */
export type Reserva = {
  code: string;
  keyHash: string;
  operationId: string;
  cardCode: string;
  actorHash: string;
  payloadHash: string;
  estado: EstadoEnvio;
  criadoUtc: string;
  atualizadoUtc: string;
  correlation: string;
  docType: "ORDER" | "DRAFT" | null;
  docEntry: number | null;
  docNum: number | null;
  erro: string | null;
};

export type DocumentoPortal = {
  tipo: "ORDER" | "DRAFT";
  docEntry: number | null;
  docNum: number | null;
  cardCode: string;
  portalId: string;
  portalHash: string;
  total: string | null;
};

export type OrigemPedido = "PORTAL" | "VENDEDOR" | "EDI";

/**
 * Situação na visão do cliente, medida pelo faturamento (sem "entregue": rastreio fica
 * fora do escopo). Aguardando aprovação = rascunho em OWDD; Aprovado = ORDR aberto sem
 * OINV; Parcial = ORDR aberto com OINV parcial; Faturado = ORDR fechado.
 */
export type SituacaoPedido = "AGUARDANDO_APROVACAO" | "APROVADO" | "PARCIAL" | "FATURADO" | "CANCELADO";

export type LinhaPedidoCliente = {
  itemCode: string;
  descricao: string;
  quantidade: string;
  uomEntry: number;
  unidade: string;
  precoUnitario: string;
  total: string;
  faturada: string;
};

/** Pedido do cliente como o SAP guarda — de qualquer origem, não só do portal. */
export type PedidoCliente = {
  tipo: "ORDER" | "DRAFT";
  docEntry: number;
  docNum: number;
  data: string;
  /** DocDueDate: previsão, não promessa de entrega. */
  dataEntrega: string;
  total: string;
  faturado: string;
  situacao: SituacaoPedido;
  origem: OrigemPedido;
  referencia: string;
  /** U_PRT_ID quando nasceu no portal: liga ao protocolo. */
  portalId: string | null;
  /** Datas do trilho Enviado → Aprovado → Faturado → Concluído (null = ainda não). */
  marcos: { aprovado: string | null; faturado: string | null; concluido: string | null };
  linhas: LinhaPedidoCliente[];
};

/** Envio do portal ainda sem desfecho confirmado — vai para "precisa da sua atenção". */
export type EnvioPendente = { operationId: string; estado: "PROCESSANDO" | "RESULTADO_INCERTO"; criadoUtc: string };

export interface SapGateway {
  readonly modo: "simulado" | "service-layer";
  buscarAcesso(code: string): Promise<Acesso | null>;
  buscarCliente(cardCode: string): Promise<Cliente | null>;
  listarItens(filtro: { busca: string; depoisDe: string | null; limite: number }): Promise<ItemSap[]>;
  /** Lê itens por código sem filtro de publicação — para recusar o que não pode ser vendido. */
  buscarItens(codigos: string[]): Promise<ItemSap[]>;
  precos(cardCode: string, data: string, consultas: ConsultaPreco[]): Promise<PrecoEfetivo[]>;
  listarEnderecos(cardCode: string): Promise<Endereco[]>;
  /** Documento calculado pelo SAP sem gravar (impostos, despesas, aprovação). */
  preverPedido(pedido: PedidoSap): Promise<PreviaPedido>;
  criarReserva(reserva: Reserva): Promise<"CRIADA" | "JA_EXISTE">;
  lerReserva(code: string): Promise<Reserva | null>;
  atualizarReserva(code: string, mudanca: Partial<Reserva>): Promise<void>;
  /** Uma tentativa só. Aprovação devolve DRAFT, não erro. */
  criarPedido(pedido: PedidoSap): Promise<DocumentoPortal>;
  buscarDocumentosPortal(cardCode: string, portalId: string): Promise<DocumentoPortal[]>;
  /** Pedidos e rascunhos abertos do cliente desde `desde` (YYYY-MM-DD). Só leitura. */
  listarPedidosCliente(cardCode: string, desde: string): Promise<PedidoCliente[]>;
  /** Linhas de @PRT_REQUEST do cliente em PROCESSANDO ou RESULTADO_INCERTO. */
  listarEnviosPendentes(cardCode: string): Promise<EnvioPendente[]>;
}

/** Falhou antes de a requisição sair: nada foi gravado. */
export class SapIndisponivel extends Error {
  readonly desfecho = "nao_executado";
}

/** A requisição saiu e a resposta se perdeu: pode ter gravado. */
export class SapIndeterminado extends Error {
  readonly desfecho = "indeterminado";
}

/** O SAP recebeu e recusou. Repetir sem corrigir não adianta. */
export class SapRecusa extends Error {
  readonly desfecho = "recusado";
  constructor(
    readonly codigo: string,
    message: string,
  ) {
    super(message);
  }
}
