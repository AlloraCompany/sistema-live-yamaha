import type { Db, Tx } from '../../db/pool.js';
import { isUniqueViolation } from '../../db/pool.js';
import type { Logger } from '../../logger.js';
import { AppError, Errors, UpstreamError } from '../../lib/errors.js';
import { sha256, voucherCode } from '../../lib/crypto.js';
import { audit, type Actor } from '../audit.js';
import { enqueue } from '../jobs/queue.js';
import {
  holdUnit,
  lockAvailableUnit,
  releaseOrderUnit,
  releaseUnitsOfOrders,
  sellHeldUnit,
} from '../inventory/units.js';
import { paymentOutcome, type GatewayPayment, type PaymentGateway, type PayerData } from '../payments/gateway.js';
import type { LiveStatus } from '@lle/shared';
import { isSalesOpen } from '../live/snapshot.js';
import type { CreateOrderParsed, PaymentInputParsed } from './schemas.js';

/** Pix no Mercado Pago precisa expirar entre 30 min e 30 dias após a criação. */
const PIX_MIN_EXPIRATION_MS = 30 * 60 * 1000 + 15_000;

interface OrderRow {
  id: string;
  code: string;
  status: string;
  model_id: number;
  unit_id: number | null;
  store_id: number;
  customer_name: string;
  customer_cpf: string;
  customer_email: string;
  model_name: string;
  voucher_amount_cents: number;
  hold_expires_at: Date;
  current_payment_id: number | null;
  paid_payment_id: number | null;
  pix_attempt: number;
}

export type ApplyResult =
  | 'unknown_order'
  | 'stale'
  | 'recorded'
  | 'paid'
  | 'paid_late'
  | 'late_refund'
  | 'duplicate_refund'
  | 'failed'
  | 'reversed'
  | 'noop';

export interface OrdersServiceDeps {
  db: Db;
  log: Logger;
  gateway: PaymentGateway | null;
  holdGraceSeconds: number;
}

class NoUnitAvailable extends Error {
  constructor(public readonly modelId: number) {
    super('sem unidade disponível');
  }
}

/**
 * Regras de venda do voucher: reserva temporária, pagamento, baixa de estoque, expiração e devolução.
 *
 * Invariantes (garantidas por transação + lock de linha do pedido + constraints do banco):
 *  - uma unidade física pertence a no máximo um pedido;
 *  - a baixa definitiva (unidade "sold") só acontece com pagamento aprovado;
 *  - um pagamento aprovado quita no máximo um pedido; um pedido é quitado por no máximo um pagamento;
 *    aprovações extras do mesmo pedido são estornadas automaticamente;
 *  - aplicar o mesmo status de pagamento N vezes (webhooks repetidos) tem o mesmo efeito que aplicar uma vez.
 */
export class OrdersService {
  constructor(private readonly deps: OrdersServiceDeps) {}

  private get db() {
    return this.deps.db;
  }

  /* ------------------------------------------------------------------ */
  /* Criação do pedido (reserva temporária da unidade)                   */
  /* ------------------------------------------------------------------ */

