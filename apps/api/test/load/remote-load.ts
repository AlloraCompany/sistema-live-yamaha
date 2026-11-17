/**
 * Teste de carga contra o site PUBLICADO (Fly). Diferente do live-load.ts, não sobe nada: usa o site,
 * o banco e o Mercado Pago de verdade. Rodar só no ensaio, nunca com a live no ar.
 *
 * CUIDADO: cada reserva que dá certo cria um Pix real no Mercado Pago. Por isso a rajada de compra usa uma
 * moto de teste com poucas unidades (UNITS) e o voucher deve estar com valor baixo. Os Pix não são pagos:
 * o script vence as reservas no fim e o sistema cancela as cobranças.
 *
 * Antes de rodar:
 *  1. publicar com o limite por IP afrouxado (todo o tráfego sai de um endereço só):
 *       fly deploy --ha=false -e ORDER_RATE_LIMIT_PER_MINUTE=1000000 -e API_RATE_LIMIT_PER_MINUTE=1000000
 *  2. abrir o túnel do banco: fly mpg proxy <cluster> --local-port 16380
 * Depois: publicar de novo sem as opções (-e) para o limite voltar ao normal.
 *
 *   TARGET_URL=https://live.exemplo.com DATABASE_URL=postgres://...@127.0.0.1:16380/db \
 *   VIEWERS=5000 BUYERS=1000 UNITS=5 npx tsx test/load/remote-load.ts
 *
 * Fases:
 *  1. Espectadores: N conexões SSE (HTTPS) recebendo o estado inicial.
 *  2. Propagação: ajuste manual do termômetro (+1 e depois -1) → tempo até TODOS verem a mudança.
 *  3. Leitura: clientes sem SSE lendo o snapshot.
 *  4. Rajada de compra: M compradores ao mesmo tempo disputando UNITS motos de teste.
 *  5. Consistência no banco e limpeza (moto de teste escondida, reservas vencidas, termômetro como estava).
 */
import { execFile } from 'node:child_process';
import https from 'node:https';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { cpf } from '../support/cpf.js';

const TARGET = (process.env.TARGET_URL ?? '').replace(/\/$/, '');
const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (!/^https:\/\//.test(TARGET) || !DATABASE_URL) {
  console.error('Defina TARGET_URL (https://…) e DATABASE_URL (túnel do banco publicado).');
  process.exit(2);
}
const VIEWERS = Number(process.env.VIEWERS ?? 5000);
const BUYERS = Number(process.env.BUYERS ?? 1000);
const UNITS = Number(process.env.UNITS ?? 5);
const READERS = Number(process.env.READERS ?? 100);
const READ_SECONDS = Number(process.env.READ_SECONDS ?? 10);
const RAMP_BATCH = Number(process.env.RAMP_BATCH ?? 250);
const RAMP_INTERVAL_MS = Number(process.env.RAMP_INTERVAL_MS ?? 250);
const FLY = process.env.FLY_BIN ?? '';
const FLY_APP = process.env.FLY_APP ?? '';
const TEST_SLUG = 'teste-de-carga';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function pct(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!);
}
const stats = (v: number[]) => ({ n: v.length, p50: pct(v, 50), p95: pct(v, 95), p99: pct(v, 99), max: pct(v, 100) });
const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

const report: Record<string, unknown> = { startedAt: new Date().toISOString(), target: TARGET, config: { VIEWERS, BUYERS, UNITS, READERS, READ_SECONDS } };
const db = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

/** Uso da máquina no Fly entre duas amostras: CPU ocupada e "steal" (tempo que o hospedeiro tirou da máquina). */
interface Sample { at: number; cpu: number[]; load: string; memAvailableMb: number | null }
function machineSample(machineId?: string): Promise<Sample | null> {
  if (!FLY || !FLY_APP) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      FLY,
      ['ssh', 'console', '-a', FLY_APP, ...(machineId ? ['--machine', machineId] : []), '-C', 'sh -c "head -1 /proc/stat; cat /proc/loadavg; grep -e MemAvailable /proc/meminfo"'],
      { timeout: 30_000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const lines = stdout.split('\n').map((l) => l.trim());
        const cpuLine = lines.find((l) => l.startsWith('cpu '));
        const loadLine = lines.find((l) => /^\d+\.\d+ \d+\.\d+ \d+\.\d+/.test(l));
        const mem = lines.find((l) => l.startsWith('MemAvailable'));
        if (!cpuLine) return resolve(null);
        resolve({
          at: Date.now(),
          cpu: cpuLine.split(/\s+/).slice(1).map(Number),
          load: loadLine?.split(' ').slice(0, 3).join(' ') ?? '?',
          memAvailableMb: mem ? Math.round(Number(mem.replace(/\D/g, '')) / 1024) : null,
        });
      },
    );
  });
}
function machineUsage(a: Sample | null, b: Sample | null) {
  if (!a || !b) return null;
  const d = b.cpu.map((v, i) => v - (a.cpu[i] ?? 0));
  const total = d.slice(0, 8).reduce((s, v) => s + v, 0) || 1;
  const [user = 0, nice = 0, system = 0, , , irq = 0, softirq = 0, steal = 0] = d;
  return {
    seconds: Math.round((b.at - a.at) / 1000),
    busyPct: Math.round(((user + nice + system + irq + softirq) / total) * 100),
    stealPct: Math.round((steal / total) * 100),
    load1_5_15: b.load,
    memAvailableMb: b.memAvailableMb,
  };
}

