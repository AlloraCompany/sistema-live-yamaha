import { inject } from 'vitest';
import type { CreateOrderInput, CreateOrderResult, LiveSnapshot } from '@lle/shared';
import { loadConfig, type Config } from '../../src/config.js';
import { createContext, type AppContext } from '../../src/context.js';
import { createLogger } from '../../src/logger.js';
import { LiveHub } from '../../src/modules/live/hub.js';
import { JobWorker } from '../../src/modules/jobs/worker.js';
import { buildServer } from '../../src/server.js';
import { randomToken } from '../../src/lib/crypto.js';
import { createDatabaseFromTemplate } from './postgres.js';
import { FakeMercadoPago } from './fake-mercadopago.js';
import { cpf } from './cpf.js';

export { cpf };

export const MP_SECRET = 'test-webhook-secret';
export const ADMIN_PASSWORD = 'SenhaDoPainel2026';

export function testConfig(databaseUrl: string, mpUrl: string, extra: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_BASE_URL: 'https://live.exemplo.test',
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: '60',
    LOG_LEVEL: 'silent',
    MP_ACCESS_TOKEN: 'TEST-access-token',
    MP_PUBLIC_KEY: 'TEST-public-key',
    MP_WEBHOOK_SECRET: MP_SECRET,
    MP_API_BASE: mpUrl,
    MP_TIMEOUT_MS: '3000',
    ADMIN_PASSWORD,
    ORDER_RATE_LIMIT_PER_MINUTE: '1000000',
    API_RATE_LIMIT_PER_MINUTE: '1000000',
    HOLD_GRACE_SECONDS: '0',
    ...extra,
  });
}

export function orderInput(n: number, overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    modelSlug: 'fazer-fz25-abs',
    storeId: 1,
    customer: {
      name: `Cliente Teste ${n}`,
      cpf: cpf(n),
      whatsapp: `(48) 9${String(80000000 + n).slice(-8)}`,
      email: `cliente${n}@exemplo.test`,
    },
    acceptTerms: true,
    clientToken: randomToken(32),
    payment: { method: 'pix' },
    ...overrides,
  };
}

export interface Harness {
  ctx: AppContext;
  app: Awaited<ReturnType<typeof buildServer>>;
  hub: LiveHub;
  mp: FakeMercadoPago;
  worker: JobWorker;
  createOrder(input: CreateOrderInput): Promise<{ status: number; body: CreateOrderResult & { error?: { code: string } } }>;
  webhook(paymentId: number): Promise<number>;
  snapshot(): Promise<LiveSnapshot>;
  close(): Promise<void>;
}

export async function createHarness(extra: Record<string, string> = {}): Promise<Harness> {
  const url = await createDatabaseFromTemplate(inject('pgBaseUrl'));
  const mp = await FakeMercadoPago.start();
  const config = testConfig(url, mp.url, extra);
  const log = createLogger('silent');
  const ctx = createContext(config, log);
  const hub = new LiveHub(ctx.db, log, { minIntervalMs: 0, maxClients: 50_000, safetyRefreshMs: 600_000 });
  await hub.start();
  const app = await buildServer(ctx, hub);
  await app.ready();
  const worker = new JobWorker({ db: ctx.db, log, orders: ctx.orders, gateway: ctx.gateway });

  return {
    ctx,
    app,
    hub,
    mp,
    worker,
    async createOrder(input) {
      const res = await app.inject({ method: 'POST', url: '/api/orders', payload: input });
      return { status: res.statusCode, body: res.json() };
    },
    async webhook(paymentId) {
      const res = await app.inject(mp.webhook(paymentId, MP_SECRET));
      return res.statusCode;
    },
    async snapshot() {
      await hub.refreshNow();
      return JSON.parse(hub.current().json) as LiveSnapshot;
    },
    async close() {
      hub.stop();
      await app.close();
      await ctx.db.close();
      await mp.close();
    },
  };
}

