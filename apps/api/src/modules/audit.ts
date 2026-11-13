import type { Queryable } from '../db/pool.js';

export type Actor =
  | { type: 'admin'; id?: string }
  | { type: 'customer'; id?: string }
  | { type: 'system'; id?: string }
  | { type: 'webhook'; id?: string };

/** Trilha de auditoria gravada na mesma transação da mudança. */
export async function audit(
  db: Queryable,
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | number,
  data?: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_type, actor_id, action, entity, entity_id, data) VALUES ($1, $2, $3, $4, $5, $6)`,
    [actor.type, 'id' in actor && actor.id !== undefined ? String(actor.id) : null, action, entity, String(entityId), data ? JSON.stringify(data) : null],
  );
}