  async createOrder(input: CreateOrderParsed, clientIp: string | null): Promise<{ orderId: string; created: boolean }> {
    const tokenHash = sha256(input.clientToken);
    const existing = await this.findByTokenHash(tokenHash);
    if (existing) return { orderId: existing, created: false };

    let triedExpiring = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.db.tx((tx) => this.createOrderTx(tx, input, tokenHash, clientIp));
      } catch (err) {
        if (isUniqueViolation(err, 'orders_access_token_hash_key')) {
          const id = await this.findByTokenHash(tokenHash);
          if (id) return { orderId: id, created: false };
        }
        if (isUniqueViolation(err, 'orders_one_pending_per_cpf_model')) throw Errors.pendingElsewhere();
        if (isUniqueViolation(err, 'orders_code_key')) continue; // colisão de código: tenta outro
        if (err instanceof NoUnitAvailable) {
          if (!triedExpiring) {
            triedExpiring = true;
            // Libera na hora reservas vencidas deste modelo antes de responder "esgotado". Espera
            // (sem SKIP LOCKED) quem já está liberando as mesmas reservas e tenta pegar a moto de novo.
            await this.expireOverdue({ modelId: err.modelId, waitForLocks: true });
            continue;
          }
          const { rows } = await this.db.query<{ held: number }>(
            `SELECT count(*)::int AS held FROM units WHERE model_id = $1 AND status = 'held'`,
            [err.modelId],
          );
          throw rows[0]!.held > 0 ? Errors.allOnHold() : Errors.soldOut();
        }
        if (err instanceof AppError && err.code === 'UNIT_RACE') continue;
        throw err;
      }
    }
    throw new AppError('BUSY', 'Muita gente comprando agora. Tente de novo em instantes.', 503);
  }

  private async createOrderTx(
    tx: Tx,
    input: CreateOrderParsed,
    tokenHash: Buffer,
    clientIp: string | null,
  ): Promise<{ orderId: string; created: boolean }> {
    const settings = (
      await tx.query<{
        status: LiveStatus;
        voucher_amount_cents: number;
        valid_until: string | null;
        hold_minutes: number;
        offers_until: Date | null;
      }>(`SELECT status, voucher_amount_cents, valid_until, hold_minutes, offers_until FROM live_settings WHERE id = 1`)
    ).rows[0]!;
    // Vende com a live no ar e, depois de encerrada, até o prazo das condições.
    if (!isSalesOpen(settings.status, settings.offers_until)) throw Errors.liveNotOpen(settings.status === 'encerrada');

    const model = (
      await tx.query<{
        id: number;
        name: string;
        price_live_cents: number;
        released_at: Date | null;
        offer_active: boolean;
        colors: string[];
      }>(`SELECT id, name, price_live_cents, released_at, offer_active, colors FROM models WHERE slug = $1`, [input.modelSlug])
    ).rows[0];
    if (!model) throw Errors.notFound('Moto');
    if (!model.released_at) throw Errors.notReleased();
    if (!model.offer_active) throw Errors.offerInactive();

    // Cor de preferência: precisa ser uma das cores da moto (grava com a grafia do cadastro).
    const wanted = input.color ?? null;
    const color = wanted ? (model.colors.find((c) => c.toLowerCase() === wanted.toLowerCase()) ?? null) : null;
    if (wanted && !color) throw Errors.validation('Escolha uma das cores disponíveis para esta moto.');

    const store = (await tx.query(`SELECT 1 FROM stores WHERE id = $1 AND active`, [input.storeId])).rows[0];
    if (!store) throw Errors.validation('Loja de preferência inválida.');

    // Serializa tentativas do MESMO CPF (várias abas/aparelhos): só a primeira chega a segurar uma moto;
    // as outras esperam milissegundos e veem a reserva já criada. CPFs diferentes não disputam este lock.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 7))`, [`cpf:${input.customer.cpf}`]);
    // Mesma requisição repetida (duplo clique) que esperou o lock: devolve o pedido que a primeira criou.
    const same = await tx.query<{ id: string }>(`SELECT id FROM orders WHERE access_token_hash = $1`, [tokenHash]);
    if (same.rows[0]) return { orderId: same.rows[0].id, created: false };
    const pending = await tx.query(
      `SELECT 1 FROM orders WHERE customer_cpf = $1 AND model_id = $2 AND status = 'pending_payment'`,
      [input.customer.cpf, model.id],
    );
    if (pending.rowCount) throw Errors.pendingElsewhere();

    const unitId = await lockAvailableUnit(tx, model.id, color);
    if (unitId === null) throw new NoUnitAvailable(model.id);

    const { customer: c } = input;
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO orders (
         code, access_token_hash, model_id, unit_id, store_id, status,
         customer_name, customer_cpf, customer_whatsapp, customer_email,
         model_name, price_live_cents, voucher_amount_cents, valid_until,
         hold_expires_at, terms_accepted_at, client_ip, preferred_color)
       VALUES ($1, $2, $3, $4, $5, 'pending_payment',
         $6, $7, $8, $9,
         $10, $11, $12, $13,
         now() + make_interval(mins => $14), now(), $15, $16)
       RETURNING id`,
      [
        voucherCode(), tokenHash, model.id, unitId, input.storeId,
        c.name, c.cpf, c.whatsapp, c.email,
        model.name, model.price_live_cents, settings.voucher_amount_cents, settings.valid_until,
        settings.hold_minutes, clientIp, color,
      ],
    );
    const orderId = rows[0]!.id;
    await holdUnit(tx, unitId, orderId);
    await audit(tx, { type: 'customer' }, 'order.created', 'order', orderId, { unitId, modelId: model.id });
    return { orderId, created: true };
  }

  private async findByTokenHash(tokenHash: Buffer): Promise<string | null> {
    const { rows } = await this.db.query<{ id: string }>(`SELECT id FROM orders WHERE access_token_hash = $1`, [tokenHash]);
    return rows[0]?.id ?? null;
  }

  async findIdByCodeAndToken(code: string, token: string): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM orders WHERE code = $1 AND access_token_hash = $2`,
      [code, sha256(token)],
    );
    if (!rows[0]) throw Errors.notFound('Pedido');
    return rows[0].id;
  }

  /* ------------------------------------------------------------------ */
  /* Pagamento                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Cria (ou recupera, de forma idempotente) a cobrança do pedido no Mercado Pago e aplica o resultado.
   * Retorna o erro de pagamento sem desfazer o pedido: a reserva continua valendo e o cliente pode repetir.
   */
  async startPayment(orderId: string, input: PaymentInputParsed): Promise<{ error: AppError | null }> {
    const gateway = this.deps.gateway;
    if (!gateway) return { error: Errors.paymentsNotConfigured() };

    const plan = await this.db.tx(async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      if (!order) throw Errors.notFound('Pedido');
      if (order.status === 'paid' || order.status === 'completed') return { kind: 'done' as const };
      if (order.status !== 'pending_payment') throw Errors.orderClosed();
      if (order.hold_expires_at.getTime() <= Date.now()) throw Errors.holdExpired();

      const current = order.current_payment_id
        ? (
            await tx.query<{ id: number; method: string; status: string; idempotency_key: string }>(
              `SELECT id, method, status, idempotency_key FROM payments WHERE id = $1`,
              [order.current_payment_id],
            )
          ).rows[0]
        : undefined;
      const currentOpen = current && paymentOutcome(current.status) === 'pending';

      // Pix já gerado e aguardando: devolve o mesmo (clique duplo, recarregar página etc.).
      if (input.method === 'pix' && currentOpen && current.method === 'pix') return { kind: 'done' as const };

      let pixAttempt = order.pix_attempt;
      if (input.method === 'pix' && current?.method === 'pix' && !currentOpen) {
        pixAttempt += 1; // Pix anterior cancelado/recusado: precisa de uma cobrança nova.
        await tx.query(`UPDATE orders SET pix_attempt = $2, updated_at = now() WHERE id = $1`, [orderId, pixAttempt]);
      }
      const supersede = currentOpen ? String(current.id) : null;
      if (supersede) {
        // Troca de forma de pagamento: a cobrança antiga deixa de ser a "atual" antes de ser cancelada,
        // assim o cancelamento dela não derruba o pedido.
        await tx.query(`UPDATE orders SET current_payment_id = NULL, updated_at = now() WHERE id = $1`, [orderId]);
      }
      return {
        kind: 'charge' as const,
        supersede,
        idempotencyKey:
          input.method === 'pix' ? `pix-${orderId}-${pixAttempt}` : `card-${orderId}-${input.attemptKey}`,
        order,
      };
    });
    if (plan.kind === 'done') return { error: null };

    const { order } = plan;
    try {
      if (plan.supersede) {
        const cancelled = await this.cancelAtGateway(plan.supersede);
        if (cancelled && paymentOutcome(cancelled.status) === 'approved') {
          // O pagamento antigo foi aprovado no meio da troca: o pedido está pago, não cobra de novo.
          await this.applyGatewayPayment(cancelled, { type: 'system', id: 'payment-switch' });
          return { error: null };
        }
      }

      const payer = splitPayer(order);
      const description = `Voucher Live Limpa Estoque - ${order.model_name} (${order.code})`;
      const payment =
        input.method === 'pix'
          ? await gateway.createPix({
              idempotencyKey: plan.idempotencyKey,
              orderId,
              amountCents: order.voucher_amount_cents,
              description,
              payer,
              expiresAt: new Date(Math.max(order.hold_expires_at.getTime(), Date.now() + PIX_MIN_EXPIRATION_MS)),
            })
          : await gateway.createCard({
              idempotencyKey: plan.idempotencyKey,
              orderId,
              amountCents: order.voucher_amount_cents,
              description,
              token: input.token,
              paymentMethodId: input.paymentMethodId,
              issuerId: input.issuerId,
              installments: input.installments,
              payer: {
                ...payer,
                identificationType: input.payer?.identificationType,
                identificationNumber: input.payer?.identificationNumber,
              },
            });

      await this.applyGatewayPayment(payment, { type: 'customer' }, { idempotencyKey: plan.idempotencyKey, makeCurrent: true });
      if (input.method === 'card' && paymentOutcome(payment.status) === 'failed') {
        return { error: new AppError('CARD_REJECTED', cardRejectionMessage(payment.statusDetail), 402) };
      }
      return { error: null };
    } catch (err) {
      if (err instanceof UpstreamError) {
        this.deps.log.error({ err, orderId }, 'falha ao criar cobrança no Mercado Pago');
        if (err.retryable) return { error: Errors.paymentProvider() };
        return {
          error: new AppError(
            'PAYMENT_REJECTED',
            input.method === 'card'
              ? 'O Mercado Pago recusou os dados do cartão. Confira e tente de novo, ou pague com Pix.'
              : 'Não foi possível gerar o Pix agora. Tente de novo em instantes.',
            402,
          ),
        };
      }
      throw err;
    }
  }

  private async cancelAtGateway(paymentId: string): Promise<GatewayPayment | null> {
    const gateway = this.deps.gateway!;
    try {
      return await gateway.cancel(paymentId);
    } catch (err) {
      // Não cancelável (ex.: já aprovado): consulta o estado real.
      if (err instanceof UpstreamError && !err.retryable) return gateway.get(paymentId);
      throw err;
    }
  }

  /**
   * Aplica o estado autoritativo de um pagamento (lido do Mercado Pago) ao pedido.
   * Chamado por: criação da cobrança, webhooks, reconciliação periódica e jobs de cancelamento/estorno.
   * Idempotente e seguro contra concorrência (lock da linha do pedido).
   */
  async applyGatewayPayment(
    p: GatewayPayment,
    actor: Actor,
    opts: { idempotencyKey?: string; makeCurrent?: boolean } = {},
  ): Promise<ApplyResult> {
    const orderId = p.externalReference;
    if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) return 'unknown_order';

    return this.db.tx(async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      if (!order) return 'unknown_order';

      const stored = (
        await tx.query<{ status: string; provider_updated_at: Date | null }>(
          `SELECT status, provider_updated_at FROM payments WHERE id = $1 FOR UPDATE`,
          [p.id],
        )
      ).rows[0];
      if (stored && stored.provider_updated_at && p.updatedAt && new Date(p.updatedAt) < stored.provider_updated_at) {
        return 'stale'; // leitura mais antiga que a já aplicada (webhooks fora de ordem)
      }

      await tx.query(
        `INSERT INTO payments (id, order_id, method, status, status_detail, amount_cents, idempotency_key,
                               pix_qr_code, pix_qr_base64, pix_ticket_url, expires_at, approved_at, provider_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           status_detail = EXCLUDED.status_detail,
           approved_at = COALESCE(EXCLUDED.approved_at, payments.approved_at),
           provider_updated_at = COALESCE(EXCLUDED.provider_updated_at, payments.provider_updated_at),
           pix_qr_code = COALESCE(payments.pix_qr_code, EXCLUDED.pix_qr_code),
           pix_qr_base64 = COALESCE(payments.pix_qr_base64, EXCLUDED.pix_qr_base64),
           pix_ticket_url = COALESCE(payments.pix_ticket_url, EXCLUDED.pix_ticket_url),
           updated_at = now()`,
        [
          p.id, orderId, p.method, p.status, p.statusDetail, p.amountCents,
          opts.idempotencyKey ?? `external-${p.id}`,
          p.pix?.qrCode ?? null, p.pix?.qrCodeBase64 ?? null, p.pix?.ticketUrl ?? null,
          p.expiresAt, p.approvedAt, p.updatedAt,
        ],
      );

      const paymentId = Number(p.id);
      if (opts.makeCurrent && order.status === 'pending_payment') {
        await tx.query(`UPDATE orders SET current_payment_id = $2, updated_at = now() WHERE id = $1`, [orderId, paymentId]);
        order.current_payment_id = paymentId;
      }

      switch (paymentOutcome(p.status)) {
        case 'approved':
          return this.onApproved(tx, order, p, actor);
        case 'failed':
          if (order.status === 'pending_payment' && order.current_payment_id === paymentId) {
            await tx.query(
              `UPDATE orders SET status = 'failed', status_reason = $2, updated_at = now() WHERE id = $1`,
              [
                orderId,
                p.method === 'card'
                  ? `Cartão recusado (${cardRejectionShort(p.statusDetail)})`
                  : `Pagamento não aprovado (${p.statusDetail ?? p.status})`,
              ],
            );
            await releaseOrderUnit(tx, orderId);
            await audit(tx, actor, 'order.failed', 'order', orderId, { paymentId: p.id, detail: p.statusDetail });
            return 'failed';
          }
          return 'recorded';
        case 'reversed':
          if (order.paid_payment_id === paymentId && ['paid', 'completed', 'refund_pending'].includes(order.status)) {
            await tx.query(
              `UPDATE orders SET status = 'refunded', status_reason = COALESCE($2, status_reason), updated_at = now() WHERE id = $1`,
              [orderId, p.status === 'charged_back' ? 'Contestação do pagamento (chargeback)' : null],
            );
            await releaseOrderUnit(tx, orderId);
            await audit(tx, actor, 'order.refunded', 'order', orderId, { paymentId: p.id, status: p.status });
            return 'reversed';
          }
          return 'recorded';
        default:
          // Cobrança ainda aberta de um pedido que não aceita mais pagamento: cancela para não cobrar à toa.
          if (order.status !== 'pending_payment' && order.paid_payment_id !== paymentId && paymentOutcome(p.status) === 'pending') {
            await enqueue(tx, 'payment.cancel', { paymentId: p.id }, { dedupeKey: `cancel:${p.id}` });
          }
          return 'recorded';
      }
    });
  }

  private async onApproved(tx: Tx, order: OrderRow, p: GatewayPayment, actor: Actor): Promise<ApplyResult> {
    const paymentId = Number(p.id);
    if (order.paid_payment_id === paymentId) return 'noop';

    if (order.status === 'pending_payment') {
      const unitId = await sellHeldUnit(tx, order.id);
      if (unitId === null) throw new Error(`pedido ${order.id} pendente sem unidade segurada`);
      await this.markPaid(tx, order, p, null);
      await audit(tx, actor, 'order.paid', 'order', order.id, { paymentId: p.id, unitId });
      return 'paid';
    }

    if (order.paid_payment_id !== null) {
      // Segundo pagamento aprovado para um pedido já quitado (ex.: Pix pago depois do cartão): estorna.
      await enqueue(tx, 'payment.refund', { paymentId: p.id, orderId: order.id }, { dedupeKey: `refund:${p.id}` });
      await audit(tx, actor, 'payment.duplicate', 'order', order.id, { paymentId: p.id });
      return 'duplicate_refund';
    }

    // Pagamento chegou depois que a reserva expirou/falhou: tenta pegar outra unidade do mesmo modelo.
    const unitId = await lockAvailableUnit(tx, order.model_id);
    if (unitId !== null) {
      await holdUnit(tx, unitId, order.id);
      await sellHeldUnit(tx, order.id);
      await tx.query(`UPDATE orders SET unit_id = $2 WHERE id = $1`, [order.id, unitId]);
      await this.markPaid(tx, order, p, 'Pagamento confirmado após o fim da reserva; unidade garantida.');
      await audit(tx, actor, 'order.paid_late', 'order', order.id, { paymentId: p.id, unitId });
      return 'paid_late';
    }
    await tx.query(
      `UPDATE orders SET status = 'refund_pending', paid_payment_id = $2, paid_method = $3, paid_at = now(),
              status_reason = 'Pagamento recebido após a reserva expirar e sem unidade disponível: devolução automática.',
              updated_at = now()
        WHERE id = $1`,
      [order.id, paymentId, p.method],
    );
    await enqueue(tx, 'payment.refund', { paymentId: p.id, orderId: order.id }, { dedupeKey: `refund:${p.id}` });
    await audit(tx, actor, 'order.late_refund', 'order', order.id, { paymentId: p.id });
    return 'late_refund';
  }

  private async markPaid(tx: Tx, order: OrderRow, p: GatewayPayment, reason: string | null): Promise<void> {
    // Consultor da loja escolhida com menos clientes da live (distribuição equilibrada).
    const consultant = (
      await tx.query<{ id: number }>(
        `SELECT c.id FROM consultants c
           LEFT JOIN orders o ON o.consultant_id = c.id AND o.status IN ('paid', 'completed')
          WHERE c.active AND (c.store_id = $1 OR c.store_id IS NULL)
          GROUP BY c.id
          ORDER BY (c.store_id IS NULL), count(o.id), c.id
          LIMIT 1`,
        [order.store_id],
      )
    ).rows[0];
    await tx.query(
      `UPDATE orders SET status = 'paid', paid_payment_id = $2, paid_method = $3,
              paid_at = COALESCE($4::timestamptz, now()), consultant_id = $5, current_payment_id = $2,
              status_reason = $6, updated_at = now()
        WHERE id = $1`,
      [order.id, Number(p.id), p.method, p.approvedAt, consultant?.id ?? null, reason],
    );
    // Outras cobranças abertas deste pedido (ex.: Pix gerado antes de pagar com cartão) são canceladas.
    const { rows: open } = await tx.query<{ id: string }>(
      `SELECT id::text FROM payments WHERE order_id = $1 AND id <> $2 AND status IN ('pending', 'in_process', 'authorized')`,
      [order.id, Number(p.id)],
    );
    for (const o of open) await enqueue(tx, 'payment.cancel', { paymentId: o.id }, { dedupeKey: `cancel:${o.id}` });
  }

  private async lockOrder(tx: Tx, orderId: string): Promise<(OrderRow & { pix_attempt: number }) | null> {
    const { rows } = await tx.query<OrderRow>(
      `SELECT id, code, status, model_id, unit_id, store_id, customer_name, customer_cpf, customer_email, model_name,
              voucher_amount_cents, hold_expires_at, current_payment_id, paid_payment_id, pix_attempt
         FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    return rows[0] ?? null;
  }

  /** Consulta o pagamento no MP e aplica (webhook, reconciliação, jobs). */
  async syncPayment(paymentId: string, actor: Actor): Promise<ApplyResult> {
    if (!this.deps.gateway) throw Errors.paymentsNotConfigured();
    const p = await this.deps.gateway.get(paymentId);
    return this.applyGatewayPayment(p, actor);
  }

  /* ------------------------------------------------------------------ */
  /* Expiração de reservas                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Expira reservas vencidas (após a tolerância), devolve as unidades ao estoque e agenda o
   * cancelamento das cobranças abertas para que um Pix tardio não seja pago.
   */
  async expireOverdue(opts: { modelId?: number; limit?: number; waitForLocks?: boolean } = {}): Promise<number> {
    // Varredura de fundo pula pedidos travados (SKIP LOCKED) para nunca bloquear; a liberação feita
    // durante uma compra espera os locks para enxergar o estoque que acabou de voltar.
    const lockClause = opts.waitForLocks ? 'FOR UPDATE' : 'FOR UPDATE SKIP LOCKED';
    return this.db.tx(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `WITH due AS (
           SELECT id FROM orders
            WHERE status = 'pending_payment'
              AND hold_expires_at < now() - make_interval(secs => $1)
              AND ($2::int IS NULL OR model_id = $2)
            ORDER BY hold_expires_at
            LIMIT $3
            ${lockClause})
         UPDATE orders o
            SET status = 'expired',
                status_reason = 'Pagamento não confirmado dentro do prazo da reserva.',
                updated_at = now()
           FROM due WHERE o.id = due.id
         RETURNING o.id`,
        [this.deps.holdGraceSeconds, opts.modelId ?? null, opts.limit ?? 500],
      );
      if (rows.length === 0) return 0;
      const ids = rows.map((r) => r.id);
      await releaseUnitsOfOrders(tx, ids);
      const { rows: open } = await tx.query<{ id: string }>(
        `SELECT id::text FROM payments WHERE order_id = ANY($1::uuid[]) AND status IN ('pending', 'in_process', 'authorized')`,
        [ids],
      );
      for (const o of open) await enqueue(tx, 'payment.cancel', { paymentId: o.id }, { dedupeKey: `cancel:${o.id}` });
      await tx.query(
        `INSERT INTO audit_log (actor_type, actor_id, action, entity, entity_id)
         SELECT 'system', 'expirer', 'order.expired', 'order', unnest($1::text[])`,
        [ids],
      );
      this.deps.log.info({ count: ids.length }, 'reservas expiradas e unidades devolvidas ao estoque');
      return ids.length;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Ações do painel                                                     */
  /* ------------------------------------------------------------------ */

  /** Crédito não aprovado: devolve o voucher integralmente e a moto volta ao estoque. */
  async refundOrder(orderId: string, actor: Actor, reason: string): Promise<void> {
    await this.db.tx(async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      if (!order) throw Errors.notFound('Pedido');
      if (order.status !== 'paid') {
        throw new AppError('INVALID_STATE', 'Só é possível devolver vouchers pagos e ainda não fechados.', 409);
      }
      await tx.query(
        `UPDATE orders SET status = 'refund_pending', status_reason = $2, updated_at = now() WHERE id = $1`,
        [orderId, reason],
      );
      await releaseOrderUnit(tx, orderId);
      await enqueue(tx, 'payment.refund', { paymentId: String(order.paid_payment_id), orderId }, {
        dedupeKey: `refund:${order.paid_payment_id}`,
      });
      await audit(tx, actor, 'order.refund_requested', 'order', orderId, { reason });
    });
  }

  /** Venda fechada com o consultor (moto faturada/retirada). */
  async completeOrder(orderId: string, actor: Actor): Promise<void> {
    await this.db.tx(async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      if (!order) throw Errors.notFound('Pedido');
      if (order.status !== 'paid') throw new AppError('INVALID_STATE', 'Só vouchers pagos podem ser marcados como fechados.', 409);
      await tx.query(`UPDATE orders SET status = 'completed', updated_at = now() WHERE id = $1`, [orderId]);
      await audit(tx, actor, 'order.completed', 'order', orderId);
    });
  }
}

function splitPayer(order: OrderRow): PayerData {
  const parts = order.customer_name.split(' ');
  return {
    email: order.customer_email,
    firstName: parts[0] ?? order.customer_name,
    lastName: parts.slice(1).join(' ') || parts[0] || '',
    cpf: order.customer_cpf,
  };
}

/** Mensagens amigáveis para os principais motivos de recusa do Mercado Pago. */
/** Recusas de cartão do Mercado Pago: mensagem para o cliente e resumo para o relatório da loja. */
const CARD_REJECTIONS: Record<string, { message: string; short: string }> = {
  cc_rejected_insufficient_amount: { message: 'Cartão sem limite suficiente. Tente outro cartão ou pague com Pix.', short: 'sem limite' },
  cc_rejected_bad_filled_security_code: { message: 'Código de segurança incorreto. Confira e tente de novo.', short: 'código de segurança errado' },
  cc_rejected_bad_filled_date: { message: 'Data de validade incorreta. Confira e tente de novo.', short: 'validade errada' },
  cc_rejected_bad_filled_card_number: { message: 'Algum dado do cartão está incorreto. Confira e tente de novo.', short: 'dado do cartão errado' },
  cc_rejected_bad_filled_other: { message: 'Algum dado do cartão está incorreto. Confira e tente de novo.', short: 'dado do cartão errado' },
  cc_rejected_call_for_authorize: {
    message: 'O banco pediu autorização: ligue para o emissor do cartão e tente de novo.',
    short: 'banco pediu autorização',
  },
  cc_rejected_card_disabled: { message: 'Cartão desabilitado. Ative-o com o banco ou use outro cartão.', short: 'cartão desabilitado' },
  cc_rejected_duplicated_payment: {
    message: 'Pagamento duplicado bloqueado pelo banco. Se a cobrança apareceu, ela já está sendo processada.',
    short: 'pagamento duplicado',
  },
  cc_rejected_high_risk: { message: 'Pagamento recusado por segurança. Pague com Pix ou use outro cartão.', short: 'recusado por segurança' },
};

export function cardRejectionMessage(detail: string | null): string {
  return (detail && CARD_REJECTIONS[detail]?.message) || 'Pagamento não aprovado. Tente outro cartão ou pague com Pix.';
}

export function cardRejectionShort(detail: string | null): string {
  return (detail && CARD_REJECTIONS[detail]?.short) || 'recusado pelo banco';
}
