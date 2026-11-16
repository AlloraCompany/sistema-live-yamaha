import {
  maskCpf,
  thermometerProgress,
  type AdminFailedJob,
  type AdminKpis,
  type AdminLiveSettings,
  type AdminModel,
  type AdminOrderRow,
  type AdminStore,
  type Consultant,
  type Goal,
} from '@lle/shared';
import type { Queryable } from '../../db/pool.js';

/** Leituras do painel interno (read models). */

export async function loadSettings(db: Queryable): Promise<AdminLiveSettings> {
  const { rows } = await db.query(`SELECT * FROM live_settings WHERE id = 1`);
  const s = rows[0]!;
  return {
    status: s.status,
    startsAt: s.starts_at?.toISOString() ?? null,
    viewers: s.viewers_display,
    youtubeUrl: s.youtube_url,
    voucherCents: s.voucher_amount_cents,
    validUntil: s.valid_until,
    offersUntil: s.offers_until?.toISOString() ?? null,
    whatsapp: s.whatsapp,
    showThermometer: s.show_thermometer,
    showLockedPrices: s.show_locked_prices,
    holdMinutes: s.hold_minutes,
    offlineSales: s.offline_sales,
    testimonials: s.testimonials,
  };
}

export async function loadGoals(db: Queryable): Promise<Goal[]> {
  const { rows } = await db.query<Goal>(`SELECT id, threshold, prize, description FROM goals ORDER BY threshold`);
  return rows;
}

export async function loadAdminModels(db: Queryable): Promise<AdminModel[]> {
  const { rows } = await db.query(
    `SELECT m.*,
            COALESCE(u.available, 0) AS available, COALESCE(u.held, 0) AS held, COALESCE(u.sold, 0) AS sold,
            COALESCE(o.sold_live, 0) AS sold_live,
            COALESCE(ph.photos, '[]'::json) AS photos
       FROM models m
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE status = 'available')::int AS available,
                count(*) FILTER (WHERE status = 'held')::int AS held,
                count(*) FILTER (WHERE status = 'sold')::int AS sold
           FROM units WHERE model_id = m.id) u ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS sold_live FROM orders WHERE model_id = m.id AND status IN ('paid', 'completed')) o ON true
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('id', p.id, 'url', '/media/' || p.id, 'color', p.color) ORDER BY p.sort, p.created_at) AS photos
           FROM model_photos p WHERE p.model_id = m.id) ph ON true
      ORDER BY m.sort, m.id`,
  );
  return rows.map((m) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    categoryLabel: m.category_label,
    colors: m.colors,
    photos: m.photos,
    priceLiveCents: m.price_live_cents,
    priceTableCents: m.price_table_cents,
    downPaymentCents: m.down_payment_cents,
    installmentCents: m.installment_cents,
    installments: m.installments,
    rateNote: m.rate_note,
    specs: m.specs,
    description: m.description,
    offerActive: m.offer_active,
    releasedAt: m.released_at?.toISOString() ?? null,
    sort: m.sort,
    stock: { available: m.available, held: m.held, sold: m.sold },
    soldInLive: m.sold_live,
  }));
}

