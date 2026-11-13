/** Erros de domínio com código estável (consumido pela loja) e status HTTP. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (message: string, details?: unknown) => new AppError('VALIDATION', message, 422, details),
  notFound: (what = 'Registro') => new AppError('NOT_FOUND', `${what} não encontrado.`, 404),
  unauthorized: () => new AppError('UNAUTHORIZED', 'Faça login para continuar.', 401),
  forbidden: () => new AppError('FORBIDDEN', 'Seu perfil não tem permissão para esta ação.', 403),
  liveNotOpen: () =>
    new AppError('LIVE_NOT_OPEN', 'As compras abrem quando a live estiver no ar.', 409),
  notReleased: () =>
    new AppError('NOT_RELEASED', 'Esta moto ainda não foi liberada na live. Fique de olho no anúncio!', 409),
  offerInactive: () => new AppError('OFFER_INACTIVE', 'Esta oferta não está mais ativa.', 409),
  soldOut: () => new AppError('SOLD_OUT', 'Esgotada: todas as unidades desta moto já foram vendidas.', 409),
  allOnHold: () =>
    new AppError(
      'ALL_ON_HOLD',
      'Todas as unidades estão seguradas para outros clientes que estão pagando. Se algum Pix não for pago, a moto volta em alguns minutos.',
      409,
    ),
  pendingElsewhere: () =>
    new AppError(
      'PENDING_ELSEWHERE',
      'Já existe uma reserva em andamento com este CPF para esta moto. Conclua o pagamento no aparelho onde ela foi iniciada ou aguarde a reserva expirar.',
      409,
    ),
  holdExpired: () =>
    new AppError('HOLD_EXPIRED', 'O tempo da reserva acabou e a unidade voltou para os outros clientes.', 409),
  orderClosed: () => new AppError('ORDER_CLOSED', 'Este pedido não aceita mais pagamentos.', 409),
  paymentProvider: (message = 'Não foi possível falar com o Mercado Pago. Tente de novo em instantes.') =>
    new AppError('PAYMENT_PROVIDER_ERROR', message, 502),
  paymentsNotConfigured: () =>
    new AppError('PAYMENTS_NOT_CONFIGURED', 'Pagamentos ainda não configurados neste ambiente.', 503),
} as const;

/** Erro de chamada HTTP externa. `retryable` indica se repetir a mesma chamada pode resolver. */
export class UpstreamError extends Error {
  constructor(
    public readonly service: string,
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
    public readonly body?: unknown,
  ) {
    super(`${service}: ${message}`);
    this.name = 'UpstreamError';
  }
}

/** Job que deve ser repetido mais tarde sem contar como falha (ex.: estorno ainda processando no MP). */
export class RetryLater extends Error {
  constructor(public readonly delayMs: number, reason: string) {
    super(reason);
  }
}
