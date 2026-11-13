import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertInvariants, createHarness, orderInput, seedLive, type Harness } from '../support/harness.js';

/**
 * Cenários de pico de uma live: muitos compradores ao mesmo tempo na mesma moto,
 * webhooks repetidos e fora de ordem, expiração correndo junto com pagamento.
 * Postgres real; latência simulada no dublê do Mercado Pago.
 */
let h: Harness;
let seq = 10_000;

beforeAll(async () => {
  h = await createHarness({ DATABASE_POOL_MAX: '80' });
  h.mp.latencyMs = 15;
});
afterAll(async () => {
  await h.close();
});

async function newModel(slug: string, units: number) {
  return seedLive(h.ctx, { slug, units });
}

function codes<T extends { status: number; body: { error?: { code: string } } }>(results: T[]) {
  const out: Record<string, number> = {};
  for (const r of results) {
    const k = r.status < 300 ? 'OK' : (r.body.error?.code ?? String(r.status));
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

describe('disputa por estoque', () => {
  it('1.000 compradores simultâneos, 5 motos: exatamente 5 reservas, nenhuma moto em dois pedidos', async () => {
    await newModel('disputa-5', 5);
    const t0 = Date.now();
    const results = await Promise.all(
      Array.from({ length: 1000 }, () => h.createOrder(orderInput(++seq, { modelSlug: 'disputa-5' }))),
    );
    const elapsed = Date.now() - t0;
    const tally = codes(results);
    expect(tally.OK).toBe(5);
    expect(tally.ALL_ON_HOLD).toBe(995);
    expect(tally.INTERNAL).toBeUndefined();

    const { rows } = await h.ctx.db.query(
      `SELECT count(DISTINCT u.id)::int AS units, count(o.id)::int AS orders
         FROM orders o JOIN units u ON u.order_id = o.id
        WHERE o.model_id = (SELECT id FROM models WHERE slug = 'disputa-5')`,
    );
    expect(rows[0]).toEqual({ units: 5, orders: 5 });
    await assertInvariants(h.ctx);
    console.info(`[disputa] 1000 requisições simultâneas em ${elapsed} ms → ${JSON.stringify(tally)}`);
  });

  it('o mesmo CPF em 30 abas ao mesmo tempo segura só UMA moto', async () => {
    await newModel('abas', 10);
    const base = orderInput(++seq, { modelSlug: 'abas' });
    const results = await Promise.all(
      Array.from({ length: 30 }, () => h.createOrder({ ...orderInput(++seq, { modelSlug: 'abas' }), customer: base.customer })),
    );
    const tally = codes(results);
    expect(tally.OK).toBe(1);
    expect(tally.PENDING_ELSEWHERE).toBe(29);
    await assertInvariants(h.ctx);
  });

  it('quando todos os Pix pendentes vencem, as motos voltam e novos compradores conseguem comprar', async () => {
    await newModel('volta', 3);
    const first = await Promise.all(Array.from({ length: 50 }, () => h.createOrder(orderInput(++seq, { modelSlug: 'volta' }))));
    expect(codes(first).OK).toBe(3);
    await h.ctx.db.query(`UPDATE orders SET hold_expires_at = now() - interval '1 second' WHERE model_id = (SELECT id FROM models WHERE slug = 'volta')`);
    // Sem esperar o worker: a própria tentativa de compra libera reservas vencidas antes de dizer "esgotado".
    const second = await Promise.all(Array.from({ length: 50 }, () => h.createOrder(orderInput(++seq, { modelSlug: 'volta' }))));
    expect(codes(second).OK).toBe(3);
    await assertInvariants(h.ctx);
  });
});

describe('pagamentos simultâneos', () => {
  it('300 compradores, 40 motos, webhooks triplicados, expiração e pagamentos tardios ao mesmo tempo', async () => {
    const modelId = await newModel('tempestade', 40);
    const created = await Promise.all(
      Array.from({ length: 300 }, () => h.createOrder(orderInput(++seq, { modelSlug: 'tempestade' }))),
    );
    const ok = created.filter((r) => r.status < 300).map((r) => r.body.order);
    expect(ok).toHaveLength(40);

    // 25% dos pedidos expiram (cliente desistiu), mas metade desses paga o Pix no último segundo.
    const expiring = ok.slice(0, 10);
    await h.ctx.db.query(`UPDATE orders SET hold_expires_at = now() - interval '1 second' WHERE code = ANY($1)`, [
      expiring.map((o) => o.code),
    ]);
    const payers = [...ok.slice(5, 40)]; // 35 pagam (5 deles depois de expirar)
    for (const o of payers) h.mp.approve(Number(o.payment!.id));

    // Tudo ao mesmo tempo: expiração + 3 entregas do webhook de cada pagamento + novos compradores.
    const newcomers = Array.from({ length: 100 }, () => h.createOrder(orderInput(++seq, { modelSlug: 'tempestade' })));
    const hooks = payers.flatMap((o) => [h.webhook(Number(o.payment!.id)), h.webhook(Number(o.payment!.id)), h.webhook(Number(o.payment!.id))]);
    const [hookCodes, , late] = await Promise.all([Promise.all(hooks), h.ctx.orders.expireOverdue(), Promise.all(newcomers)]);
    expect(hookCodes.every((c) => c === 200)).toBe(true);
    await h.worker.drain();
    await h.worker.drain();
    await assertInvariants(h.ctx);

    const { rows } = await h.ctx.db.query<{ status: string; c: number }>(
      `SELECT status, count(*)::int AS c FROM orders WHERE model_id = $1 GROUP BY status`,
      [modelId],
    );
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.c]));
    const units = await h.ctx.db.query<{ status: string; c: number }>(
      `SELECT status, count(*)::int AS c FROM units WHERE model_id = $1 GROUP BY status`,
      [modelId],
    );
    const unitsBy = Object.fromEntries(units.rows.map((r) => [r.status, r.c]));

    // Estoque fecha: vendidas = pedidos pagos; seguradas = pedidos pendentes; nada some nem duplica.
    expect(unitsBy.sold ?? 0).toBe(byStatus.paid ?? 0);
    expect(unitsBy.held ?? 0).toBe(byStatus.pending_payment ?? 0);
    expect((unitsBy.sold ?? 0) + (unitsBy.held ?? 0) + (unitsBy.available ?? 0)).toBe(40);
    // Todo pagamento aprovado virou venda ou foi estornado — ninguém paga sem levar.
    const paidIds = new Set(
      (await h.ctx.db.query<{ id: string }>(`SELECT paid_payment_id::text AS id FROM orders WHERE status = 'paid' AND model_id = $1`, [modelId])).rows.map((r) => r.id),
    );
    for (const o of payers) {
      const p = h.mp.payments.get(Number(o.payment!.id))!;
      expect(paidIds.has(String(p.id)) || p.status === 'refunded').toBe(true);
    }
    // Termômetro bate com as vendas confirmadas.
    const snap = await h.snapshot();
    const totalPaid = await h.ctx.db.query(`SELECT count(*)::int AS c FROM orders WHERE status IN ('paid','completed')`);
    expect(snap.sales.sold - (await h.ctx.db.query(`SELECT offline_sales FROM live_settings`)).rows[0]!.offline_sales).toBe(totalPaid.rows[0]!.c);
    console.info(`[tempestade] pedidos=${JSON.stringify(byStatus)} unidades=${JSON.stringify(unitsBy)} novosOK=${late.filter((r) => r.status < 300).length}`);
  });

  it('corrida exata entre expiração e aprovação em 60 pedidos: cada um termina pago OU devolvido, nunca os dois', async () => {
    const modelId = await newModel('corrida', 60);
    const created = await Promise.all(Array.from({ length: 60 }, () => h.createOrder(orderInput(++seq, { modelSlug: 'corrida' }))));
    const orders = created.map((r) => r.body.order);
    await h.ctx.db.query(`UPDATE orders SET hold_expires_at = now() - interval '1 second' WHERE model_id = $1`, [modelId]);
    for (const o of orders) h.mp.approve(Number(o.payment!.id));
    // Metade das motos vai para outros compradores no meio da corrida.
    await Promise.all([
      ...orders.map((o) => h.webhook(Number(o.payment!.id))),
      h.ctx.orders.expireOverdue(),
      h.ctx.orders.expireOverdue(),
      ...Array.from({ length: 30 }, () => h.createOrder(orderInput(++seq, { modelSlug: 'corrida' }))),
    ]);
    await h.worker.drain();
    await h.worker.drain();
    await assertInvariants(h.ctx);
    const { rows } = await h.ctx.db.query<{ status: string }>(`SELECT status FROM orders WHERE code = ANY($1)`, [orders.map((o) => o.code)]);
    for (const r of rows) expect(['paid', 'refund_pending', 'refunded']).toContain(r.status);
    const refunded = rows.filter((r) => r.status !== 'paid').length;
    const refundedAtMp = orders.filter((o) => h.mp.payments.get(Number(o.payment!.id))!.status === 'refunded').length;
    expect(refundedAtMp).toBe(refunded);
  });

  it('webhook chegando fora de ordem (aprovado antes de pendente) não desfaz a venda', async () => {
    await newModel('ordem', 1);
    const { body } = await h.createOrder(orderInput(++seq, { modelSlug: 'ordem' }));
    const pid = Number(body.order.payment!.id);
    const pendingSnapshot = await h.ctx.gateway!.get(String(pid));
    h.mp.approve(pid);
    await h.webhook(pid);
    // Leitura antiga (pendente) aplicada depois: deve ser descartada.
    expect(await h.ctx.orders.applyGatewayPayment(pendingSnapshot, { type: 'webhook' })).toBe('stale');
    const { rows } = await h.ctx.db.query(`SELECT status FROM orders WHERE code = $1`, [body.order.code]);
    expect(rows[0]!.status).toBe('paid');
  });
});

