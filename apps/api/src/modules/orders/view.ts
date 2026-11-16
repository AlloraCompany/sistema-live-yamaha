import { maskCpf, type OrderStatus, type OrderView, type PaymentMethod } from '@lle/shared';
import type { Queryable } from '../../db/pool.js';
import { Errors } from '../../lib/errors.js';

interface Row {
  code: string;
  status: OrderStatus;
  status_reason: string | null;
  model_slug: string;
  model_name: string;
  photo_id: string | null;
  price_live_cents: number;
  voucher_amount_cents: number;
  valid_until: string | null;
  customer_name: string;
  customer_cpf: string;
  customer_whatsapp: string;
  customer_email: string;
  preferred_color: string | null;
  store_id: number;
  store_name: string;
  consultant_name: string | null;
  consultant_whatsapp: string | null;
  hold_expires_at: Date;
  created_at: Date;
  paid_at: Date | null;
  paid_method: PaymentMethod | null;
  pay_id: string | null;
  pay_method: PaymentMethod | null;
  pay_status: string | null;
  pay_status_detail: string | null;
  pix_qr_code: string | null;
  pix_qr_base64: string | null;
  pix_ticket_url: string | null;
  pay_expires_at: Date | null;
  store_whatsapp: string | null;
}

/** Visão do pedido para o comprador (acesso só com o token do pedido). */
export async function loadOrderView(db: Queryable, orderId: string): Promise<OrderView> {
  const { rows } = await db.query<Row>(
    `SELECT o.code, o.status, o.status_reason, m.slug AS model_slug, o.model_name,
            (SELECT id::text FROM model_photos ph WHERE ph.model_id = m.id ORDER BY sort, created_at LIMIT 1) AS photo_id,
            o.price_live_cents, o.voucher_amount_cents, o.valid_until,
            o.customer_name, o.customer_cpf, o.customer_whatsapp, o.customer_email, o.preferred_color,
            s.id AS store_id, s.name AS store_name,
            c.name AS consultant_name, c.whatsapp AS consultant_whatsapp,
            o.hold_expires_at, o.created_at, o.paid_at, o.paid_method,
            p.id::text AS pay_id, p.method AS pay_method, p.status AS pay_status, p.status_detail AS pay_status_detail,
            p.pix_qr_code, p.pix_qr_base64, p.pix_ticket_url, p.expires_at AS pay_expires_at,
            s.whatsapp AS store_whatsapp
       FROM orders o
       JOIN models m ON m.id = o.model_id
       JOIN stores s ON s.id = o.store_id
       LEFT JOIN consultants c ON c.id = o.consultant_id
       LEFT JOIN payments p ON p.id = COALESCE(o.paid_payment_id, o.current_payment_id)
      WHERE o.id = $1`,
    [orderId],
  );
  const r = rows[0];
  if (!r) throw Errors.notFound('Pedido');
  return {
    code: r.code,
    status: r.status,
    statusReason: r.status_reason,
    model: { slug: r.model_slug, name: r.model_name, photoUrl: r.photo_id ? `/media/${r.photo_id}` : null },
    priceLiveCents: r.price_live_cents,
    voucherCents: r.voucher_amount_cents,
    validUntil: r.valid_until,
    customer: {
      name: r.customer_name,
      cpfMasked: maskCpf(r.customer_cpf),
      whatsapp: r.customer_whatsapp,
      email: r.customer_email,
    },
    preferredColor: r.preferred_color,
    store: { id: r.store_id, name: r.store_name },
    consultant: r.consultant_name ? { name: r.consultant_name, whatsapp: r.consultant_whatsapp } : null,
    holdExpiresAt: r.hold_expires_at.toISOString(),
    serverTime: new Date().toISOString(),
    createdAt: r.created_at.toISOString(),
    paidAt: r.paid_at?.toISOString() ?? null,
    paidWith: r.paid_method,
    payment: r.pay_id
      ? {
          id: r.pay_id,
          method: r.pay_method!,
          status: r.pay_status!,
          statusDetail: r.pay_status_detail,
          pix:
            r.pay_method === 'pix' && r.pix_qr_code && r.pix_qr_base64
              ? {
                  qrCode: r.pix_qr_code,
                  qrCodeBase64: r.pix_qr_base64,
                  ticketUrl: r.pix_ticket_url,
                  expiresAt: r.pay_expires_at?.toISOString() ?? null,
                }
              : null,
        }
      : null,
    storeWhatsapp: r.store_whatsapp,
  };
}