/** Catálogo mínimo: live no ar, metas do wireframe e um modelo liberado com N unidades. */
export async function seedLive(
  ctx: AppContext,
  opts: { units?: number; released?: boolean; status?: 'em_breve' | 'ao_vivo' | 'encerrada'; slug?: string } = {},
): Promise<number> {
  const slug = opts.slug ?? 'fazer-fz25-abs';
  await ctx.db.query(
    `UPDATE live_settings SET status = $1, valid_until = '2026-12-18', whatsapp = '5548999990000', hold_minutes = 30 WHERE id = 1`,
    [opts.status ?? 'ao_vivo'],
  );
  await ctx.db.query(
    `INSERT INTO goals (threshold, prize, description) VALUES (10, 'Tanque cheio', ''), (20, 'Emplacamento grátis', ''), (50, 'Capacete Yamaha', '')
     ON CONFLICT (threshold) DO NOTHING`,
  );
  const { rows } = await ctx.db.query<{ id: number }>(
    `INSERT INTO models (slug, name, category_label, colors, price_live_cents, price_table_cents, down_payment_cents, installment_cents, released_at)
     VALUES ($1, $2, 'Naked · 2026', '{Preta,Cinza,Azul}', 2299000, 2449000, 300000, 51900, $3) RETURNING id`,
    [slug, slug === 'fazer-fz25-abs' ? 'Fazer FZ25 ABS' : slug, opts.released === false ? null : new Date()],
  );
  const modelId = rows[0]!.id;
  if (opts.units) {
    await ctx.db.query(`INSERT INTO units (model_id) SELECT $1 FROM generate_series(1, $2)`, [modelId, opts.units]);
  }
  await ctx.db.query(`INSERT INTO consultants (name, store_id) VALUES ('Consultora Ana', 1), ('Consultor Bruno', 1)`);
  return modelId;
}

/** Invariantes de consistência que precisam valer SEMPRE, depois de qualquer cenário. */
export async function assertInvariants(ctx: AppContext): Promise<void> {
  const checks: [string, string][] = [
    ['unidade vendida/segurada sem pedido correspondente', `
      SELECT u.id FROM units u LEFT JOIN orders o ON o.id = u.order_id
       WHERE u.status IN ('held','sold') AND (o.id IS NULL OR o.unit_id <> u.id)`],
    ['pedido pago sem unidade vendida', `
      SELECT o.id FROM orders o LEFT JOIN units u ON u.order_id = o.id AND u.status = 'sold'
       WHERE o.status IN ('paid','completed') AND u.id IS NULL`],
    ['pedido pendente sem unidade segurada', `
      SELECT o.id FROM orders o LEFT JOIN units u ON u.order_id = o.id AND u.status = 'held'
       WHERE o.status = 'pending_payment' AND u.id IS NULL`],
    ['unidade segurada por pedido que não está pendente', `
      SELECT u.id FROM units u JOIN orders o ON o.id = u.order_id WHERE u.status = 'held' AND o.status <> 'pending_payment'`],
    ['unidade vendida para pedido não pago', `
      SELECT u.id FROM units u JOIN orders o ON o.id = u.order_id WHERE u.status = 'sold' AND o.status NOT IN ('paid','completed')`],
    ['pedido pago sem pagamento aprovado', `
      SELECT o.id FROM orders o LEFT JOIN payments p ON p.id = o.paid_payment_id
       WHERE o.status IN ('paid','completed') AND (p.id IS NULL OR p.status <> 'approved')`],
    ['código de voucher repetido', `SELECT code FROM orders GROUP BY code HAVING count(*) > 1`],
  ];
  for (const [label, sql] of checks) {
    const { rows } = await ctx.db.query(sql);
    if (rows.length > 0) throw new Error(`Invariante violada: ${label} (${JSON.stringify(rows.slice(0, 5))})`);
  }
}