// Watchdog: nunca fica pendurado.
setTimeout(() => {
  console.error('[watchdog] tempo máximo excedido; relatório parcial:\n' + JSON.stringify(report, null, 2));
  process.exit(2);
}, Number(process.env.MAX_MINUTES ?? 8) * 60_000).unref();

const base0 = await machineSample();
const settings0 = (await db.query(`SELECT status, voucher_amount_cents, offline_sales FROM live_settings WHERE id = 1`)).rows[0];
if (settings0.voucher_amount_cents > 1000 && process.env.ALLOW_HIGH_VOUCHER !== 'true') {
  console.error(`Voucher em ${settings0.voucher_amount_cents / 100} reais: baixe o valor antes do teste (cada reserva cria um Pix real).`);
  process.exit(2);
}
log(`alvo ${TARGET} · live "${settings0.status}" · voucher R$ ${settings0.voucher_amount_cents / 100} · ajuste manual ${settings0.offline_sales}`);

// ---------------------------------------------------------------- 1. espectadores
interface Viewer { firstAt: number | null; sold: number; soldAt: number; req: ReturnType<typeof https.get> }
const viewers: Viewer[] = [];
const firstLatencies: number[] = [];
let sseErrors = 0;
let dropped = 0;
const errorKinds: Record<string, number> = {};
log(`fase 1: abrindo ${VIEWERS} conexões SSE (ondas de ${RAMP_BATCH} a cada ${RAMP_INTERVAL_MS} ms)…`);
const t1 = performance.now();
await new Promise<void>((resolveAll) => {
  let pending = VIEWERS;
  const open = () => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (--pending === 0) resolveAll();
    };
    const started = performance.now();
    const v: Viewer = { firstAt: null, sold: -1, soldAt: 0, req: null as unknown as ReturnType<typeof https.get> };
    v.req = https.get(`${TARGET}/api/live/stream`, { agent: false }, (res) => {
      if (res.statusCode !== 200) {
        sseErrors++;
        errorKinds[`HTTP_${res.statusCode}`] = (errorKinds[`HTTP_${res.statusCode}`] ?? 0) + 1;
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
          if (sold !== v.sold) {
            v.sold = sold;
            v.soldAt = performance.now();
          }
        }
      });
      res.on('close', () => {
        if (v.firstAt !== null) dropped++;
      });
    });
    v.req.on('error', (e) => {
      if (!settled) {
        sseErrors++;
        const kind = (e as NodeJS.ErrnoException).code ?? 'ERRO';
        errorKinds[kind] = (errorKinds[kind] ?? 0) + 1;
      }
      done();
    });
    setTimeout(() => {
      if (v.firstAt === null && !settled) {
        sseErrors++;
        errorKinds.SEM_RESPOSTA_30S = (errorKinds.SEM_RESPOSTA_30S ?? 0) + 1;
        settled = true; // o destroy abaixo dispara "error": não conta duas vezes
        v.req.destroy();
        if (--pending === 0) resolveAll();
      }
    }, 30_000).unref();
    viewers.push(v);
  };
  for (let start = 0; start < VIEWERS; start += RAMP_BATCH) {
    setTimeout(() => {
      for (let i = start; i < Math.min(VIEWERS, start + RAMP_BATCH); i++) open();
    }, (start / RAMP_BATCH) * RAMP_INTERVAL_MS);
  }
});
const afterConnect = await machineSample();
// O que o SERVIDOR diz que tem conectado (separa limite do servidor de limite de quem está testando).
const serverSide = await fetch(`${TARGET}/api/ready`).then((r) => r.json() as Promise<{ viewersConnected?: number }>).catch(() => ({ viewersConnected: undefined }));
report.phase1_sse = {
  connected: firstLatencies.length,
  serverSaysConnected: serverSide.viewersConnected ?? null,
  errors: sseErrors,
  errorKinds,
  wallMs: Math.round(performance.now() - t1),
  firstSnapshotMs: stats(firstLatencies),
  machine: machineUsage(base0, afterConnect),
};
log(`  ${firstLatencies.length}/${VIEWERS} conectados em ${Math.round(performance.now() - t1)} ms · 1º estado p50 ${pct(firstLatencies, 50)} ms · p99 ${pct(firstLatencies, 99)} ms · erros ${sseErrors} ${JSON.stringify(errorKinds)} · servidor vê ${serverSide.viewersConnected ?? '?'}`);

