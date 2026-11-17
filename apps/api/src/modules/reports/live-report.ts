import { formatBrPhone, formatDateTime, maskCpf, type OrderStatus, type PaymentMethod } from '@lle/shared';
import type { Queryable } from '../../db/pool.js';
import { Errors } from '../../lib/errors.js';
import { cardRejectionShort } from '../orders/service.js';
import { buildXlsx, type Sheet } from './xlsx.js';

/**
 * Relatório pós-live para os gerentes das lojas. O código do voucher (único, garantido pelo banco)
 * liga cada linha da planilha ao comprovante em PDF e à transação no Mercado Pago.
 */

export interface ReportScope {
  /** null = todas as lojas. */
  storeId: number | null;
}

interface OrderRow {
  id: string;
  code: string;
  status: OrderStatus;
  status_reason: string | null;
  created_at: Date;
  paid_at: Date | null;
  customer_name: string;
  customer_cpf: string;
  customer_whatsapp: string;
  customer_email: string;
  model_name: string;
  preferred_color: string | null;
  unit_color: string | null;
  price_live_cents: number;
  voucher_amount_cents: number;
  paid_method: PaymentMethod | null;
  payment_id: string | null;
  store_id: number;
  store_name: string;
  consultant_name: string | null;
  last_payment_detail: string | null;
  late_refund: boolean;
}

const VALID: OrderStatus[] = ['paid', 'completed'];
const REFUNDED: OrderStatus[] = ['refund_pending', 'refunded'];

const SITUATION: Partial<Record<OrderStatus, string>> = {
  paid: 'Pago · aguardando fechamento',
  completed: 'Venda fechada',
  refund_pending: 'Devolução em andamento',
  refunded: 'Devolvido',
};

const method = (m: PaymentMethod | null) => (m === 'card' ? 'Cartão' : m === 'pix' ? 'Pix' : '');
const reais = (cents: number) => cents / 100;

async function loadScope(db: Queryable, scope: ReportScope) {
  // Lojas da lista atual, mais as removidas que ainda têm pedidos (para nenhuma venda ficar fora do resumo).
  const stores = (
    await db.query<{ id: number; name: string }>(
      `SELECT s.id, s.name FROM stores s
        WHERE s.active OR EXISTS (SELECT 1 FROM orders o WHERE o.store_id = s.id)
        ORDER BY lower(s.name), s.id`,
    )
  ).rows;
  const store = scope.storeId === null ? null : stores.find((s) => s.id === scope.storeId);
  if (store === undefined) throw Errors.notFound('Loja');
  const orders = (
    await db.query<OrderRow>(
      `SELECT o.id, o.code, o.status, o.status_reason, o.created_at, o.paid_at,
              o.customer_name, o.customer_cpf, o.customer_whatsapp, o.customer_email,
              o.model_name, o.preferred_color, u.color AS unit_color,
              o.price_live_cents, o.voucher_amount_cents, o.paid_method,
              COALESCE(o.paid_payment_id, o.current_payment_id)::text AS payment_id,
              o.store_id, s.name AS store_name, c.name AS consultant_name, cp.status_detail AS last_payment_detail,
              EXISTS (SELECT 1 FROM audit_log a
                       WHERE a.entity = 'order' AND a.entity_id = o.id::text AND a.action = 'order.late_refund') AS late_refund
         FROM orders o
         JOIN stores s ON s.id = o.store_id
         LEFT JOIN units u ON u.id = o.unit_id
         LEFT JOIN consultants c ON c.id = o.consultant_id
         LEFT JOIN payments cp ON cp.id = o.current_payment_id
        WHERE ($1::int IS NULL OR o.store_id = $1)
        ORDER BY COALESCE(o.paid_at, o.created_at), o.code`,
      [scope.storeId],
    )
  ).rows;
  return { stores, store, orders };
}

