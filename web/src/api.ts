// Cliente da API do portal. Mesma origem, cookie HttpOnly; o único segredo que o
// front segura é o token CSRF, em memória.

export type ErroDeCampo = { campo: string; mensagem: string };

export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: ErroDeCampo[],
    readonly corpo: Record<string, unknown>,
  ) {
    super(message);
  }
}

let csrf = "";
let aoExpirar: () => void = () => {};

export const definirCsrf = (token: string) => {
  csrf = token;
};
export const quandoSessaoExpirar = (fn: () => void) => {
  aoExpirar = fn;
};

type Opcoes = { method?: "GET" | "POST"; body?: unknown; headers?: Record<string, string> };

export async function api<T>(caminho: string, opcoes: Opcoes = {}): Promise<{ status: number; dados: T }> {
  const metodo = opcoes.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(caminho, {
      method: metodo,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(metodo === "POST" ? { "Content-Type": "application/json", "X-CSRF-Token": csrf } : {}),
        ...opcoes.headers,
      },
      body: opcoes.body === undefined ? undefined : JSON.stringify(opcoes.body),
    });
  } catch {
    throw new ErroDaApi(0, "NETWORK", "Sem conexão com o portal. Verifique sua internet.", [], {});
  }
  const tipo = res.headers.get("content-type") ?? "";
  const corpo = res.status === 204 ? null : tipo.includes("json") ? await res.json() : null;
  if (!res.ok) {
    const c = (corpo ?? {}) as Record<string, unknown>;
    const erro = new ErroDaApi(
      res.status,
      String(c.code ?? "HTTP_" + res.status),
      String(c.message ?? "Resposta inesperada do portal."),
      (c.fieldErrors as ErroDeCampo[]) ?? [],
      c,
    );
    if (res.status === 401 && caminho.startsWith("/api/")) aoExpirar();
    throw erro;
  }
  return { status: res.status, dados: corpo as T };
}

// ---- DTOs do contrato (08-contrato-api.md) ------------------------------------------

export type Eu = {
  user: { name: string; email: string };
  customer: { code: string; name: string };
  permissions: string[];
  csrfToken: string;
  sapMode: "simulado" | "service-layer";
};

export type Unidade = {
  entry: number;
  label: string;
  description: string;
  multiple: string;
  referenceUnitPrice: string | null;
  priceOrigin: "LISTA" | "ESPECIAL" | "QUANTIDADE" | null;
};

export type ItemCatalogo = {
  itemCode: string;
  description: string;
  group: string;
  units: Unidade[];
  currency: "BRL";
  availability: "AVAILABLE" | "ON_REQUEST";
  priceRequiresReview: boolean;
  imageUrl: string | null;
};

export type Endereco = { code: string; street: string; district: string; city: string; state: string; zip: string };

export type LinhaRevisada = {
  itemCode: string;
  description: string;
  uomEntry: number;
  unit: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  tax: string;
  priceOrigin: "LISTA" | "ESPECIAL" | "QUANTIDADE";
};

export type Revisao = {
  operationId: string;
  reviewToken: string;
  expiresAt: string;
  currency: "BRL";
  subtotal: string;
  tax: string | null;
  expenses: string | null;
  total: string | null;
  totalsAreFinal: boolean;
  approvalExpected: boolean;
  lines: LinhaRevisada[];
  shipTo: { codigo: string; logradouro: string; bairro: string; cidade: string; uf: string; cep: string };
  requestedDate: string;
  customerReference: string;
  comments: string;
};

export type EstadoEnvio = "PROCESSANDO" | "INTEGRADO" | "AGUARDANDO_APROVACAO" | "REJEITADO" | "RESULTADO_INCERTO";

export type Envio = {
  operationId: string;
  status: EstadoEnvio;
  document: { type: "ORDER" | "DRAFT"; docEntry: number | null; docNum: number | null } | null;
  statusUrl: string;
  correlationId: string;
  code?: string;
  message: string;
};
