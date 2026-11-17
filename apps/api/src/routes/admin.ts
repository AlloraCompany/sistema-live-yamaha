import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { normalizeBrPhone } from '@lle/shared';
import { parse } from '../http/validation.js';
import { AppError, Errors } from '../lib/errors.js';
import { isUniqueViolation } from '../db/pool.js';
import { slugify } from '../lib/text.js';
import { audit, type Actor } from '../modules/audit.js';
import { addUnits, removeOneAvailableUnit } from '../modules/inventory/units.js';
import { loadOrderView } from '../modules/orders/view.js';
import { renderReceiptsPdf } from '../modules/orders/receipt.js';
import { buildLiveReportXlsx, validOrderIds } from '../modules/reports/live-report.js';
import { SESSION_COOKIE } from '../modules/auth/sessions.js';
import { youtubeLinks } from '../modules/live/youtube.js';
import type { LiveStatus } from '@lle/shared';
import {
  loadAdminModels,
  loadConsultants,
  loadFailedJobs,
  loadGoals,
  loadKpis,
  loadOrders,
  loadSettings,
  loadStores,
} from '../modules/admin/queries.js';

const cents = z.coerce.number().int().min(0).max(100_000_000);
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((s) => (s == null || s.trim() === '' ? null : s.trim()));

const loginSchema = z.object({ password: z.string().min(1).max(200) });

const liveSchema = z
  .object({
    status: z.enum(['em_breve', 'ao_vivo', 'encerrada']),
    startsAt: z.string().datetime({ offset: true }).nullable(),
    viewers: z.coerce.number().int().min(0).max(10_000_000),
    // Recusa na hora o que não vira player; antes o link era salvo e a loja ficava sem vídeo, sem aviso.
    youtubeUrl: optionalText(300).refine(
      (v) => v == null || youtubeLinks(v) !== null,
      'Link do YouTube não reconhecido. Cole o link do vídeo da live ou o ID do canal.',
    ),
    voucherCents: cents.refine((v) => v >= 100, 'Valor do voucher inválido.'),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    offersUntil: z.string().datetime({ offset: true }).nullable(),
    whatsapp: z
      .string()
      .nullable()
      .transform((s, ctx) => {
        if (!s || !s.trim()) return null;
        const n = normalizeBrPhone(s);
        if (!n) {
          ctx.addIssue({ code: 'custom', message: 'WhatsApp da loja inválido (use DDD + número).' });
          return z.NEVER;
        }
        return n;
      }),
    showThermometer: z.boolean(),
    showLockedPrices: z.boolean(),
    testimonials: z
      .array(z.object({ name: z.string().trim().min(2).max(60), when: z.string().trim().max(60), text: z.string().trim().min(5).max(400) }))
      .max(12),
  })
  .partial();

const LIVE_COLUMN: Record<keyof z.infer<typeof liveSchema>, string> = {
  status: 'status',
  startsAt: 'starts_at',
  viewers: 'viewers_display',
  youtubeUrl: 'youtube_url',
  voucherCents: 'voucher_amount_cents',
  validUntil: 'valid_until',
  offersUntil: 'offers_until',
  whatsapp: 'whatsapp',
  showThermometer: 'show_thermometer',
  showLockedPrices: 'show_locked_prices',
  testimonials: 'testimonials',
};

const goalsSchema = z.object({
  goals: z
    .array(
      z.object({
        threshold: z.coerce.number().int().min(1).max(100_000),
        prize: z.string().trim().min(1).max(60),
        description: z.string().trim().max(200).default(''),
      }),
    )
    .max(8)
    .refine((g) => new Set(g.map((x) => x.threshold)).size === g.length, 'Duas metas com o mesmo número de motos.'),
});

const specSchema = z.object({ label: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(80) });

const modelSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífen.')
    .max(60)
    .optional(),
  categoryLabel: z.string().trim().max(60).default(''),
  colors: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  priceLiveCents: cents.refine((v) => v > 0, 'Informe o preço na live.'),
  priceTableCents: cents.refine((v) => v > 0, 'Informe o preço de tabela.'),
  downPaymentCents: cents.default(0),
  installmentCents: cents.default(0),
  installments: z.coerce.number().int().min(1).max(120).default(48),
  rateNote: z.string().trim().max(120).default(''),
  specs: z.array(specSchema).max(20).default([]),
  description: z.string().trim().max(1000).default(''),
  offerActive: z.boolean().default(true),
  sort: z.coerce.number().int().min(0).max(1000).default(0),
});
// O estoque total só é alterado em moto que já existe (a criação sempre começa com 0).
const modelPatchSchema = modelSchema.extend({ stockTotal: z.coerce.number().int().min(0).max(1000) }).partial();

const MODEL_COLUMN: Record<keyof z.infer<typeof modelPatchSchema>, string> = {
  stockTotal: 'stock_total',
  name: 'name',
  slug: 'slug',
  categoryLabel: 'category_label',
  colors: 'colors',
  priceLiveCents: 'price_live_cents',
  priceTableCents: 'price_table_cents',
  downPaymentCents: 'down_payment_cents',
  installmentCents: 'installment_cents',
  installments: 'installments',
  rateNote: 'rate_note',
  specs: 'specs',
  description: 'description',
  offerActive: 'offer_active',
  sort: 'sort',
};

const unitsAddSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(200).default(1),
  color: optionalText(30),
  chassis: optionalText(40),
});

const consultantSchema = z.object({
  name: z.string().trim().min(2).max(80),
  whatsapp: z
    .string()
    .nullable()
    .optional()
    .transform((s) => (s ? normalizeBrPhone(s) : null)),
  storeId: z.coerce.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
});

const storeSchema = z.object({
  name: z.string().trim().min(2).max(60),
  whatsapp: z
    .string()
    .nullable()
    .optional()
    .transform((s, ctx) => {
      if (!s || !s.trim()) return null;
      const n = normalizeBrPhone(s);
      if (!n) {
        ctx.addIssue({ code: 'custom', message: 'WhatsApp da loja inválido (use DDD + número).' });
        return z.NEVER;
      }
      return n;
    }),
});

