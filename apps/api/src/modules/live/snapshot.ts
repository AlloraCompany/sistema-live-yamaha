import type { Goal, LiveSnapshot, LiveStatus, PublicModel, Spec, Testimonial } from '@lle/shared';
import type { Queryable } from '../../db/pool.js';
import { youtubeLinks } from './youtube.js';

interface SettingsRow {
  status: LiveStatus;
  starts_at: Date | null;
  viewers_display: number;
  youtube_url: string | null;
  voucher_amount_cents: number;
  valid_until: string | null;
  offers_until: Date | null;
  whatsapp: string | null;
  show_thermometer: boolean;
  show_locked_prices: boolean;
  hold_minutes: number;
  offline_sales: number;
  testimonials: Testimonial[];
}

interface ModelRow {
  id: number;
  slug: string;
  name: string;
  category_label: string;
  colors: string[];
  price_live_cents: number;
  price_table_cents: number;
  down_payment_cents: number;
  installment_cents: number;
  installments: number;
  rate_note: string;
  specs: Spec[];
  description: string;
  offer_active: boolean;
  released_at: Date | null;
  available: number;
  held: number;
  photos: { id: string; color: string | null }[];
}

/**
 * O site aceita compras com a live no ar e, depois de encerrada, até o prazo das condições (`offers_until`).
 * Sem prazo configurado, as compras fecham no encerramento.
 */
export function isSalesOpen(status: LiveStatus, offersUntil: Date | null, now = Date.now()): boolean {
  if (status === 'ao_vivo') return true;
  return status === 'encerrada' && offersUntil !== null && offersUntil.getTime() > now;
}

/**
 * Monta o estado público da live (o que todo espectador vê). Calculado uma vez por mudança
 * e compartilhado por todas as conexões — nunca por requisição de cliente.
 */
export async function buildSnapshot(db: Queryable, version: number): Promise<LiveSnapshot> {
  const [settingsRes, modelsRes, storesRes, goalsRes, salesRes, recentRes] = await Promise.all([
    db.query<SettingsRow>(`SELECT * FROM live_settings WHERE id = 1`),
    db.query<ModelRow>(
      `SELECT m.id, m.slug, m.name, m.category_label, m.colors, m.price_live_cents, m.price_table_cents,
              m.down_payment_cents, m.installment_cents, m.installments, m.rate_note, m.specs, m.description,
              m.offer_active, m.released_at,
              COALESCE(u.available, 0) AS available, COALESCE(u.held, 0) AS held,
              COALESCE(ph.photos, '[]'::json) AS photos
         FROM models m
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE status = 'available')::int AS available,
                  count(*) FILTER (WHERE status = 'held')::int AS held
             FROM units WHERE model_id = m.id) u ON true
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('id', p.id, 'color', p.color) ORDER BY p.sort, p.created_at) AS photos
             FROM model_photos p WHERE p.model_id = m.id) ph ON true
        WHERE m.offer_active
        ORDER BY m.sort, m.id`,
    ),
    db.query<{ id: number; name: string }>(`SELECT id, name FROM stores WHERE active ORDER BY sort, id`),
    db.query<Goal>(`SELECT id, threshold, prize, description FROM goals ORDER BY threshold`),
    db.query<{ sold: number; last_paid: Date | null }>(
      `SELECT count(*)::int AS sold, max(paid_at) AS last_paid FROM orders WHERE status IN ('paid', 'completed')`,
    ),
    db.query<{ at: Date }>(
      `SELECT at FROM (
         SELECT paid_at AS at FROM orders WHERE status IN ('paid', 'completed') AND paid_at > now() - interval '60 minutes'
         UNION ALL
         SELECT created_at FROM offline_sale_events WHERE delta = 1 AND created_at > now() - interval '60 minutes'
       ) s ORDER BY at DESC LIMIT 200`,
    ),
  ]);

  const s = settingsRes.rows[0]!;
  const yt = youtubeLinks(s.youtube_url);
  // Compras abertas: live no ar, ou encerrada ainda dentro do prazo das condições (ver salesOpen em service.ts).
  const salesOpen = isSalesOpen(s.status, s.offers_until);
  const lastRecent = recentRes.rows[0]?.at ?? null; // inclui os ajustes manuais (+1) da última hora
  const lastPaid = salesRes.rows[0]!.last_paid;
  const lastSaleAt = [lastPaid, lastRecent].filter((d): d is Date => !!d).sort((a, b) => +b - +a)[0] ?? null;

  const models: PublicModel[] = modelsRes.rows.map((m) => {
    const released = m.released_at !== null;
    const showPrice = released || s.show_locked_prices;
    return {
      id: m.id,
      slug: m.slug,
      name: m.name,
      categoryLabel: m.category_label,
      colors: m.colors,
      photos: m.photos.map((p) => ({ url: `/media/${p.id}`, color: p.color })),
      priceTableCents: m.price_table_cents,
      priceLiveCents: showPrice ? m.price_live_cents : null,
      downPaymentCents: showPrice ? m.down_payment_cents : null,
      installmentCents: showPrice ? m.installment_cents : null,
      installments: m.installments,
      rateNote: m.rate_note,
      specs: m.specs,
      description: m.description,
      released,
      releasedAt: m.released_at?.toISOString() ?? null,
      available: m.available,
      onHold: m.held,
      purchasable: released && m.offer_active && salesOpen && m.available > 0,
    };
  });

  return {
    version,
    generatedAt: new Date().toISOString(),
    live: {
      status: s.status,
      startsAt: s.starts_at?.toISOString() ?? null,
      viewers: s.viewers_display,
      youtubeEmbedUrl: yt?.embedUrl ?? null,
      youtubeUrl: yt?.watchUrl ?? null,
      voucherCents: s.voucher_amount_cents,
      validUntil: s.valid_until,
      offersUntil: s.offers_until?.toISOString() ?? null,
      salesOpen,
      whatsapp: s.whatsapp,
      showThermometer: s.show_thermometer,
      holdMinutes: s.hold_minutes,
      testimonials: s.testimonials,
    },
    models,
    stores: storesRes.rows,
    sales: {
      sold: salesRes.rows[0]!.sold + s.offline_sales,
      goals: goalsRes.rows,
      recent: recentRes.rows.map((r) => r.at.toISOString()),
      lastSaleAt: lastSaleAt?.toISOString() ?? null,
    },
  };
}
