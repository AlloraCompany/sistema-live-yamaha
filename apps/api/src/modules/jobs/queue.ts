import type { Queryable } from '../../db/pool.js';

export type JobType =
  | 'payment.cancel'
  | 'payment.refund';

export interface EnqueueOptions {
  /** Enquanto houver job ativo (queued/running) com a mesma chave, novos pedidos são ignorados. */
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

/**
 * Enfileira dentro da transação de quem chama: o job só existe se a mudança de estado
 * que o originou for confirmada (padrão "transactional outbox").
 */
export async function enqueue(
  db: Queryable,
  type: JobType,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
): Promise<boolean> {
  const res = await db.query(
    `INSERT INTO jobs (type, payload, dedupe_key, run_at, max_attempts)
     VALUES ($1, $2, $3, COALESCE($4, now()), COALESCE($5, 15))
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running') DO NOTHING`,
    [type, JSON.stringify(payload), opts.dedupeKey ?? null, opts.runAt ?? null, opts.maxAttempts ?? null],
  );
  return (res.rowCount ?? 0) > 0;
}