/** "2026-11-12" no fuso de Brasília, para nomes de arquivo. */
function formatIsoDayCompact(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

const ADMIN: Actor = { type: 'admin' };

const idParam = z.object({ id: z.coerce.number().int().positive() });
const uuidParam = z.object({ id: z.string().uuid() });

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  const db = ctx.db;
  const publicOrigin = new URL(ctx.config.PUBLIC_BASE_URL).origin;

  /** Toda rota do painel (menos login/logout/me) exige sessão válida. */
  async function requireAdmin(req: FastifyRequest): Promise<void> {
    if (!(await ctx.auth.isValid(req.cookies[SESSION_COOKIE]))) throw Errors.unauthorized();
    // Proteção CSRF: cookie SameSite=Strict + exige origem própria em requisições que alteram dados.
    if (ctx.config.isProduction && req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && origin !== publicOrigin) throw Errors.forbidden();
    }
  }

  /* ---------- Sessão ---------- */

  // Sem bloqueio de conta (seria uma forma de trancar a dona do painel para fora durante a live):
  // o limite por IP + scrypt + senha de 12+ caracteres tornam a força bruta inviável.
  app.post('/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { password } = parse(loginSchema, req.body);
    const token = await ctx.auth.login(password, { ip: req.ip, userAgent: req.headers['user-agent'] ?? null });
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: ctx.config.cookieSecure,
      sameSite: 'strict',
      path: '/api/admin',
      maxAge: ctx.config.SESSION_TTL_HOURS * 3600,
    });
    await audit(db.pool, ADMIN, 'auth.login', 'session', 'admin', { ip: req.ip });
    return { ok: true };
  });

  app.post('/logout', async (req, reply) => {
    await ctx.auth.logout(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/api/admin' });
    return { ok: true };
  });

  app.get('/me', async (req) => {
    if (!(await ctx.auth.isValid(req.cookies[SESSION_COOKIE]))) throw Errors.unauthorized();
    return { ok: true };
  });

  await app.register(securedRoutes);

  async function securedRoutes(app: FastifyInstance): Promise<void> {
    app.addHook('preHandler', requireAdmin);

    /* ---------- Painel ---------- */

    app.get('/dashboard', async (_req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const [kpis, settings, goals, models, orders, consultants, stores, failedJobs] = await Promise.all([
        loadKpis(db.pool),
        loadSettings(db.pool),
        loadGoals(db.pool),
        loadAdminModels(db.pool),
        loadOrders(db.pool, { limit: 300 }),
        loadConsultants(db.pool),
        loadStores(db.pool),
        loadFailedJobs(db.pool),
      ]);
      return { kpis, settings, goals, models, orders, consultants, stores, failedJobs };
    });

    app.get('/stream', (_req, reply) => {
      reply.hijack();
      if (!app.hub.admins.open(reply.raw)) {
        reply.raw.writeHead(503).end();
      }
    });

    /* ---------- Transmissão e termômetro ---------- */

    app.patch('/live', async (req) => {
      const input = parse(liveSchema, req.body);
      const keys = Object.keys(input) as (keyof typeof input)[];
      if (keys.length === 0) throw Errors.validation('Nada para salvar.');
      await db.tx(async (tx) => {
        const current = (
          await tx.query<{ status: LiveStatus; youtube_url: string | null }>(
            `SELECT status, youtube_url FROM live_settings WHERE id = 1 FOR UPDATE`,
          )
        ).rows[0]!;
        // O status acompanha o link da transmissão:
        //  - sem link, a live fica "Em breve" (não dá para colocar "Ao vivo");
        //  - ao salvar um link novo com a live "Em breve", ela passa sozinha para "Ao vivo";
        //  - "Encerrada" só muda por clique.
        const url = 'youtubeUrl' in input ? (input.youtubeUrl ?? null) : current.youtube_url;
        if (input.status === 'ao_vivo' && !url) {
          throw Errors.validation('Cole o link da live do YouTube e salve antes de colocar "Ao vivo".');
        }
        const patch: typeof input = { ...input };
        if (patch.status === undefined) {
          if (!url && current.status === 'ao_vivo') patch.status = 'em_breve';
          else if (url && url !== current.youtube_url && current.status === 'em_breve') patch.status = 'ao_vivo';
        }
        const cols = Object.keys(patch) as (keyof typeof patch)[];
        const sets = cols.map((k, i) => `${LIVE_COLUMN[k]} = $${i + 1}`);
        const values = cols.map((k) => (k === 'testimonials' ? JSON.stringify(patch[k]) : patch[k]));
        await tx.query(`UPDATE live_settings SET ${sets.join(', ')}, updated_at = now() WHERE id = 1`, values);
        await audit(tx, ADMIN, 'live.updated', 'live_settings', 1, patch as Record<string, unknown>);
      });
      return loadSettings(db.pool);
    });

    app.post('/live/offline-sales', async (req) => {
      const { delta } = parse(z.object({ delta: z.union([z.literal(1), z.literal(-1)]) }), req.body);
      return db.tx(async (tx) => {
        const { rows } = await tx.query<{ offline_sales: number }>(
          `UPDATE live_settings SET offline_sales = offline_sales + $1, updated_at = now()
            WHERE id = 1 AND offline_sales + $1 >= 0 RETURNING offline_sales`,
          [delta],
        );
        if (!rows[0]) {
          throw new AppError('INVALID_STATE', 'O ajuste manual já está em zero: o termômetro não fica abaixo das vendas do site.', 409);
        }
        await tx.query(`INSERT INTO offline_sale_events (delta) VALUES ($1)`, [delta]);
        await audit(tx, ADMIN, 'sales.offline', 'live_settings', 1, { delta });
        return { offlineSales: rows[0].offline_sales };
      });
    });

    app.put('/goals', async (req) => {
      const { goals } = parse(goalsSchema, req.body);
      await db.tx(async (tx) => {
        await tx.query(`DELETE FROM goals`);
        for (const g of goals) {
          await tx.query(`INSERT INTO goals (threshold, prize, description) VALUES ($1, $2, $3)`, [g.threshold, g.prize, g.description]);
        }
        await audit(tx, ADMIN, 'goals.updated', 'goals', 'all', { goals });
      });
      return loadGoals(db.pool);
    });

    /* ---------- Motos, liberação e estoque ---------- */

    app.post('/models', async (req, reply) => {
      const m = parse(modelSchema, req.body);
      const slug = m.slug ?? slugify(m.name);
      try {
        const { rows } = await db.query<{ id: number }>(
          `INSERT INTO models (slug, name, category_label, colors, price_live_cents, price_table_cents, down_payment_cents,
                               installment_cents, installments, rate_note, specs, description, offer_active, sort)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
          [slug, m.name, m.categoryLabel, m.colors, m.priceLiveCents, m.priceTableCents, m.downPaymentCents,
            m.installmentCents, m.installments, m.rateNote, JSON.stringify(m.specs), m.description, m.offerActive, m.sort],
        );
        await audit(db.pool, ADMIN, 'model.created', 'model', rows[0]!.id, { name: m.name });
        reply.status(201);
        return { id: rows[0]!.id };
      } catch (err) {
        if (isUniqueViolation(err, 'models_slug_key')) throw Errors.validation('Já existe uma moto com este endereço (slug).');
        throw err;
      }
    });

    app.patch('/models/:id', async (req) => {
      const { id } = parse(idParam, req.params);
      const patch = parse(modelPatchSchema, req.body);
      const keys = Object.keys(patch) as (keyof typeof patch)[];
      if (keys.length === 0) throw Errors.validation('Nada para salvar.');
      const values = keys.map((k) => (k === 'specs' ? JSON.stringify(patch[k]) : patch[k]));
      const sets = keys.map((k, i) => `${MODEL_COLUMN[k]} = $${i + 2}`);
      try {
        const res = await db.query(`UPDATE models SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [id, ...values]);
        if (res.rowCount === 0) throw Errors.notFound('Moto');
      } catch (err) {
        if (isUniqueViolation(err, 'models_slug_key')) throw Errors.validation('Já existe uma moto com este endereço (slug).');
        throw err;
      }
      // Moto fora da loja não fica em destaque.
      if (patch.offerActive === false) await db.query(`UPDATE live_settings SET featured_model_id = NULL WHERE featured_model_id = $1`, [id]);
      await audit(db.pool, ADMIN, 'model.updated', 'model', id, patch as Record<string, unknown>);
      return { ok: true };
    });

    // Destaque: a moto que o apresentador está mostrando agora (uma por vez; aparece no topo da loja).
    app.post('/models/:id/feature', async (req) => {
      const { id } = parse(idParam, req.params);
      const { featured } = parse(z.object({ featured: z.boolean() }), req.body);
      if (featured) {
        const res = await db.query(
          `UPDATE live_settings SET featured_model_id = $1 WHERE id = 1 AND EXISTS (SELECT 1 FROM models WHERE id = $1 AND offer_active)`,
          [id],
        );
        if (res.rowCount === 0) throw Errors.notFound('Moto');
      } else {
        await db.query(`UPDATE live_settings SET featured_model_id = NULL WHERE featured_model_id = $1`, [id]);
      }
      await audit(db.pool, ADMIN, featured ? 'model.featured' : 'model.unfeatured', 'model', id);
      return { featuredModelId: featured ? id : null };
    });

    app.post('/models/:id/release', async (req) => {
      const { id } = parse(idParam, req.params);
      const { released } = parse(z.object({ released: z.boolean() }), req.body);
      const res = await db.query(
        `UPDATE models SET released_at = CASE WHEN $2 THEN COALESCE(released_at, now()) ELSE NULL END, updated_at = now()
          WHERE id = $1 RETURNING released_at`,
        [id, released],
      );
      if (res.rowCount === 0) throw Errors.notFound('Moto');
      // Liberar é o momento do anúncio: a moto entra em destaque. Bloquear tira o destaque dela.
      if (released) await db.query(`UPDATE live_settings SET featured_model_id = $1 WHERE id = 1`, [id]);
      else await db.query(`UPDATE live_settings SET featured_model_id = NULL WHERE featured_model_id = $1`, [id]);
      await audit(db.pool, ADMIN, released ? 'model.released' : 'model.locked', 'model', id);
      return { releasedAt: res.rows[0]!.released_at };
    });

    app.post('/models/release-all', async (req) => {
      const { released } = parse(z.object({ released: z.boolean() }), req.body);
      await db.query(
        `UPDATE models SET released_at = CASE WHEN $1 THEN COALESCE(released_at, now()) ELSE NULL END, updated_at = now()
          WHERE offer_active`,
        [released],
      );
      if (!released) await db.query(`UPDATE live_settings SET featured_model_id = NULL WHERE featured_model_id IS NOT NULL`);
      await audit(db.pool, ADMIN, released ? 'model.release_all' : 'model.lock_all', 'model', 'all');
      return { ok: true };
    });

    app.get('/models/:id/units', async (req) => {
      const { id } = parse(idParam, req.params);
      const { rows } = await db.query(
        `SELECT u.id, u.color, u.chassis, u.status, o.code AS order_code
           FROM units u LEFT JOIN orders o ON o.id = u.order_id
          WHERE u.model_id = $1 AND u.status <> 'removed' ORDER BY u.id`,
        [id],
      );
      return rows.map((r) => ({ id: r.id, color: r.color, chassis: r.chassis, status: r.status, orderCode: r.order_code }));
    });

    app.post('/models/:id/units', async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(unitsAddSchema, req.body);
      if (input.chassis && input.quantity > 1) throw Errors.validation('Com chassi, cadastre uma unidade por vez.');
      try {
        const ids = await db.tx(async (tx) => {
          const exists = await tx.query(`SELECT 1 FROM models WHERE id = $1`, [id]);
          if (!exists.rowCount) throw Errors.notFound('Moto');
          const created = await addUnits(tx, id, Array.from({ length: input.quantity }, () => ({ color: input.color, chassis: input.chassis })));
          await audit(tx, ADMIN, 'stock.added', 'model', id, { quantity: input.quantity, unitIds: created });
          return created;
        });
        return { added: ids.length };
      } catch (err) {
        if (isUniqueViolation(err, 'units_chassis_key')) throw Errors.validation('Chassi já cadastrado.');
        throw err;
      }
    });

    app.post('/models/:id/units/remove', async (req) => {
      const { id } = parse(idParam, req.params);
      const { unitId } = parse(z.object({ unitId: z.coerce.number().int().positive().optional() }), req.body ?? {});
      const removed = await db.tx(async (tx) => {
        const r = await removeOneAvailableUnit(tx, id, unitId);
        if (r !== null) await audit(tx, ADMIN, 'stock.removed', 'model', id, { unitId: r });
        return r;
      });
      if (removed === null) {
        throw new AppError('NO_FREE_UNIT', 'Não há unidade livre para retirar: as restantes estão em pagamento ou vendidas.', 409);
      }
      return { removed };
    });

    app.patch('/units/:id', async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(z.object({ color: optionalText(30), chassis: optionalText(40) }), req.body);
      try {
        const res = await db.query(`UPDATE units SET color = $2, chassis = $3, updated_at = now() WHERE id = $1`, [id, input.color, input.chassis]);
        if (!res.rowCount) throw Errors.notFound('Unidade');
      } catch (err) {
        if (isUniqueViolation(err, 'units_chassis_key')) throw Errors.validation('Chassi já cadastrado.');
        throw err;
      }
      await audit(db.pool, ADMIN, 'unit.updated', 'unit', id, input);
      return { ok: true };
    });

    app.post('/models/:id/photos', async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const { color } = parse(z.object({ color: optionalText(30) }), req.query);
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length < 100) throw Errors.validation('Envie uma imagem WEBP, PNG, JPEG ou AVIF de até 6 MB.');
      const type = req.headers['content-type']!.split(';')[0]!.trim();
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO model_photos (model_id, color, content_type, bytes, sort)
         VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(sort), 0) + 1 FROM model_photos WHERE model_id = $1))
         RETURNING id`,
        [id, color, type, body],
      );
      await audit(db.pool, ADMIN, 'photo.added', 'model', id, { photoId: rows[0]!.id });
      reply.status(201);
      return { id: rows[0]!.id, url: `/media/${rows[0]!.id}` };
    });

    app.delete('/photos/:id', async (req) => {
      const { id } = parse(uuidParam, req.params);
      const res = await db.query(`DELETE FROM model_photos WHERE id = $1 RETURNING model_id`, [id]);
      if (!res.rowCount) throw Errors.notFound('Foto');
      await audit(db.pool, ADMIN, 'photo.removed', 'model', res.rows[0]!.model_id, { photoId: id });
      return { ok: true };
    });

    /* ---------- Reservas ---------- */

    app.get('/orders', async (req) => {
      const q = parse(
        z.object({ status: z.string().max(20).optional(), q: z.string().max(80).optional(), limit: z.coerce.number().int().max(2000).optional() }),
        req.query,
      );
      return loadOrders(db.pool, q);
    });

    /* ---------- Relatório pós-live (gerentes das lojas) ---------- */

    const reportScope = (query: unknown) => {
      const { store } = parse(z.object({ store: z.coerce.number().int().positive().optional() }), query);
      return { storeId: store ?? null };
    };
    const fileName = (kind: string, storeName: string | null, ext: string) =>
      `${kind}-${formatIsoDayCompact(new Date())}-${storeName ? slugify(storeName) : 'todas-as-lojas'}.${ext}`;

    app.get('/reports/live.xlsx', async (req, reply) => {
      const scope = reportScope(req.query);
      const { file, storeName } = await buildLiveReportXlsx(db.pool, scope);
      await audit(db.pool, ADMIN, 'report.exported', 'report', 'live.xlsx', { storeId: scope.storeId });
      return reply
        .header('Cache-Control', 'no-store')
        .header('Content-Disposition', `attachment; filename="${fileName('relatorio-live', storeName, 'xlsx')}"`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(file);
    });

    app.get('/reports/receipts.pdf', async (req, reply) => {
      const scope = reportScope(req.query);
      const { ids, storeName } = await validOrderIds(db.pool, scope);
      const views = [];
      for (const id of ids) views.push(await loadOrderView(db.pool, id));
      const title = `Comprovantes da live · ${storeName ?? 'todas as lojas'}`;
      const pdf = await renderReceiptsPdf(views, { legalName: ctx.config.STORE_LEGAL_NAME, cnpj: ctx.config.STORE_CNPJ ?? null }, title);
      await audit(db.pool, ADMIN, 'report.exported', 'report', 'receipts.pdf', { storeId: scope.storeId, count: views.length });
      return reply
        .header('Cache-Control', 'no-store')
        .header('Content-Disposition', `attachment; filename="${fileName('comprovantes-live', storeName, 'pdf')}"`)
        .type('application/pdf')
        .send(pdf);
    });

    app.post('/orders/:id/complete', async (req) => {
      const { id } = parse(uuidParam, req.params);
      await ctx.orders.completeOrder(id, ADMIN);
      return { ok: true };
    });

    app.post('/orders/:id/refund', async (req) => {
      const { id } = parse(uuidParam, req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(200) }), req.body);
      await ctx.orders.refundOrder(id, ADMIN, reason);
      return { ok: true };
    });

    app.get('/waitlist', async () => {
      const { rows } = await db.query(
        `SELECT w.id, w.name, w.whatsapp, w.created_at, m.name AS model_name
           FROM waitlist w JOIN models m ON m.id = w.model_id ORDER BY w.created_at DESC LIMIT 1000`,
      );
      return rows;
    });

    // "Eu quero!": quantos toques cada moto esgotada recebeu (sem dados de cliente).
    app.get('/wants', async () => {
      const { rows } = await db.query(
        `SELECT m.id AS model_id, m.name AS model_name, w.count, w.updated_at
           FROM model_wants w JOIN models m ON m.id = w.model_id WHERE w.count > 0 ORDER BY w.count DESC, m.name`,
      );
      return rows;
    });

    /* ---------- Lojas ---------- */

    // Nome e WhatsApp de cada loja: o cliente escolhe a loja de preferência no checkout e o botão do
    // comprovante abre o WhatsApp dela.
    app.patch('/stores/:id', async (req) => {
      const { id } = parse(idParam, req.params);
      const s = parse(storeSchema, req.body);
      const res = await db.query(`UPDATE stores SET name = $2, whatsapp = $3 WHERE id = $1 AND active`, [id, s.name, s.whatsapp]);
      if (!res.rowCount) throw Errors.notFound('Loja');
      await audit(db.pool, ADMIN, 'store.updated', 'store', id, s);
      return loadStores(db.pool);
    });

    // Loja nova. Se já existiu uma com o mesmo nome e foi removida, ela volta (os pedidos antigos continuam nela).
    app.post('/stores', async (req, reply) => {
      const s = parse(storeSchema, req.body);
      const slug = slugify(s.name);
      if (!slug) throw Errors.validation('Informe o nome da loja.');
      const id = await db.tx(async (tx) => {
        const same = (await tx.query<{ id: number; active: boolean }>(`SELECT id, active FROM stores WHERE slug = $1 FOR UPDATE`, [slug])).rows[0];
        if (same?.active) throw Errors.validation('Já existe uma loja com este nome.');
        const row = same
          ? await tx.query<{ id: number }>(`UPDATE stores SET name = $2, whatsapp = $3, active = true WHERE id = $1 RETURNING id`, [same.id, s.name, s.whatsapp])
          : await tx.query<{ id: number }>(
              `INSERT INTO stores (slug, name, whatsapp, sort) VALUES ($1, $2, $3, (SELECT COALESCE(max(sort), 0) + 1 FROM stores)) RETURNING id`,
              [slug, s.name, s.whatsapp],
            );
        await audit(tx, ADMIN, 'store.created', 'store', row.rows[0]!.id, s);
        return row.rows[0]!.id;
      });
      reply.status(201);
      return { id, stores: await loadStores(db.pool) };
    });

    // Remover = tirar da lista do checkout. A loja não é apagada: os pedidos já feitos nela continuam no relatório.
    app.delete('/stores/:id', async (req) => {
      const { id } = parse(idParam, req.params);
      await db.tx(async (tx) => {
        const { rows } = await tx.query<{ id: number }>(`SELECT id FROM stores WHERE active FOR UPDATE`);
        if (!rows.some((r) => r.id === id)) throw Errors.notFound('Loja');
        if (rows.length === 1) throw new AppError('LAST_STORE', 'A loja precisa de pelo menos uma loja para o cliente escolher.', 409);
        await tx.query(`UPDATE stores SET active = false WHERE id = $1`, [id]);
        await audit(tx, ADMIN, 'store.removed', 'store', id);
      });
      return loadStores(db.pool);
    });

    /* ---------- Equipe ---------- */

    app.post('/consultants', async (req) => {
      const c = parse(consultantSchema, req.body);
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO consultants (name, whatsapp, store_id, active) VALUES ($1, $2, $3, $4) RETURNING id`,
        [c.name, c.whatsapp, c.storeId ?? null, c.active],
      );
      await audit(db.pool, ADMIN, 'consultant.created', 'consultant', rows[0]!.id);
      return loadConsultants(db.pool);
    });

    app.patch('/consultants/:id', async (req) => {
      const { id } = parse(idParam, req.params);
      const c = parse(consultantSchema, req.body);
      const res = await db.query(
        `UPDATE consultants SET name = $2, whatsapp = $3, store_id = $4, active = $5 WHERE id = $1`,
        [id, c.name, c.whatsapp, c.storeId ?? null, c.active],
      );
      if (!res.rowCount) throw Errors.notFound('Consultor');
      await audit(db.pool, ADMIN, 'consultant.updated', 'consultant', id);
      return loadConsultants(db.pool);
    });

    /* ---------- Tarefas com falha ---------- */

    // Estorno/cancelamento/nota que esgotou as tentativas automáticas (ex.: conta do MP sem saldo
    // para estornar): depois de resolver a causa, a tentativa recomeça do zero.
    app.post('/jobs/:id/retry', async (req) => {
      const { id } = parse(idParam, req.params);
      try {
        const res = await db.query(
          `UPDATE jobs SET status = 'queued', attempts = 0, run_at = now(), locked_until = NULL, updated_at = now()
            WHERE id = $1 AND status = 'failed'`,
          [id],
        );
        if (!res.rowCount) throw new AppError('INVALID_STATE', 'Esta tarefa não está mais com falha.', 409);
      } catch (err) {
        if (isUniqueViolation(err, 'jobs_dedupe_active_uq')) {
          throw new AppError('ALREADY_QUEUED', 'Já existe uma nova tentativa desta tarefa em andamento.', 409);
        }
        throw err;
      }
      await audit(db.pool, ADMIN, 'job.retry', 'job', id);
      return { ok: true };
    });
  }
}
