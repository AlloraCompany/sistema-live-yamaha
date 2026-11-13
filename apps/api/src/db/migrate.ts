import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './pool.js';
import type { Logger } from '../logger.js';

// Fonte (src/db → ../../migrations) ou build empacotado (dist → ./migrations).
const DEFAULT_DIR =
  [new URL('../../migrations', import.meta.url), new URL('./migrations', import.meta.url)]
    .map((u) => fileURLToPath(u))
    .find((p) => existsSync(p)) ?? fileURLToPath(new URL('./migrations', import.meta.url));

/**
 * Aplica migrations SQL em ordem, cada uma em transação, uma única vez.
 * Um advisory lock impede que duas instâncias subindo juntas migrem ao mesmo tempo.
 */
export async function migrate(db: Db, log: Logger, dir = process.env.MIGRATIONS_DIR ?? DEFAULT_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const client = await db.pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(727272)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migration ${file}: ${(err as Error).message}`);
      }
      applied.push(file);
      log.info({ migration: file }, 'migration aplicada');
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727272)').catch(() => undefined);
    client.release();
  }
  return applied;
}
