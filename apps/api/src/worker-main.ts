import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createContext } from './context.js';
import { migrate } from './db/migrate.js';
import { JobWorker } from './modules/jobs/worker.js';

/**
 * Processo de background: expiração de reservas, reconciliação com o Mercado Pago,
 * cancelamentos e estornos. Pode haver mais de um (claim com SKIP LOCKED).
 */
const config = loadConfig();
const log = createLogger(config.LOG_LEVEL, !config.isProduction && process.stdout.isTTY).child({ proc: 'worker' });
const ctx = createContext({ ...config, DATABASE_POOL_MAX: Math.min(config.DATABASE_POOL_MAX, 10) }, log, 'lle-worker');

await migrate(ctx.db, log);
const worker = new JobWorker({ db: ctx.db, log, orders: ctx.orders, gateway: ctx.gateway });
worker.start();

async function shutdown(signal: string) {
  log.info({ signal }, 'worker encerrando');
  await worker.stop();
  await ctx.db.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