describe('resiliência do provedor de pagamento', () => {
  it('Mercado Pago fora do ar: pedido fica reservado e o cliente pode tentar de novo sem segurar outra moto', async () => {
    await newModel('instavel', 2);
    h.mp.failNextCreates = 3; // 3 tentativas internas falham
    const input = orderInput(++seq, { modelSlug: 'instavel' });
    const first = await h.createOrder(input);
    expect(first.body.paymentError?.code).toBe('PAYMENT_PROVIDER_ERROR');
    expect(first.body.order.status).toBe('pending_payment');
    const retry = await h.app.inject({
      method: 'POST',
      url: `/api/orders/${first.body.order.code}/payments`,
      headers: { 'x-order-token': input.clientToken },
      payload: { method: 'pix' },
    });
    expect(retry.json().order.payment.pix.qrCode).toBeTruthy();
    const { rows } = await h.ctx.db.query(`SELECT count(*)::int AS c FROM units WHERE status = 'held' AND model_id = (SELECT id FROM models WHERE slug = 'instavel')`);
    expect(rows[0]!.c).toBe(1);
  });

  it('resposta do MP perdida no meio do caminho: a nova tentativa usa a mesma chave e NÃO cria cobrança duplicada', async () => {
    await newModel('perdida', 2);
    h.mp.dropNextCreateResponses = 1;
    const input = orderInput(++seq, { modelSlug: 'perdida' });
    const res = await h.createOrder(input);
    expect(res.body.order.payment?.pix?.qrCode).toBeTruthy();
    const orderId = (await h.ctx.db.query(`SELECT id FROM orders WHERE code = $1`, [res.body.order.code])).rows[0]!.id;
    expect(h.mp.forOrder(orderId)).toHaveLength(1);
  });
});