/** Quem tentou e não levou: Pix vencido, cartão recusado ou pagou depois de esgotar. Sem quem acabou comprando. */
async function almostBought(db: Queryable, orders: OrderRow[]) {
  const buyers = new Set(
    (await db.query<{ cpf: string }>(`SELECT DISTINCT customer_cpf AS cpf FROM orders WHERE status IN ('paid', 'completed')`)).rows.map(
      (r) => r.cpf,
    ),
  );
  const latest = new Map<string, { order: OrderRow; reason: string }>();
  for (const o of orders) {
    if (buyers.has(o.customer_cpf)) continue;
    let reason: string | null = null;
    if (o.late_refund) reason = 'Pagou depois que a moto esgotou (valor devolvido)';
    else if (o.status === 'expired') reason = 'Gerou o Pix e não pagou a tempo';
    else if (o.status === 'failed') reason = `Cartão recusado (${cardRejectionShort(o.last_payment_detail)})`;
    if (reason) latest.set(`${o.customer_cpf}:${o.model_name}`, { order: o, reason }); // fica a tentativa mais recente
  }
  return [...latest.values()];
}

export async function buildLiveReportXlsx(db: Queryable, scope: ReportScope): Promise<{ file: Buffer; storeName: string | null }> {
  const { stores, store, orders } = await loadScope(db, scope);
  const valid = orders.filter((o) => VALID.includes(o.status));
  const refunded = orders.filter((o) => REFUNDED.includes(o.status));
  const almost = await almostBought(db, orders);

  const storesInScope = store ? [store] : stores;
  const summaryRows: (string | number | null)[][] = storesInScope.map((s) => {
    const v = valid.filter((o) => o.store_id === s.id);
    return [
      s.name,
      v.length,
      reais(v.reduce((n, o) => n + o.voucher_amount_cents, 0)),
      refunded.filter((o) => o.store_id === s.id).length,
      almost.filter((a) => a.order.store_id === s.id).length,
    ];
  });
  if (!store) {
    summaryRows.push(['Total', valid.length, reais(valid.reduce((n, o) => n + o.voucher_amount_cents, 0)), refunded.length, almost.length]);
    const { rows } = await db.query<{ offline_sales: number }>(`SELECT offline_sales FROM live_settings WHERE id = 1`);
    summaryRows.push(['Ajuste manual do termômetro (não são vendas do site)', rows[0]?.offline_sales ?? 0, null, null, null]);
  }

  const models = [...new Set(orders.map((o) => o.model_name))].sort();
  const sheets: Sheet[] = [
    {
      name: 'Resumo',
      columns: [
        { header: 'Loja', width: 44 },
        { header: 'Vendas válidas', width: 15, type: 'int' },
        { header: 'Valor em vouchers', width: 18, type: 'money' },
        { header: 'Devolvidos', width: 12, type: 'int' },
        { header: 'Quase compraram', width: 17, type: 'int' },
      ],
      rows: summaryRows,
    },
    {
      name: 'Vendas',
      columns: [
        { header: 'Código do voucher', width: 18 },
        { header: 'Situação', width: 28 },
        { header: 'Pago em', width: 17 },
        { header: 'Cliente', width: 30 },
        { header: 'CPF', width: 16 },
        { header: 'WhatsApp', width: 17 },
        { header: 'E-mail', width: 30 },
        { header: 'Moto', width: 22 },
        { header: 'Cor de preferência', width: 18 },
        { header: 'Cor da unidade reservada', width: 22 },
        { header: 'Preço garantido', width: 16, type: 'money' },
        { header: 'Voucher pago', width: 14, type: 'money' },
        { header: 'Forma de pagamento', width: 18 },
        { header: 'Transação Mercado Pago', width: 22 },
        { header: 'Loja de preferência', width: 18 },
      ],
      rows: valid.map((o) => [
        o.code,
        SITUATION[o.status],
        o.paid_at ? formatDateTime(o.paid_at.toISOString()) : '',
        o.customer_name,
        maskCpf(o.customer_cpf),
        formatBrPhone(o.customer_whatsapp),
        o.customer_email,
        o.model_name,
        o.preferred_color,
        o.unit_color,
        reais(o.price_live_cents),
        reais(o.voucher_amount_cents),
        method(o.paid_method),
        o.payment_id,
        o.store_name,
      ]),
    },
    {
      name: 'Devolvidos',
      columns: [
        { header: 'Código do voucher', width: 18 },
        { header: 'Situação', width: 24 },
        { header: 'Motivo', width: 60 },
        { header: 'Cliente', width: 30 },
        { header: 'WhatsApp', width: 17 },
        { header: 'Moto', width: 22 },
        { header: 'Valor devolvido', width: 15, type: 'money' },
        { header: 'Transação Mercado Pago', width: 22 },
        { header: 'Loja', width: 16 },
      ],
      rows: refunded.map((o) => [
        o.code,
        SITUATION[o.status],
        o.status_reason,
        o.customer_name,
        formatBrPhone(o.customer_whatsapp),
        o.model_name,
        reais(o.voucher_amount_cents),
        o.payment_id,
        o.store_name,
      ]),
    },
    {
      name: 'Quase compraram',
      columns: [
        { header: 'O que aconteceu', width: 50 },
        { header: 'Quando', width: 17 },
        { header: 'Cliente', width: 30 },
        { header: 'WhatsApp', width: 17 },
        { header: 'E-mail', width: 30 },
        { header: 'Moto', width: 22 },
        { header: 'Loja escolhida', width: 16 },
        { header: 'Código da tentativa', width: 18 },
      ],
      rows: almost.map(({ order: o, reason }) => [
        reason,
        formatDateTime(o.created_at.toISOString()),
        o.customer_name,
        formatBrPhone(o.customer_whatsapp),
        o.customer_email,
        o.model_name,
        o.store_name,
        o.code,
      ]),
    },
    {
      name: 'Por moto',
      columns: [
        { header: 'Moto', width: 24 },
        { header: 'Vendas válidas', width: 15, type: 'int' },
        { header: 'Valor em vouchers', width: 18, type: 'money' },
        { header: 'Devolvidos', width: 12, type: 'int' },
        { header: 'Quase compraram', width: 17, type: 'int' },
      ],
      rows: models.map((m) => {
        const v = valid.filter((o) => o.model_name === m);
        return [
          m,
          v.length,
          reais(v.reduce((n, o) => n + o.voucher_amount_cents, 0)),
          refunded.filter((o) => o.model_name === m).length,
          almost.filter((a) => a.order.model_name === m).length,
        ];
      }),
    },
  ];

  // A lista de espera é por moto, não por loja: vai só no relatório geral (evita ligações repetidas).
  if (!store) {
    const { rows } = await db.query<{ name: string; whatsapp: string; created_at: Date; model_name: string }>(
      `SELECT w.name, w.whatsapp, w.created_at, m.name AS model_name
         FROM waitlist w JOIN models m ON m.id = w.model_id ORDER BY m.name, w.created_at`,
    );
    sheets.push({
      name: 'Lista de espera',
      columns: [
        { header: 'Moto', width: 22 },
        { header: 'Nome', width: 30 },
        { header: 'WhatsApp', width: 17 },
        { header: 'Entrou na lista', width: 17 },
      ],
      rows: rows.map((r) => [r.model_name, r.name, formatBrPhone(r.whatsapp), formatDateTime(r.created_at.toISOString())]),
    });
  }

  return { file: buildXlsx(sheets), storeName: store?.name ?? null };
}

/** Ids dos vouchers válidos no escopo, na mesma ordem da aba "Vendas" (para o PDF de comprovantes). */
export async function validOrderIds(db: Queryable, scope: ReportScope): Promise<{ ids: string[]; storeName: string | null }> {
  const { store, orders } = await loadScope(db, scope);
  return { ids: orders.filter((o) => VALID.includes(o.status)).map((o) => o.id), storeName: store?.name ?? null };
}