export async function loadOrders(
  db: Queryable,
  filter: { status?: string; q?: string; limit?: number } = {},
): Promise<AdminOrderRow[]> {
  const q = filter.q?.trim();
  const digits = q?.replace(/\D/g, '');
  const { rows } = await db.query(
    `SELECT o.id, o.code, o.status, o.status_reason, o.created_at, o.paid_at, o.hold_expires_at,
            o.customer_name, o.customer_whatsapp, o.customer_cpf, o.model_name, o.preferred_color, s.name AS store_name,
            c.name AS consultant_name, o.voucher_amount_cents,
            p.id::text AS payment_id, p.method AS payment_method, p.status AS payment_status
       FROM orders o
       JOIN stores s ON s.id = o.store_id
       LEFT JOIN consultants c ON c.id = o.consultant_id
       LEFT JOIN payments p ON p.id = COALESCE(o.paid_payment_id, o.current_payment_id)
      WHERE ($1::text IS NULL OR o.status = $1)
        AND ($2::text IS NULL OR o.code ILIKE '%' || $2 || '%' OR o.customer_name ILIKE '%' || $2 || '%'
             OR ($3::text <> '' AND (o.customer_cpf = $3 OR o.customer_whatsapp LIKE '%' || $3 || '%')))
      ORDER BY o.created_at DESC
      LIMIT $4`,
    [filter.status ?? null, q || null, digits ?? '', Math.min(filter.limit ?? 300, 2000)],
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.status,
    statusReason: r.status_reason,
    createdAt: r.created_at.toISOString(),
    paidAt: r.paid_at?.toISOString() ?? null,
    holdExpiresAt: r.hold_expires_at.toISOString(),
    customerName: r.customer_name,
    customerWhatsapp: r.customer_whatsapp,
    customerCpfMasked: maskCpf(r.customer_cpf),
    modelName: r.model_name,
    preferredColor: r.preferred_color,
    storeName: r.store_name,
    consultantName: r.consultant_name,
    voucherCents: r.voucher_amount_cents,
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    paymentId: r.payment_id,
  }));
}

export async function loadKpis(db: Queryable): Promise<AdminKpis> {
  const [{ rows: k }, goals] = await Promise.all([
    db.query(
      `SELECT
         (SELECT count(*) FROM models WHERE offer_active)::int AS models_total,
         (SELECT count(*) FROM models WHERE offer_active AND released_at IS NOT NULL)::int AS models_released,
         (SELECT count(*) FROM orders WHERE status IN ('paid', 'completed'))::int AS sold_site,
         (SELECT COALESCE(sum(voucher_amount_cents), 0) FROM orders WHERE status IN ('paid', 'completed'))::bigint AS deposit,
         (SELECT count(*) FROM waitlist)::int AS waitlist,
         (SELECT count(*) FROM units u JOIN models m ON m.id = u.model_id WHERE u.status = 'available' AND m.offer_active)::int AS stock,
         (SELECT count(*) FROM orders WHERE status = 'pending_payment')::int AS pending,
         ls.offline_sales, ls.viewers_display
       FROM live_settings ls`,
    ),
    loadGoals(db),
  ]);
  const r = k[0]!;
  const sold = r.sold_site + r.offline_sales;
  const next = thermometerProgress(sold, goals).next;
  return {
    modelsReleased: r.models_released,
    modelsTotal: r.models_total,
    soldInLive: sold,
    soldOnSite: r.sold_site,
    offlineSales: r.offline_sales,
    nextGoal: next ? { prize: next.prize, remaining: next.remaining } : null,
    depositCents: Number(r.deposit),
    waitlist: r.waitlist,
    stockAvailable: r.stock,
    pixInProgress: r.pending,
    viewers: r.viewers_display,
  };
}

export async function loadStores(db: Queryable): Promise<AdminStore[]> {
  const { rows } = await db.query<AdminStore>(`SELECT id, name, whatsapp FROM stores WHERE active ORDER BY sort, id`);
  return rows;
}

export async function loadConsultants(db: Queryable): Promise<Consultant[]> {
  const { rows } = await db.query(`SELECT id, name, whatsapp, store_id, active FROM consultants ORDER BY active DESC, name`);
  return rows.map((r) => ({ id: r.id, name: r.name, whatsapp: r.whatsapp, storeId: r.store_id, active: r.active }));
}

/** Tarefas que falharam de vez e ainda não foram superadas por uma nova tentativa da mesma ação. */
export async function loadFailedJobs(db: Queryable): Promise<AdminFailedJob[]> {
  const { rows } = await db.query(
    `SELECT j.id, j.type, j.last_error, j.updated_at, o.code AS order_code
       FROM jobs j
       LEFT JOIN orders o ON o.id = (j.payload->>'orderId')::uuid
      WHERE j.status = 'failed'
        AND NOT EXISTS (SELECT 1 FROM jobs n WHERE n.dedupe_key = j.dedupe_key AND n.id > j.id AND n.status <> 'failed')
      ORDER BY j.updated_at DESC
      LIMIT 50`,
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    orderCode: r.order_code,
    lastError: r.last_error,
    failedAt: r.updated_at.toISOString(),
  }));
}
