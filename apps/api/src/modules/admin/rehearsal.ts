import type { Db, Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';

/**
 * Limpeza dos dados do ensaio antes da live: apaga pedidos, pagamentos, lista de espera e vendas de balcão,
 * devolve as unidades ao estoque, bloqueia todas as motos e volta a live para "Em breve".
 * Mantém motos, fotos, preços, estoque físico, metas, consultores e configurações.
 */

export interface RehearsalSummary {
  liveStatus: string;
  orders: number;
  /** Pedidos com dinheiro que não foi devolvido (pago, fechado ou devolução em andamento). */
  paidNotRefunded: number;
  payments: number;
  waitlist: number;
  offlineSales: number;
  releasedModels: number;
  unitsInUse: number;
}

export async function rehearsalSummary(db: Queryable): Promise<RehearsalSummary> {
  const { rows } = await db.query<RehearsalSummary>(
    `SELECT (SELECT status FROM live_settings WHERE id = 1) AS "liveStatus",
            (SELECT count(*)::int FROM orders) AS orders,
            (SELECT count(*)::int FROM orders WHERE status IN ('paid', 'completed', 'refund_pending')) AS "paidNotRefunded",
            (SELECT count(*)::int FROM payments) AS payments,
            ((SELECT count(*) FROM waitlist) + (SELECT COALESCE(sum(count), 0) FROM model_wants))::int AS waitlist,
            (SELECT offline_sales FROM live_settings WHERE id = 1) AS "offlineSales",
            (SELECT count(*)::int FROM models WHERE released_at IS NOT NULL) AS "releasedModels",
            (SELECT count(*)::int FROM units WHERE order_id IS NOT NULL) AS "unitsInUse"`,
  );
  return rows[0]!;
}

export async function clearRehearsalData(db: Db, opts: { allowPaid: boolean }): Promise<RehearsalSummary> {
  return db.tx(async (tx) => {
    const { rows } = await tx.query<{ status: string }>(`SELECT status FROM live_settings WHERE id = 1 FOR UPDATE`);
    if (rows[0]?.status === 'ao_vivo') {
      throw new AppError('LIVE_ON_AIR', 'A live está como "Ao vivo": limpeza bloqueada. Mude o status no painel antes.', 409);
    }
    const before = await rehearsalSummary(tx);
    if (before.paidNotRefunded > 0 && !opts.allowPaid) {
      throw new AppError(
        'PAID_ORDERS',
        `${before.paidNotRefunded} pedido(s) pago(s) sem devolução. Confirme que são pagamentos de teste (ou devolva-os) e rode com --apagar-pagos.`,
        409,
      );
    }
    await tx.query(`UPDATE units SET status = 'available', order_id = NULL, updated_at = now() WHERE order_id IS NOT NULL`);
    await tx.query(`DELETE FROM payments`);
    await tx.query(`DELETE FROM orders`);
    await tx.query(`DELETE FROM jobs`);
    await tx.query(`DELETE FROM webhook_events`);
    await tx.query(`DELETE FROM waitlist`);
    await tx.query(`DELETE FROM model_wants`);
    await tx.query(`DELETE FROM offline_sale_events`);
    await tx.query(`DELETE FROM audit_log WHERE entity IN ('order', 'job', 'report')`);
    await tx.query(`UPDATE live_settings SET offline_sales = 0, status = 'em_breve', featured_model_id = NULL, updated_at = now() WHERE id = 1`);
    await tx.query(`UPDATE models SET released_at = NULL, updated_at = now() WHERE released_at IS NOT NULL`);
    await tx.query(
      `INSERT INTO audit_log (actor_type, actor_id, action, entity, entity_id, data) VALUES ('system', 'ensaio', 'rehearsal.cleared', 'live', 'all', $1)`,
      [JSON.stringify(before)],
    );
    return before;
  });
}
