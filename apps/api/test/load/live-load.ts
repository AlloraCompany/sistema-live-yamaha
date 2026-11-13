/**
 * Teste de carga do cenário de live (HTTP real, API em processo separado, Postgres real com fsync ligado).
 *
 *   npm run test:load                         → padrão: 5.000 espectadores, 2.000 compradores, 300 pagamentos
 *   VIEWERS=10000 BUYERS=3000 npm run test:load
 *
 * Fases:
 *  1. Espectadores: N conexões SSE simultâneas recebendo o estado inicial.
 *  2. Propagação: uma venda de balcão → tempo até TODOS os espectadores verem o termômetro mudar.
 *  3. Leitura: clientes sem SSE martelando o snapshot (pior caso: sem CDN na frente).
 *  4. Rajada de compra: M compradores ao mesmo tempo disputando 10 motos (com os N espectadores conectados).
 *  5. Tempestade de pagamentos: P Pix aprovados ao mesmo tempo, cada webhook entregue 3x.
 *  6. Consistência: invariantes no banco + termômetro entregue aos espectadores bate com as vendas.
 *
 * O Mercado Pago é um dublê HTTP de teste com latência simulada (nunca o ambiente real).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createMigratedTemplate, freePort, startPostgres } from '../support/postgres.js';
import { FakeMercadoPago } from '../support/fake-mercadopago.js';
import { cpf } from '../support/cpf.js';

const VIEWERS = Number(process.env.VIEWERS ?? 5000);
const BUYERS = Number(process.env.BUYERS ?? 2000);
const PAYMENTS = Number(process.env.PAYMENTS ?? 300);
const READERS = Number(process.env.READERS ?? 200);
const READ_SECONDS = Number(process.env.READ_SECONDS ?? 10);
const SECRET = 'load-webhook-secret';
const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '../..');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function pct(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! * 10) / 10;
}
function stats(values: number[]) {
  return { n: values.length, p50: pct(values, 50), p95: pct(values, 95), p99: pct(values, 99), max: pct(values, 100) };
}
function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

const report: Record<string, unknown> = { startedAt: new Date().toISOString(), config: { VIEWERS, BUYERS, PAYMENTS, READERS, READ_SECONDS } };

// Watchdog: um teste de carga nunca pode ficar pendurado; estourou o tempo, sai com o relatório parcial.
setTimeout(() => {
  console.error('[watchdog] tempo máximo excedido; relatório parcial:\n' + JSON.stringify(report, null, 2));
  process.exit(2);
}, Number(process.env.MAX_MINUTES ?? 6) * 60_000).unref();

// ---------------------------------------------------------------- infraestrutura
log('subindo Postgres (fsync ligado), dublês e API…');
const pgServer = await startPostgres({ maxConnections: 300 });
await createMigratedTemplate(pgServer.baseUrl, 'lle_load');
const dbUrl = `${pgServer.baseUrl}/lle_load`;
const db = new pg.Pool({ connectionString: dbUrl, max: 10 });

const mp = await FakeMercadoPago.start();
mp.latencyMs = 80; // latência típica de API externa

await db.query(`UPDATE live_settings SET status = 'ao_vivo', valid_until = '2026-12-18', whatsapp = '5548999990000', hold_minutes = 30`);
await db.query(`INSERT INTO goals (threshold, prize) VALUES (10, 'Tanque cheio'), (20, 'Emplacamento grátis'), (50, 'Capacete Yamaha')`);
const model = async (slug: string, units: number) => {
  const { rows } = await db.query(
    `INSERT INTO models (slug, name, category_label, price_live_cents, price_table_cents, released_at) VALUES ($1, $1, 'Teste · 2026', 2299000, 2449000, now()) RETURNING id`,
    [slug],
  );
  await db.query(`INSERT INTO units (model_id) SELECT $1 FROM generate_series(1, $2)`, [rows[0].id, units]);
  return rows[0].id as number;
};
const disputaId = await model('disputa', 10);
const pagamentosId = await model('pagamentos', PAYMENTS);
await db.query(`INSERT INTO consultants (name, store_id) VALUES ('Consultor A', 1), ('Consultor B', 1)`);

const port = await freePort();
const api: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
  cwd: apiDir,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'warn',
    PUBLIC_BASE_URL: 'https://live.exemplo.test',
    DATABASE_URL: dbUrl,
    DATABASE_POOL_MAX: '40',
    RUN_WORKER_IN_PROCESS: 'true',
    MP_ACCESS_TOKEN: 'TEST-access-token',
    MP_PUBLIC_KEY: 'TEST-public-key',
    MP_WEBHOOK_SECRET: SECRET,
    MP_API_BASE: mp.url,
    ADMIN_PASSWORD: 'SenhaDoTesteDeCarga2026',
    // Todo o tráfego sai de 127.0.0.1 neste teste; em produção o limite é por IP real do cliente.
    ORDER_RATE_LIMIT_PER_MINUTE: '1000000',
    API_RATE_LIMIT_PER_MINUTE: '1000000',
    MAX_SSE_CLIENTS: String(VIEWERS + 1000),
    HOLD_GRACE_SECONDS: '120',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const base = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${base}/api/ready`)).ok) break;
  } catch {
    /* ainda subindo */
  }
  if (i > 120) throw new Error('API não subiu');
  await sleep(250);
}
const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });

