import pg from 'pg';
import type { Logger } from '../logger.js';

// bigint (int8) e numeric viram string por padrão no node-postgres; contagens cabem em number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : v));
// Datas puras (date) ficam como "YYYY-MM-DD" para não sofrerem conversão de fuso.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Queryable = Pick<pg.PoolClient, 'query'>;
export type Tx = pg.PoolClient;

export interface Db {
  pool: pg.Pool;
  query: <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<pg.QueryResult<R>>;
  /** Executa `fn` numa transação; repete automaticamente em deadlock/serialization failure. */
  tx: <T>(fn: (client: Tx) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

export function createDb(opts: { connectionString: string; max: number; ssl?: boolean; log: Logger; appName?: string }): Db {
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max,
    ssl: opts.ssl ? { rejectUnauthorized: true } : undefined,
    application_name: opts.appName ?? 'lle-api',
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Nenhuma query de venda deveria passar disso; evita conexões presas segurando locks.
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  pool.on('error', (err) => opts.log.error({ err }, 'erro em conexão ociosa do pool'));

  async function tx<T>(fn: (client: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        const code = (err as { code?: string }).code;
        if (code && RETRYABLE_SQLSTATES.has(code) && attempt < 5) {
          opts.log.warn({ code, attempt }, 'transação repetida após conflito');
          await new Promise((r) => setTimeout(r, 10 * attempt + Math.random() * 20));
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }
  }

  return {
    pool,
    query: (text, params) => pool.query(text, params as unknown[]),
    tx,
    close: () => pool.end(),
  };
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}
