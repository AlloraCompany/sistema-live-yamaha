import { requestJson, withRetry } from '../../lib/http.js';
import { UpstreamError } from '../../lib/errors.js';
import { hmacSha256Hex, safeEqualHex } from '../../lib/crypto.js';
import type { CreateCardParams, CreatePixParams, GatewayPayment, PaymentGateway, PayerData } from './gateway.js';

/**
 * Cliente REST do Mercado Pago (Checkout Transparente / API de Pagamentos).
 * Toda criação e estorno usa X-Idempotency-Key: repetir a chamada com a mesma chave
 * devolve o mesmo pagamento em vez de cobrar duas vezes.
 */
export interface MercadoPagoOptions {
  accessToken: string;
  apiBase: string;
  notificationUrl: string | null;
  statementDescriptor: string;
  timeoutMs: number;
}

interface MpPayment {
  id: number;
  status: string;
  status_detail?: string | null;
  external_reference?: string | null;
  transaction_amount: number;
  payment_method_id?: string;
  payment_type_id?: string;
  date_last_updated?: string | null;
  date_approved?: string | null;
  date_of_expiration?: string | null;
  point_of_interaction?: {
    transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string };
  };
}

export class MercadoPagoGateway implements PaymentGateway {
  constructor(private readonly opts: MercadoPagoOptions) {}

  private headers(idempotencyKey?: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.accessToken}`,
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    };
  }

  private payer(p: PayerData, identificationType = 'CPF', identificationNumber = p.cpf) {
    return {
      email: p.email,
      first_name: p.firstName,
      last_name: p.lastName,
      identification: { type: identificationType, number: identificationNumber },
    };
  }

  async createPix(p: CreatePixParams): Promise<GatewayPayment> {
    const body = {
      transaction_amount: p.amountCents / 100,
      description: p.description,
      payment_method_id: 'pix',
      external_reference: p.orderId,
      date_of_expiration: toMpDate(p.expiresAt),
      payer: this.payer(p.payer),
      ...(this.opts.notificationUrl ? { notification_url: this.opts.notificationUrl } : {}),
    };
    // Mesma chave de idempotência → repetir após timeout é seguro.
    const res = await withRetry(() =>
      requestJson<MpPayment>('mercadopago', {
        method: 'POST',
        url: `${this.opts.apiBase}/v1/payments`,
        headers: this.headers(p.idempotencyKey),
        body,
        timeoutMs: this.opts.timeoutMs,
      }),
    );
    return normalize(res.body);
  }

  async createCard(p: CreateCardParams): Promise<GatewayPayment> {
    const body = {
      transaction_amount: p.amountCents / 100,
      description: p.description,
      token: p.token,
      installments: p.installments,
      payment_method_id: p.paymentMethodId,
      ...(p.issuerId ? { issuer_id: Number(p.issuerId) || p.issuerId } : {}),
      external_reference: p.orderId,
      statement_descriptor: this.opts.statementDescriptor,
      binary_mode: false,
      payer: this.payer(p.payer, p.payer.identificationType, p.payer.identificationNumber ?? p.payer.cpf),
      ...(this.opts.notificationUrl ? { notification_url: this.opts.notificationUrl } : {}),
    };
    const res = await withRetry(() =>
      requestJson<MpPayment>('mercadopago', {
        method: 'POST',
        url: `${this.opts.apiBase}/v1/payments`,
        headers: this.headers(p.idempotencyKey),
        body,
        timeoutMs: this.opts.timeoutMs,
      }),
    );
    return normalize(res.body);
  }

  async get(paymentId: string): Promise<GatewayPayment> {
    const res = await withRetry(() =>
      requestJson<MpPayment>('mercadopago', {
        method: 'GET',
        url: `${this.opts.apiBase}/v1/payments/${encodeURIComponent(paymentId)}`,
        headers: this.headers(),
        timeoutMs: this.opts.timeoutMs,
      }),
    );
    return normalize(res.body);
  }

  async cancel(paymentId: string): Promise<GatewayPayment> {
    const res = await withRetry(() =>
      requestJson<MpPayment>('mercadopago', {
        method: 'PUT',
        url: `${this.opts.apiBase}/v1/payments/${encodeURIComponent(paymentId)}`,
        headers: this.headers(),
        body: { status: 'cancelled' },
        timeoutMs: this.opts.timeoutMs,
      }),
    );
    return normalize(res.body);
  }

  async refund(paymentId: string, idempotencyKey: string): Promise<void> {
    await withRetry(() =>
      requestJson('mercadopago', {
        method: 'POST',
        url: `${this.opts.apiBase}/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
        // Estorno de Pix pode ficar "em processamento"; com este header o MP responde 201 em vez de erro.
        headers: { ...this.headers(idempotencyKey), 'X-Render-In-Process-Refunds': 'true' },
        body: {},
        timeoutMs: this.opts.timeoutMs,
      }),
    );
  }
}

function normalize(p: MpPayment): GatewayPayment {
  if (!p || typeof p.id !== 'number' || typeof p.status !== 'string') {
    throw new UpstreamError('mercadopago', 'resposta de pagamento inválida', 200, false, p);
  }
  const tx = p.point_of_interaction?.transaction_data;
  const isPix = p.payment_method_id === 'pix';
  return {
    id: String(p.id),
    status: p.status,
    statusDetail: p.status_detail ?? null,
    externalReference: p.external_reference ?? null,
    amountCents: Math.round(p.transaction_amount * 100),
    method: isPix ? 'pix' : 'card',
    updatedAt: p.date_last_updated ?? null,
    approvedAt: p.date_approved ?? null,
    expiresAt: p.date_of_expiration ?? null,
    pix:
      isPix && tx?.qr_code && tx.qr_code_base64
        ? { qrCode: tx.qr_code, qrCodeBase64: tx.qr_code_base64, ticketUrl: tx.ticket_url ?? null }
        : null,
  };
}

/** Formato aceito pelo MP: 2026-11-18T19:42:00.000-03:00 (horário de Brasília, que não tem horário de verão). */
export function toMpDate(d: Date): string {
  const local = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return local.toISOString().replace('Z', '-03:00');
}

/**
 * Valida o header x-signature dos Webhooks do Mercado Pago.
 * Manifesto: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (partes ausentes são omitidas),
 * HMAC-SHA256 com a "assinatura secreta" da aplicação, comparado ao campo v1.
 */
export function verifyMercadoPagoSignature(params: {
  secret: string;
  signatureHeader: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
}): boolean {
  const { secret, signatureHeader, requestId, dataId } = params;
  if (!signatureHeader) return false;
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of signatureHeader.split(',')) {
    const [k, v] = part.split('=', 2).map((s) => s.trim());
    if (k === 'ts') ts = v;
    if (k === 'v1') v1 = v;
  }
  if (!ts || !v1) return false;
  let manifest = '';
  if (dataId) manifest += `id:${/[A-Z]/.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  return safeEqualHex(hmacSha256Hex(secret, manifest), v1);
}
