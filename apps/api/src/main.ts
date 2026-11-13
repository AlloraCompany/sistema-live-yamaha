import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createContext } from './context.js';
import { migrate } from './db/migrate.js';
import { LiveHub, PgListener } from './modules/live/hub.js';
import { JobWorker } from './modules/jobs/worker.js';
import { buildServer } from './server.js';

/** Processo da API HTTP (loja, painel, webhooks e tempo real). Escala horizontalmente. */
const config = loadConfig();
const log = createLogger(config.LOG_LEVEL, !config.isProduction && process.stdout.isTTY);
const ctx = createContext(config, log);

await migrate(ctx.db, log);
if (!config.ADMIN_PASSWORD) log.warn('ADMIN_PASSWORD ausente: o painel fica desativado neste ambiente');
if (config.isProduction && !ctx.gateway) log.error('PRODUÇÃO SEM MERCADO PAGO (modo ensaio): a loja não aceita compras');
else if (await ctx.auth.revokeSessionsIfPasswordChanged()) log.info('senha do painel definida ou trocada: sessões anteriores encerradas');

const hub = new LiveHub(ctx.db, log, {
  minIntervalMs: 250,
  maxClients: config.MAX_SSE_CLIENTS,
  safetyRefreshMs: 15_000,
});
const listener = new PgListener(
  config.DATABASE_URL,
  ['live_changed', 'orders_changed'],
  (ch) => hub.onNotify(ch),
  () => hub.requestRefresh(),
  log,
  config.DATABASE_SSL,
);
await hub.start();
await listener.start();

const worker = config.RUN_WORKER_IN_PROCESS
  ? new JobWorker({ db: ctx.db, log, orders: ctx.orders, gateway: ctx.gateway })
  : null;
worker?.start();

const app = await buildServer(ctx, hub);
// Fila de conexões pendentes generosa para picos (o kernel limita a net.core.somaxconn).
await app.listen({ host: config.HOST, port: config.PORT, backlog: 4096 });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'encerrando com segurança');
  hub.stop(); // fecha streams SSE para o app.close() não esperar conexões eternas
  await app.close();
  await worker?.stop();
  await listener.stop();
  await ctx.db.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