// ---------------------------------------------------------------- 1. espectadores
interface Viewer {
  firstAt: number | null;
  lastSold: number;
  soldSeenAt: Map<number, number>;
  req: http.ClientRequest;
}
// Espectadores chegam em ondas (RAMP_BATCH a cada RAMP_INTERVAL_MS), como numa live real.
// Abrir milhares de conexões no mesmo milissegundo esbarra no backlog de 128 do macOS (somaxconn),
// um limite da máquina de teste e não do servidor.
const RAMP_BATCH = Number(process.env.RAMP_BATCH ?? 1000);
const RAMP_INTERVAL_MS = Number(process.env.RAMP_INTERVAL_MS ?? 100);
log(`fase 1: abrindo ${VIEWERS} conexões SSE (ondas de ${RAMP_BATCH} a cada ${RAMP_INTERVAL_MS} ms)…`);
const viewers: Viewer[] = [];
const t1 = performance.now();
const firstLatencies: number[] = [];
let sseErrors = 0;
await new Promise<void>((resolveAll) => {
  let pending = VIEWERS;
  const open = (i: number) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (--pending === 0) resolveAll();
    };
    const started = performance.now();
    const v: Viewer = { firstAt: null, lastSold: -1, soldSeenAt: new Map(), req: null as unknown as http.ClientRequest };
    v.req = http.get(`${base}/api/live/stream`, { agent: false }, (res) => {
      if (res.statusCode !== 200) {
        sseErrors++;
        res.resume();
        return done();
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const msg = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = msg.split('\n').find((l) => l.startsWith('data: '));
          if (!data) continue;
          const sold = (JSON.parse(data.slice(6)) as { sales: { sold: number } }).sales.sold;
          if (v.firstAt === null) {
            v.firstAt = performance.now();
            firstLatencies.push(v.firstAt - started);
            done();
          }
          if (sold !== v.lastSold) {
            v.lastSold = sold;
            v.soldSeenAt.set(sold, performance.now());
          }
        }
      });
    });
    v.req.on('error', () => {
      if (!settled) sseErrors++;
      done();
    });
    // Sem resposta em 15s conta como falha (nunca deixa o teste pendurado).
    setTimeout(() => {
      if (v.firstAt === null && !settled) {
        sseErrors++;
        v.req.destroy();
        done();
      }
    }, 15_000).unref();
    viewers.push(v);
    void i;
  };
  for (let start = 0; start < VIEWERS; start += RAMP_BATCH) {
    setTimeout(() => {
      for (let i = start; i < Math.min(VIEWERS, start + RAMP_BATCH); i++) open(i);
    }, (start / RAMP_BATCH) * RAMP_INTERVAL_MS);
  }
});
report.phase1_sse = { connected: firstLatencies.length, errors: sseErrors, wallMs: Math.round(performance.now() - t1), firstSnapshotMs: stats(firstLatencies) };
log(`  ${firstLatencies.length}/${VIEWERS} conectados em ${Math.round(performance.now() - t1)} ms · 1º snapshot p95 ${pct(firstLatencies, 95)} ms`);

// ---------------------------------------------------------------- 2. propagação
async function propagation(label: string, action: () => Promise<void>, expectedSold: number) {
  const t = performance.now();
  await action();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (viewers.every((v) => v.firstAt === null || v.soldSeenAt.has(expectedSold))) break;
    await sleep(20);
  }
  const lat = viewers.filter((v) => v.soldSeenAt.has(expectedSold)).map((v) => v.soldSeenAt.get(expectedSold)! - t);
  const missing = viewers.filter((v) => v.firstAt !== null && !v.soldSeenAt.has(expectedSold)).length;
  log(`  ${label}: ${lat.length} receberam · p50 ${pct(lat, 50)} ms · p99 ${pct(lat, 99)} ms · máx ${pct(lat, 100)} ms · faltaram ${missing}`);
  return { delivered: lat.length, missing, latencyMs: stats(lat) };
}
log('fase 2: venda de balcão → propagação para todos os espectadores');
report.phase2_propagation = await propagation('venda de balcão', async () => {
  await db.query(`UPDATE live_settings SET offline_sales = offline_sales + 1`);
}, 1);

