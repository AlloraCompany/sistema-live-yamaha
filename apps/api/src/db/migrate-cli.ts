import { createDb } from './pool.js';
import { migrate } from './migrate.js';
import { createLogger } from '../logger.js';

const log = createLogger('info');
const url = process.env.DATABASE_URL;
if (!url) {
  log.fatal('DATABASE_URL não definida');
  process.exit(1);
}
const db = createDb({ connectionString: url, max: 2, ssl: process.env.DATABASE_SSL === 'true', log });
try {
  const applied = await migrate(db, log);
  log.info({ applied }, applied.length ? 'migrations concluídas' : 'banco já atualizado');
} finally {
  await db.close();
}
