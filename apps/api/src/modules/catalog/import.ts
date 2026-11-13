import type { Db, Tx } from '../../db/pool.js';
import { audit } from '../audit.js';
import { addUnits, removeOneAvailableUnit } from '../inventory/units.js';
import type { CatalogRow } from './spreadsheet.js';

export interface CatalogChange {
  name: string;
  action: 'criada' | 'atualizada';
  unitsAdded: number;
  unitsRemoved: number;
  /** Unidades que deveriam sair mas estão em pagamento ou vendidas (ficam). */
  unitsKept: number;
}

export interface CatalogImportResult {
  changes: CatalogChange[];
  deactivated: string[];
}

/**
 * Aplica a planilha: cria ou atualiza cada moto (pelo endereço/slug) e ajusta as unidades físicas de cada cor
 * à quantidade informada. Rodar de novo com a mesma planilha não muda nada. Motos novas entram bloqueadas;
 * a liberação de motos já liberadas é mantida. Nunca retira unidade em pagamento ou vendida.
 */
export async function applyCatalog(
  db: Db,
  rows: CatalogRow[],
  opts: { deactivateOthers: boolean; dryRun: boolean },
): Promise<CatalogImportResult> {
  const run = async (tx: Tx): Promise<CatalogImportResult> => {
    const changes: CatalogChange[] = [];
    for (const [i, r] of rows.entries()) {
      const colors = r.stock.map((s) => s.color).filter(Boolean);
      const { rows: up } = await tx.query<{ id: number; inserted: boolean }>(
        `INSERT INTO models (slug, name, category_label, colors, price_live_cents, price_table_cents, down_payment_cents,
                             installment_cents, installments, rate_note, specs, description, offer_active, sort)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name, category_label = EXCLUDED.category_label, colors = EXCLUDED.colors,
           price_live_cents = EXCLUDED.price_live_cents, price_table_cents = EXCLUDED.price_table_cents,
           down_payment_cents = EXCLUDED.down_payment_cents, installment_cents = EXCLUDED.installment_cents,
           installments = EXCLUDED.installments, rate_note = EXCLUDED.rate_note, specs = EXCLUDED.specs,
           description = EXCLUDED.description, offer_active = true, sort = EXCLUDED.sort, updated_at = now()
         RETURNING id, (xmax = 0) AS inserted`,
        [r.slug, r.name, r.categoryLabel, colors, r.priceLiveCents, r.priceTableCents, r.downPaymentCents,
          r.installmentCents, r.installments, r.rateNote, JSON.stringify(r.specs), r.description, (i + 1) * 10],
      );
      const { id, inserted } = up[0]!;
      let unitsAdded = 0;
      let unitsRemoved = 0;
      let unitsKept = 0;

      // Cores que já existem no banco mas sumiram da planilha também são zeradas.
      const { rows: current } = await tx.query<{ color: string; total: number }>(
        `SELECT COALESCE(color, '') AS color, count(*)::int AS total FROM units WHERE model_id = $1 AND status <> 'removed' GROUP BY 1`,
        [id],
      );
      const target = new Map(r.stock.map((s) => [s.color.toLowerCase(), s]));
      const keys = new Set([...target.keys(), ...current.map((c) => c.color.toLowerCase())]);
      for (const key of keys) {
        const want = target.get(key)?.quantity ?? 0;
        const have = current.filter((c) => c.color.toLowerCase() === key).reduce((n, c) => n + c.total, 0);
        const color = target.get(key)?.color ?? current.find((c) => c.color.toLowerCase() === key)?.color ?? '';
        if (want > have) {
          unitsAdded += (await addUnits(tx, id, Array.from({ length: want - have }, () => ({ color: color || null })))).length;
        }
        for (let k = 0; k < have - want; k++) {
          const { rows: free } = await tx.query<{ id: number }>(
            `SELECT id FROM units WHERE model_id = $1 AND status = 'available' AND lower(COALESCE(color, '')) = $2 ORDER BY id DESC LIMIT 1`,
            [id, key],
          );
          const removed = free[0] ? await removeOneAvailableUnit(tx, id, free[0].id) : null;
          if (removed === null) unitsKept++;
          else unitsRemoved++;
        }
      }
      changes.push({ name: r.name, action: inserted ? 'criada' : 'atualizada', unitsAdded, unitsRemoved, unitsKept });
    }

    let deactivated: string[] = [];
    if (opts.deactivateOthers) {
      const { rows: off } = await tx.query<{ name: string }>(
        `UPDATE models SET offer_active = false, released_at = NULL, updated_at = now()
          WHERE offer_active AND NOT (slug = ANY($1::text[])) RETURNING name`,
        [rows.map((r) => r.slug)],
      );
      deactivated = off.map((m) => m.name);
    }
    await audit(tx, { type: 'system', id: 'importacao' }, 'catalog.imported', 'model', 'all', {
      models: changes.length,
      deactivated,
    });
    return { changes, deactivated };
  };

  if (!opts.dryRun) return db.tx(run);
  // Simulação: aplica dentro da transação e desfaz no final, para mostrar exatamente o que mudaria.
  const DRY = new Error('simulação');
  let result: CatalogImportResult | null = null;
  try {
    await db.tx(async (tx) => {
      result = await run(tx);
      throw DRY;
    });
  } catch (err) {
    if (err !== DRY) throw err;
  }
  return result!;
}
