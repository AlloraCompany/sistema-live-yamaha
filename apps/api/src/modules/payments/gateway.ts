import type { PaymentMethod } from '@lle/shared';

/** Situação normalizada de um pagamento no provedor (Mercado Pago). */
export interface GatewayPayment {
  id: string;
  status: string;
  statusDetail: string | null;
  externalReference: string | null;
  amountCents: number;
  method: PaymentMethod;
  /** Usado para descartar leituras mais antigas que a já gravada. */
  updatedAt: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  pix: { qrCode: string; qrCodeBase64: string; ticketUrl: string | null } | null;
}

export interface PayerData {
  email: string;
  firstName: string;
  lastName: string;
  cpf: string;
}

export interface CreatePixParams {
  idempotencyKey: string;
  orderId: string;
  amountCents: number;
  description: string;
  payer: PayerData;
  expiresAt: Date;
}

export interface CreateCardParams {
  idempotencyKey: string;
  orderId: string;
  amountCents: number;
  description: string;
  token: string;
  paymentMethodId: string;
  issuerId: string | null;
  installments: number;
  payer: PayerData & { identificationType?: string; identificationNumber?: string };
}

export interface PaymentGateway {
  createPix(p: CreatePixParams): Promise<GatewayPayment>;
  createCard(p: CreateCardParams): Promise<GatewayPayment>;
  get(paymentId: string): Promise<GatewayPayment>;
  /** Cancela pagamento ainda não aprovado (pending / in_process / authorized). */
  cancel(paymentId: string): Promise<GatewayPayment>;
  /** Estorno total; a chave garante um único estorno mesmo com repetições. */
  refund(paymentId: string, idempotencyKey: string): Promise<void>;
}

/** Status do MP agrupados pelo efeito que têm sobre o pedido. */
export type PaymentOutcome = 'approved' | 'pending' | 'failed' | 'reversed' | 'unknown';

export function paymentOutcome(status: string): PaymentOutcome {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'pending':
    case 'in_process':
    case 'authorized':
    case 'in_mediation':
      return 'pending';
    case 'rejected':
    case 'cancelled':
      return 'failed';
    case 'refunded':
    case 'charged_back':
      return 'reversed';
    default:
      return 'unknown';
  }
}
