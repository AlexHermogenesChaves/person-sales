export type ErroDeCampo = { campo: string; mensagem: string };

/** Erro que a API devolve como está: código estável, mensagem segura para o comprador. */
export class ErroApi extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: ErroDeCampo[] = [],
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const erro = {
  schema: (fieldErrors: ErroDeCampo[] = []) =>
    new ErroApi(400, "INVALID_REQUEST", "A requisição tem campos inválidos ou não permitidos.", fieldErrors),
  semSessao: () => new ErroApi(401, "SESSION_REQUIRED", "Sua sessão expirou. Entre novamente."),
  semVinculo: () =>
    new ErroApi(403, "ACCESS_NOT_LINKED", "Seu usuário não está vinculado a um cliente habilitado no portal."),
  bloqueado: () =>
    new ErroApi(403, "ACCESS_BLOCKED", "O acesso deste usuário ao portal foi suspenso. Fale com seu representante."),
  csrf: () => new ErroApi(403, "CSRF_INVALID", "A requisição não pôde ser confirmada. Recarregue a página."),
  naoEncontrado: () => new ErroApi(404, "NOT_FOUND", "Protocolo não encontrado."),
  sapFora: () =>
    new ErroApi(503, "SAP_UNAVAILABLE", "O sistema de pedidos está indisponível no momento. Seu carrinho foi mantido."),
  limite: (segundos: number) =>
    new ErroApi(429, "RATE_LIMITED", "Muitas requisições em sequência. Aguarde um instante.", [], {
      retryAfter: segundos,
    }),
};