// ---------------------------------------------------------------- 2. propagação
async function propagation(label: string, action: () => Promise<void>, expectedSold: number) {
  const t = performance.now();
  await action();
  const seen = (v: Viewer) => v.sold === expectedSold && v.soldAt >= t;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (viewers.every((v) => v.firstAt === null || seen(v))) break;
    await sleep(20);
  }
  const lat = viewers.filter(seen).map((v) => v.soldAt - t);
  const missing = viewers.filter((v) => v.firstAt !== null && !seen(v)).length;
  log(`  ${label}: ${lat.length} receberam · p50 ${pct(lat, 50)} ms · p99 ${pct(lat, 99)} ms · máx ${pct(lat, 100)} ms · faltaram ${missing}`);
  return { delivered: lat.length, missing, latencyMs: stats(lat) };
}
const sold0 = viewers.find((v) => v.firstAt !== null)?.sold ?? 0;
log('fase 2: ajuste manual do termômetro → propagação para todos os espectadores');
report.phase2_propagation_up = await propagation('termômetro +1', async () => {
  await db.query(`UPDATE live_settings SET offline_sales = offline_sales + 1 WHERE id = 1`);
}, sold0 + 1);
await sleep(1500);
report.phase2_propagation_down = await propagation('termômetro -1', async () => {
  await db.query(`UPDATE live_settings SET offline_sales = $1 WHERE id = 1`, [settings0.offline_sales]);
}, sold0);