// ---------------------------------------------------------------- 3. leitura do snapshot
log(`fase 3: ${READERS} clientes lendo o snapshot por ${READ_SECONDS}s (sem CDN)…`);
{
  const lat: number[] = [];
  let errors = 0;
  const until = performance.now() + READ_SECONDS * 1000;
  await Promise.all(
    Array.from({ length: READERS }, async () => {
      while (performance.now() < until) {
        const s = performance.now();
        await new Promise<void>((resolve) => {
          http
            .get(`${base}/api/live/snapshot`, { agent }, (res) => {
              res.resume();
              res.on('end', () => {
                if (res.statusCode === 200) lat.push(performance.now() - s);
                else errors++;
                resolve();
              });
            })
            .on('error', () => {
              errors++;
              resolve();
            });
        });
      }
    }),
  );
  report.phase3_snapshot = { requests: lat.length, errors, rps: Math.round(lat.length / READ_SECONDS), latencyMs: stats(lat) };
  log(`  ${Math.round(lat.length / READ_SECONDS)} req/s · p50 ${pct(lat, 50)} ms · p99 ${pct(lat, 99)} ms · erros ${errors}`);
}

// ---------------------------------------------------------------- 4. rajada de compra
function orderBody(n: number, slug: string) {
  return JSON.stringify({
    modelSlug: slug,
    storeId: 1,
    customer: { name: `Comprador Carga ${n}`, cpf: cpf(n), whatsapp: `48 9${String(80000000 + n).slice(-8)}`, email: `c${n}@exemplo.test` },
    acceptTerms: true,
    clientToken: Buffer.from(`${n}-${Math.random()}-${Date.now()}-token-de-carga-com-tamanho-suficiente`).toString('base64url').slice(0, 64),
    payment: { method: 'pix' },
  });
}
// Compradores e webhooks usam um pool de conexões reaproveitadas, como um load balancer faz com o backend.
const buyerAgent = new http.Agent({ keepAlive: true, maxSockets: Number(process.env.CLIENT_SOCKETS ?? 512) });
function post(url: string, body: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; ms: number }> {
  const s = performance.now();
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'POST', agent: buyerAgent, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, ms: performance.now() - s }));
    });
    req.on('error', (e) => resolve({ status: 0, body: JSON.stringify({ error: { code: `NETWORK_${(e as NodeJS.ErrnoException).code ?? 'ERROR'}` } }), ms: performance.now() - s }));
    req.end(body);
  });
}

log(`fase 4: ${BUYERS} compradores simultâneos disputando 10 motos (com ${firstLatencies.length} espectadores conectados)…`);
{
  const t = performance.now();
  const results = await Promise.all(Array.from({ length: BUYERS }, (_, i) => post(`${base}/api/orders`, orderBody(100_000 + i, 'disputa'))));
  const tally: Record<string, number> = {};
  for (const r of results) {
    const key = r.status >= 200 && r.status < 300 ? 'OK' : ((JSON.parse(r.body || '{}') as { error?: { code: string } }).error?.code ?? `HTTP_${r.status}`);
    tally[key] = (tally[key] ?? 0) + 1;
  }
  // A verdade vem do banco, não das respostas HTTP.
  const inDb = (await db.query(`SELECT count(*)::int AS c FROM orders WHERE model_id = $1`, [disputaId])).rows[0].c as number;
  report.phase4_buy_burst = { wallMs: Math.round(performance.now() - t), tally, ordersInDb: inDb, latencyMs: stats(results.map((r) => r.ms)) };
  log(`  ${JSON.stringify(tally)} em ${Math.round(performance.now() - t)} ms · p50 ${pct(results.map((r) => r.ms), 50)} ms · p99 ${pct(results.map((r) => r.ms), 99)} ms · pedidos no banco: ${inDb}`);
  if (inDb !== 10 || tally.OK !== 10) throw new Error(`esperado exatamente 10 reservas; respostas OK=${tally.OK}, banco=${inDb}`);
}

