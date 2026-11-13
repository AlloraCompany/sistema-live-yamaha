/**
 * Contratos (DTOs) trocados entre a API e a loja/painel.
 * Mudou aqui → TypeScript acusa os dois lados.
 */
import type { Goal } from './thermometer.js';

export type LiveStatus = 'em_breve' | 'ao_vivo' | 'encerrada';

export interface Testimonial {
  name: string;
  when: string;
  text: string;
}

export interface PublicLive {
  status: LiveStatus;
  startsAt: string | null;
  viewers: number;
  /** URL do player incorporado (vídeo da live ou transmissão ao vivo do canal). */
  youtubeEmbedUrl: string | null;
  youtubeUrl: string | null;
  voucherCents: number;
  /** Último dia para fechar a compra (YYYY-MM-DD). */
  validUntil: string | null;
  whatsapp: string | null;
  showThermometer: boolean;
  holdMinutes: number;
  testimonials: Testimonial[];
}

export interface Spec {
  label: string;
  value: string;
}

export interface Photo {
  url: string;
  color: string | null;
}

export interface PublicModel {
  id: number;
  slug: string;
  name: string;
  categoryLabel: string;
  colors: string[];
  photos: Photo[];
  priceTableCents: number;
  /** null quando a moto está bloqueada e o preço de live ainda não foi revelado. */
  priceLiveCents: number | null;
  downPaymentCents: number | null;
  installmentCents: number | null;
  installments: number;
  rateNote: string;
  specs: Spec[];
  description: string;
  released: boolean;
  releasedAt: string | null;
  /** Unidades livres para compra agora. */
  available: number;
  /** Unidades seguradas em pagamento (podem voltar se o pagamento não sair). */
  onHold: number;
  purchasable: boolean;
}

export interface PublicStore {
  id: number;
  name: string;
}

export interface SalesSummary {
  sold: number;
  goals: Goal[];
  /** Horários (ISO) das vendas da última hora, para "2 nos últimos 15 min". */
  recent: string[];
  lastSaleAt: string | null;
}

export interface LiveSnapshot {
  version: number;
  generatedAt: string;
  live: PublicLive;
  models: PublicModel[];
  stores: PublicStore[];
  sales: SalesSummary;
}

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'refund_pending'
  | 'refunded'
  | 'completed';

export type PaymentMethod = 'pix' | 'card';

export interface PixData {
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl: string | null;
  expiresAt: string | null;
}

export interface PaymentView {
  id: string;
  method: PaymentMethod;
  status: string;
  statusDetail: string | null;
  pix: PixData | null;
}

export interface OrderView {
  code: string;
  status: OrderStatus;
  statusReason: string | null;
  model: { slug: string; name: string; photoUrl: string | null };
  priceLiveCents: number;
  voucherCents: number;
  validUntil: string | null;
  customer: { name: string; cpfMasked: string; whatsapp: string; email: string };
  store: PublicStore;
  consultant: { name: string; whatsapp: string | null } | null;
  holdExpiresAt: string;
  serverTime: string;
  createdAt: string;
  paidAt: string | null;
  paidWith: PaymentMethod | null;
  payment: PaymentView | null;
  storeWhatsapp: string | null;
}

export interface CardPaymentInput {
  method: 'card';
  /** Token do cartão gerado pelo Card Payment Brick (o número do cartão nunca chega à API). */
  token: string;
  paymentMethodId: string;
  issuerId?: string | null;
  installments: number;
  /** Chave única desta tentativa de pagamento, reaproveitada em reenvios da mesma tentativa. */
  attemptKey: string;
  payer?: { email?: string; identificationType?: string; identificationNumber?: string };
}

export interface PixPaymentInput {
  method: 'pix';
}

export type PaymentInput = CardPaymentInput | PixPaymentInput;

export interface CreateOrderInput {
  modelSlug: string;
  storeId: number;
  customer: { name: string; cpf: string; whatsapp: string; email: string };
  acceptTerms: true;
  /**
   * Segredo gerado no navegador (32+ bytes base64url). Dá acesso ao pedido e torna a criação
   * idempotente: reenviar o mesmo token devolve o mesmo pedido em vez de segurar outra moto.
   */
  clientToken: string;
  payment: PaymentInput;
}

export interface CreateOrderResult {
  order: OrderView;
  /** Preenchido quando o pedido foi criado mas o pagamento precisa ser tentado de novo. */
  paymentError: { code: string; message: string } | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/* ---------- Painel interno ---------- */

export interface AdminLiveSettings {
  status: LiveStatus;
  startsAt: string | null;
  viewers: number;
  youtubeUrl: string | null;
  voucherCents: number;
  validUntil: string | null;
  whatsapp: string | null;
  showThermometer: boolean;
  showLockedPrices: boolean;
  holdMinutes: number;
  offlineSales: number;
  testimonials: Testimonial[];
}

export interface AdminUnit {
  id: number;
  color: string | null;
  chassis: string | null;
  status: 'available' | 'held' | 'sold' | 'removed';
  orderCode: string | null;
}

export interface AdminModel {
  id: number;
  slug: string;
  name: string;
  categoryLabel: string;
  colors: string[];
  photos: (Photo & { id: string })[];
  priceLiveCents: number;
  priceTableCents: number;
  downPaymentCents: number;
  installmentCents: number;
  installments: number;
  rateNote: string;
  specs: Spec[];
  description: string;
  offerActive: boolean;
  releasedAt: string | null;
  sort: number;
  stock: { available: number; held: number; sold: number };
  soldInLive: number;
}

export interface AdminOrderRow {
  id: string;
  code: string;
  status: OrderStatus;
  statusReason: string | null;
  createdAt: string;
  paidAt: string | null;
  holdExpiresAt: string;
  customerName: string;
  customerWhatsapp: string;
  customerCpfMasked: string;
  modelName: string;
  storeName: string;
  consultantName: string | null;
  voucherCents: number;
  paymentMethod: PaymentMethod | null;
  paymentStatus: string | null;
  /** Transação no Mercado Pago (a que pagou, ou a cobrança em aberto). */
  paymentId: string | null;
}

export interface AdminKpis {
  modelsReleased: number;
  modelsTotal: number;
  soldInLive: number;
  soldOnSite: number;
  offlineSales: number;
  nextGoal: { prize: string; remaining: number } | null;
  depositCents: number;
  waitlist: number;
  stockAvailable: number;
  pixInProgress: number;
  viewers: number;
}

export interface Consultant {
  id: number;
  name: string;
  whatsapp: string | null;
  storeId: number | null;
  active: boolean;
}

/** Tarefa de fundo (estorno, cancelamento, nota fiscal) que esgotou as tentativas automáticas. */
export interface AdminFailedJob {
  id: number;
  /** payment.cancel ou payment.refund. */
  type: string;
  orderCode: string | null;
  lastError: string | null;
  failedAt: string;
}