// ---------------------------------------------------------------- 3. leitura do snapshot
log(`fase 3: ${READERS} clientes lendo o snapshot por ${READ_SECONDS}s…`);
{
  const agent = new https.Agent({ keepAlive: true, maxSockets: READERS });
  const lat: number[] = [];
  let errors = 0;
  const until = performance.now() + READ_SECONDS * 1000;
  await Promise.all(
    Array.from({ length: READERS }, async () => {
      while (performance.now() < until) {
        const s = performance.now();
        await new Promise<void>((resolve) => {
          https
            .get(`${TARGET}/api/live/snapshot`, { agent }, (res) => {
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
  agent.destroy();
  report.phase3_snapshot = { requests: lat.length, errors, rps: Math.round(lat.length / READ_SECONDS), latencyMs: stats(lat) };
  log(`  ${Math.round(lat.length / READ_SECONDS)} req/s · p50 ${pct(lat, 50)} ms · p99 ${pct(lat, 99)} ms · erros ${errors}`);
}

// ---------------------------------------------------------------- 3b. uso sustentado
// HOLD_SECONDS > 0: mantém os espectadores ligados e muda o termômetro a cada CHANGE_EVERY_MS, medindo a CPU
// de cada máquina (FLY_MACHINES) na janela. Máquina compartilhada do Fly tem cota de 6,25% por vCPU e é
// freada quando gasta o saldo de rajada; teste curto não mostra isso, uso sustentado mostra.
const HOLD_SECONDS = Number(process.env.HOLD_SECONDS ?? 0);
if (HOLD_SECONDS > 0) {
  const every = Number(process.env.CHANGE_EVERY_MS ?? 5000);
  const machines = (process.env.FLY_MACHINES ?? '').split(',').filter(Boolean);
  log(`fase 3b: ${HOLD_SECONDS}s com ${viewers.filter((v) => v.firstAt !== null).length - dropped} espectadores ligados e uma mudança a cada ${every} ms…`);
  const before = await Promise.all(machines.map((m) => machineSample(m)));
  const until = Date.now() + HOLD_SECONDS * 1000;
  let changes = 0;
  while (Date.now() < until) {
    const up = changes % 2 === 0;
    await db.query(`UPDATE live_settings SET offline_sales = $1 WHERE id = 1`, [settings0.offline_sales + (up ? 1 : 0)]);
    changes++;
    await sleep(every);
  }
  await db.query(`UPDATE live_settings SET offline_sales = $1 WHERE id = 1`, [settings0.offline_sales]);
  const after = await Promise.all(machines.map((m) => machineSample(m)));
  const usage = machines.map((m, i) => ({ machine: m, ...machineUsage(before[i] ?? null, after[i] ?? null) }));
  report.phase3b_sustained = { seconds: HOLD_SECONDS, changes, viewers: viewers.filter((v) => v.firstAt !== null).length - dropped, usage };
  for (const u of usage) log(`  máquina ${u.machine}: CPU ocupada ${u.busyPct ?? '?'}% · steal ${u.stealPct ?? '?'}% · carga ${u.load1_5_15 ?? '?'} · memória livre ${u.memAvailableMb ?? '?'} MB`);
}

// BUYERS=0: roda só a parte dos espectadores (não cria moto de teste nem toca no Mercado Pago).
if (BUYERS === 0) {
  for (const v of viewers) v.req.destroy();
  report.finishedAt = new Date().toISOString();
  if (process.env.REPORT_FILE) await writeFile(process.env.REPORT_FILE, JSON.stringify(report, null, 2));
  console.log('\nRELATORIO ' + JSON.stringify(report, null, 2));
  await db.end();
  process.exit(0);
}

// ---------------------------------------------------------------- 4. rajada de compra
const storeId = (await db.query<{ id: number }>(`SELECT id FROM stores WHERE active ORDER BY id LIMIT 1`)).rows[0]!.id;
const modelId = (
  await db.query<{ id: number }>(
    `INSERT INTO models (slug, name, category_label, price_live_cents, price_table_cents, released_at, offer_active, sort)
     VALUES ($1, 'TESTE DE CARGA (não comprar)', 'Teste interno', 100000, 110000, now(), true, 999)
     ON CONFLICT (slug) DO UPDATE SET released_at = now(), offer_active = true RETURNING id`,
    [TEST_SLUG],
  )
).rows[0]!.id;
const free = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM units WHERE model_id = $1 AND status = 'available'`, [modelId])).rows[0]!.c;
if (free < UNITS) await db.query(`INSERT INTO units (model_id) SELECT $1 FROM generate_series(1, $2)`, [modelId, UNITS - free]);
await sleep(1500); // a liberação chega à loja antes da rajada

const seed = Math.floor(Date.now() / 1000) % 1_000_000;
function orderBody(n: number) {
  return JSON.stringify({
    modelSlug: TEST_SLUG,
    storeId,
    customer: { name: `Teste Carga ${n}`, cpf: cpf(seed * 1000 + n), whatsapp: `48 9${String(80000000 + n).slice(-8)}`, email: `carga${seed}x${n}@example.com` },
    acceptTerms: true,
    clientToken: Buffer.from(`${n}-${Math.random()}-${Date.now()}-token-de-carga-com-tamanho-suficiente`).toString('base64url').slice(0, 64),
    payment: { method: 'pix' },
  });
}
const buyerAgent = new https.Agent({ keepAlive: true, maxSockets: Number(process.env.CLIENT_SOCKETS ?? 256) });
function post(url: string, body: string): Promise<{ status: number; body: string; ms: number }> {
  const s = performance.now();
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'POST', agent: buyerAgent, headers: { 'content-type': 'application/json' } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, ms: performance.now() - s }));
    });
    req.on('error', (e) => resolve({ status: 0, body: JSON.stringify({ error: { code: `REDE_${(e as NodeJS.ErrnoException).code ?? 'ERRO'}` } }), ms: performance.now() - s }));
    req.end(body);
  });
}
log(`fase 4: ${BUYERS} compradores simultâneos disputando ${UNITS} motos de teste (com ${viewers.filter((v) => v.firstAt !== null).length - dropped} espectadores conectados)…`);
const beforeBurst = await machineSample();
{
  const t = performance.now();
  const results = await Promise.all(Array.from({ length: BUYERS }, (_, i) => post(`${TARGET}/api/orders`, orderBody(i))));
  const wall = performance.now() - t;
  const tally: Record<string, number> = {};
  let pixCreated = 0;
  let pixErrors = 0;
  for (const r of results) {
    let parsed: { error?: { code: string }; paymentError?: { code: string } | null; order?: { payment?: { pix?: unknown } | null } } = {};
    try {
      parsed = JSON.parse(r.body || '{}');
    } catch {
      /* resposta não-JSON (erro do proxy) */
    }
    const ok = r.status >= 200 && r.status < 300;
    const key = ok ? 'OK' : (parsed.error?.code ?? `HTTP_${r.status}`);
    tally[key] = (tally[key] ?? 0) + 1;
    if (ok && parsed.order?.payment?.pix) pixCreated++;
    if (ok && parsed.paymentError) pixErrors++;
  }
  const afterBurst = await machineSample();
  const inDb = (await db.query<{ c: number; u: number }>(
    `SELECT count(o.id)::int AS c, count(DISTINCT u.id)::int AS u FROM orders o LEFT JOIN units u ON u.order_id = o.id
      WHERE o.model_id = $1 AND o.status = 'pending_payment'`,
    [modelId],
  )).rows[0]!;
  const okLat = results.filter((r) => r.status >= 200 && r.status < 300).map((r) => r.ms);
  const rejLat = results.filter((r) => r.status === 409).map((r) => r.ms);
  report.phase4_buy_burst = {
    wallMs: Math.round(wall),
    tally,
    reservationsInDb: inDb.c,
    distinctUnits: inDb.u,
    pixCreatedAtMercadoPago: pixCreated,
    pixErrors,
    latencyMs: { all: stats(results.map((r) => r.ms)), reserved: stats(okLat), rejected: stats(rejLat) },
    machine: machineUsage(beforeBurst, afterBurst),
  };
  log(`  ${JSON.stringify(tally)} em ${Math.round(wall)} ms · p50 ${pct(results.map((r) => r.ms), 50)} ms · p99 ${pct(results.map((r) => r.ms), 99)} ms · reservas no banco: ${inDb.c} (unidades distintas: ${inDb.u}) · Pix criados: ${pixCreated}`);
}
const stillConnected = viewers.filter((v) => v.firstAt !== null).length - dropped;
report.viewersStillConnected = stillConnected;
log(`  espectadores ainda conectados depois da rajada: ${stillConnected}`);

// ---------------------------------------------------------------- 5. consistência e limpeza
log('fase 5: consistência no banco e limpeza…');
const checks: Record<string, string> = {
  'unidade em mais de um pedido': `SELECT order_id FROM units WHERE order_id IS NOT NULL GROUP BY order_id HAVING count(*) > 1`,
  'pedido pago sem unidade vendida': `SELECT o.id FROM orders o LEFT JOIN units u ON u.order_id = o.id AND u.status = 'sold' WHERE o.status IN ('paid','completed') AND u.id IS NULL`,
  'unidade vendida sem pedido pago': `SELECT u.id FROM units u LEFT JOIN orders o ON o.id = u.order_id WHERE u.status = 'sold' AND (o.id IS NULL OR o.status NOT IN ('paid','completed'))`,
  'pendente sem unidade segurada': `SELECT o.id FROM orders o LEFT JOIN units u ON u.order_id = o.id AND u.status = 'held' WHERE o.status = 'pending_payment' AND u.id IS NULL`,
  'código de voucher repetido': `SELECT code FROM orders GROUP BY code HAVING count(*) > 1`,
};
const violations: Record<string, number> = {};
for (const [label, sql] of Object.entries(checks)) violations[label] = (await db.query(sql)).rowCount ?? 0;
log(`  violações: ${JSON.stringify(violations)}`);

// Limpeza: esconde a moto de teste, vence as reservas (o sistema devolve as unidades e cancela os Pix) e
// confere que o termômetro voltou ao que era.
await db.query(`UPDATE models SET offer_active = false, released_at = NULL WHERE id = $1`, [modelId]);
const expired = await db.query(`UPDATE orders SET hold_expires_at = now() - interval '10 minutes' WHERE model_id = $1 AND status = 'pending_payment'`, [modelId]);
const settingsEnd = (await db.query(`SELECT offline_sales FROM live_settings WHERE id = 1`)).rows[0];
report.phase5 = { violations, testReservationsExpired: expired.rowCount, offlineSalesRestored: settingsEnd.offline_sales === settings0.offline_sales };
for (const v of viewers) v.req.destroy();
buyerAgent.destroy();

report.finishedAt = new Date().toISOString();
report.passed = Object.values(violations).every((v) => v === 0);
if (process.env.REPORT_FILE) await writeFile(process.env.REPORT_FILE, JSON.stringify(report, null, 2));
console.log('\nRELATORIO ' + JSON.stringify(report, null, 2));
await db.end();
process.exit(report.passed ? 0 : 1);