// ---------------------------------------------------------------- 5. tempestade de pagamentos
log(`fase 5: ${PAYMENTS} compradores pagando o Pix ao mesmo tempo (webhook entregue 3x cada)…`);
{
  const created = await Promise.all(Array.from({ length: PAYMENTS }, (_, i) => post(`${base}/api/orders`, orderBody(200_000 + i, 'pagamentos'))));
  const orders = created.filter((r) => r.status < 300).map((r) => (JSON.parse(r.body) as { order: { code: string; payment: { id: string } } }).order);
  if (orders.length !== PAYMENTS) throw new Error(`criados ${orders.length} de ${PAYMENTS} pedidos`);
  const soldBefore = (await db.query(`SELECT count(*)::int AS c FROM orders WHERE status IN ('paid','completed')`)).rows[0].c as number;
  const offline = (await db.query(`SELECT offline_sales FROM live_settings`)).rows[0].offline_sales as number;
  for (const o of orders) mp.approve(Number(o.payment.id));
  const t = performance.now();
  const hooks = orders.flatMap((o) =>
    [0, 1, 2].map(() => {
      const h = mp.webhook(Number(o.payment.id), SECRET);
      return post(base + h.url, JSON.stringify(h.payload), h.headers as Record<string, string>);
    }),
  );
  const hookResults = await Promise.all(hooks);
  const wall = performance.now() - t;
  const non200 = hookResults.filter((r) => r.status !== 200).length;
  const expected = soldBefore + PAYMENTS + offline;
  const prop = await propagation('termômetro após a tempestade', async () => undefined, expected);
  report.phase5_payments = {
    webhooks: hookResults.length,
    non200,
    wallMs: Math.round(wall),
    webhookLatencyMs: stats(hookResults.map((r) => r.ms)),
    thermometerPropagation: prop,
  };
  log(`  ${hookResults.length} webhooks em ${Math.round(wall)} ms · p99 ${pct(hookResults.map((r) => r.ms), 99)} ms · não-200: ${non200}`);
}

// ---------------------------------------------------------------- 6. consistência
log('fase 6: verificando invariantes no banco…');
const checks: Record<string, string> = {
  'unidade em mais de um pedido': `SELECT order_id FROM units WHERE order_id IS NOT NULL GROUP BY order_id HAVING count(*) > 1`,
  'pedido pago sem unidade vendida': `SELECT o.id FROM orders o LEFT JOIN units u ON u.order_id = o.id AND u.status = 'sold' WHERE o.status IN ('paid','completed') AND u.id IS NULL`,
  'unidade vendida sem pedido pago': `SELECT u.id FROM units u LEFT JOIN orders o ON o.id = u.order_id WHERE u.status = 'sold' AND (o.id IS NULL OR o.status NOT IN ('paid','completed'))`,
  'pendente sem unidade segurada': `SELECT o.id FROM orders o LEFT JOIN units u ON u.order_id = o.id AND u.status = 'held' WHERE o.status = 'pending_payment' AND u.id IS NULL`,
  'pagamento aprovado quitando dois pedidos': `SELECT paid_payment_id FROM orders WHERE paid_payment_id IS NOT NULL GROUP BY paid_payment_id HAVING count(*) > 1`,
  'código de voucher repetido': `SELECT code FROM orders GROUP BY code HAVING count(*) > 1`,
};
const violations: Record<string, number> = {};
for (const [label, sql] of Object.entries(checks)) violations[label] = (await db.query(sql)).rowCount ?? 0;
const totals = (
  await db.query(
    `SELECT (SELECT count(*) FROM orders WHERE status IN ('paid','completed'))::int AS paid,
            (SELECT count(*) FROM units WHERE status = 'sold')::int AS sold_units,
            (SELECT count(*) FROM orders WHERE status = 'pending_payment' AND model_id = $1)::int AS disputa_pending,
            (SELECT count(*) FROM units WHERE status = 'held' AND model_id = $1)::int AS disputa_held,
            (SELECT count(*) FROM units WHERE status = 'sold' AND model_id = $2)::int AS pagamentos_sold`,
    [disputaId, pagamentosId],
  )
).rows[0];
report.phase6_consistency = { violations, totals };
const ok = Object.values(violations).every((v) => v === 0) && totals.paid === totals.sold_units;
log(`  violações: ${JSON.stringify(violations)}`);
log(`  totais: ${JSON.stringify(totals)}`);

// ---------------------------------------------------------------- encerramento
report.finishedAt = new Date().toISOString();
report.passed = ok;
const outDir = path.resolve(apiDir, '../../tests/load/results');
await mkdir(outDir, { recursive: true });
const file = path.join(outDir, `live-load-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(file, JSON.stringify(report, null, 2));
log(`relatório salvo em ${file}`);

for (const v of viewers) v.req.destroy();
agent.destroy();
buyerAgent.destroy();
api.kill('SIGTERM');
await new Promise((r) => api.once('exit', r));
await db.end();
await mp.close();
await pgServer.stop();
log(ok ? 'RESULTADO: APROVADO — nenhuma inconsistência' : 'RESULTADO: REPROVADO');
process.exit(ok ? 0 : 1);
