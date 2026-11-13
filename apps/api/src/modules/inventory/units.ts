import type { Queryable, Tx } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';

/**
 * Operações atômicas sobre unidades físicas (uma linha por moto).
 *
 * Reserva: `FOR UPDATE SKIP LOCKED` faz compradores simultâneos pegarem unidades diferentes
 * sem fila de espera por lock; quando não sobra unidade livre, a consulta volta vazia na hora.
 * O índice único units_order_uq e o CHECK units_order_consistency garantem no banco que
 * uma unidade pertence a no máximo um pedido.
 */

export async function lockAvailableUnit(tx: Tx, modelId: number): Promise<number | null> {
  const { rows } = await tx.query<{ id: number }>(
    `SELECT id FROM units
      WHERE model_id = $1 AND status = 'available'
      ORDER BY id
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
    [modelId],
  );
  return rows[0]?.id ?? null;
}

export async function holdUnit(tx: Tx, unitId: number, orderId: string): Promise<void> {
  const res = await tx.query(
    `UPDATE units SET status = 'held', order_id = $2, updated_at = now()
      WHERE id = $1 AND status = 'available'`,
    [unitId, orderId],
  );
  if (res.rowCount !== 1) throw new AppError('UNIT_RACE', 'Unidade deixou de estar disponível.', 409);
}

/** Baixa definitiva: só acontece com pagamento confirmado. */
export async function sellHeldUnit(tx: Tx, orderId: string): Promise<number | null> {
  const { rows } = await tx.query<{ id: number }>(
    `UPDATE units SET status = 'sold', updated_at = now()
      WHERE order_id = $1 AND status = 'held'
      RETURNING id`,
    [orderId],
  );
  return rows[0]?.id ?? null;
}

/** Devolve ao estoque a unidade de um pedido (segurada ou vendida). Idempotente. */
export async function releaseOrderUnit(tx: Queryable, orderId: string): Promise<number | null> {
  const { rows } = await tx.query<{ id: number }>(
    `UPDATE units SET status = 'available', order_id = NULL, updated_at = now()
      WHERE order_id = $1 AND status IN ('held', 'sold')
      RETURNING id`,
    [orderId],
  );
  return rows[0]?.id ?? null;
}

export async function releaseUnitsOfOrders(tx: Queryable, orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  const res = await tx.query(
    `UPDATE units SET status = 'available', order_id = NULL, updated_at = now()
      WHERE order_id = ANY($1::uuid[]) AND status = 'held'`,
    [orderIds],
  );
  return res.rowCount ?? 0;
}

export async function addUnits(
  tx: Queryable,
  modelId: number,
  units: { color?: string | null; chassis?: string | null }[],
): Promise<number[]> {
  const ids: number[] = [];
  for (const u of units) {
    const { rows } = await tx.query<{ id: number }>(
      `INSERT INTO units (model_id, color, chassis) VALUES ($1, $2, $3) RETURNING id`,
      [modelId, u.color ?? null, u.chassis ?? null],
    );
    ids.push(rows[0]!.id);
  }
  return ids;
}

/** Retira do estoque uma unidade livre (nunca uma segurada ou vendida). */
export async function removeOneAvailableUnit(tx: Tx, modelId: number, unitId?: number): Promise<number | null> {
  const { rows } = await tx.query<{ id: number }>(
    `UPDATE units SET status = 'removed', updated_at = now()
      WHERE id = (
        SELECT id FROM units
         WHERE model_id = $1 AND status = 'available' AND ($2::int IS NULL OR id = $2)
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
      RETURNING id`,
    [modelId, unitId ?? null],
  );
  return rows[0]?.id ?? null;
}

export interface StockCounts {
  available: number;
  held: number;
  sold: number;
}

export async function stockByModel(db: Queryable): Promise<Map<number, StockCounts>> {
  const { rows } = await db.query<{ model_id: number; available: number; held: number; sold: number }>(
    `SELECT model_id,
            count(*) FILTER (WHERE status = 'available')::int AS available,
            count(*) FILTER (WHERE status = 'held')::int AS held,
            count(*) FILTER (WHERE status = 'sold')::int AS sold
       FROM units GROUP BY model_id`,
  );
  return new Map(rows.map((r) => [r.model_id, { available: r.available, held: r.held, sold: r.sold }]));
}
