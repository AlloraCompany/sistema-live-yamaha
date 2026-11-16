import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertInvariants, createHarness, orderInput, seedLive, type Harness } from './support/harness.js';

/**
 * Fluxos críticos de ponta a ponta pela API HTTP, com Postgres real e dublê HTTP
 * do Mercado Pago.
 */
let h: Harness;
let n = 0;
const next = () => ++n;

beforeAll(async () => {
  h = await createHarness();
  await seedLive(h.ctx, { units: 25 });
});
afterAll(async () => {
  await assertInvariants(h.ctx);
  await h.close();
});

async function unitStatuses() {
  const { rows } = await h.ctx.db.query<{ status: string; c: number }>(
    `SELECT status, count(*)::int AS c FROM units GROUP BY status`,
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.c]));
}

async function orderToken(token: string, code: string, path = '') {
  return h.app.inject({ method: 'GET', url: `/api/orders/${code}${path}`, headers: { 'x-order-token': token } });
}

describe('compra com Pix', () => {
  it('reserva a unidade, gera o Pix, confirma pelo webhook, baixa o estoque e libera o comprovante', async () => {
    const before = await h.snapshot();
    const input = orderInput(next());
    const { status, body } = await h.createOrder(input);
    expect(status).toBe(201);
    expect(body.paymentError).toBeNull();
    expect(body.order.status).toBe('pending_payment');
    expect(body.order.payment?.pix?.qrCode).toMatch(/^0002/);
    expect(body.order.customer.cpfMasked).toMatch(/^\*\*\*\./);

    // Unidade segurada sai do disponível imediatamente para todos.
    const during = await h.snapshot();
    expect(during.models[0]!.available).toBe(before.models[0]!.available - 1);
    expect(during.models[0]!.onHold).toBe(before.models[0]!.onHold + 1);

    // Cliente paga no app do banco → Mercado Pago notifica.
    const paymentId = Number(body.order.payment!.id);
    h.mp.approve(paymentId);
    expect(await h.webhook(paymentId)).toBe(200);

    const view = (await orderToken(input.clientToken, body.order.code)).json();
    expect(view.status).toBe('paid');
    expect(view.paidWith).toBe('pix');
    expect(view.consultant?.name).toBeTruthy();

    const after = await h.snapshot();
    expect(after.sales.sold).toBe(before.sales.sold + 1);
    expect(after.models[0]!.onHold).toBe(before.models[0]!.onHold);

    // Comprovante: código único do voucher + número da transação no Mercado Pago.
    const receipt = await orderToken(input.clientToken, body.order.code, '/receipt.pdf');
    expect(receipt.statusCode).toBe(200);
    expect(receipt.headers['content-type']).toBe('application/pdf');
    expect(receipt.headers['content-disposition']).toContain(body.order.code);
    expect(view.payment.id).toBe(String(paymentId));
  });

  it('repetir o pedido com o mesmo token (duplo clique / rede) devolve o mesmo pedido e o mesmo Pix', async () => {
    const input = orderInput(next());
    const [a, b] = await Promise.all([h.createOrder(input), h.createOrder(input)]);
    expect(a.body.order.code).toBe(b.body.order.code);
    expect(a.body.order.payment!.id).toBe(b.body.order.payment!.id);
    const { rows } = await h.ctx.db.query(`SELECT count(*)::int AS c FROM orders WHERE customer_cpf = $1`, [input.customer.cpf]);
    expect(rows[0]!.c).toBe(1);
  });

  it('o mesmo CPF não segura duas unidades do mesmo modelo ao mesmo tempo', async () => {
    const first = orderInput(next());
    await h.createOrder(first);
    const second = { ...orderInput(n), customer: first.customer };
    const res = await h.createOrder(second);
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('PENDING_ELSEWHERE');
  });

  it('o pedido exige o token: sem ele, não vaza dados', async () => {
    const input = orderInput(next());
    const { body } = await h.createOrder(input);
    expect((await orderToken('x'.repeat(43), body.order.code)).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: `/api/orders/${body.order.code}` })).statusCode).toBe(404);
  });
});

describe('webhooks', () => {
  it('rejeita assinatura inválida', async () => {
    const hook = h.mp.webhook(123, 'segredo-errado');
    const res = await h.app.inject(hook);
    expect(res.statusCode).toBe(401);
  });

  it('20 reenvios simultâneos do mesmo webhook geram UMA venda e +1 no termômetro', async () => {
    const before = await h.snapshot();
    const input = orderInput(next());
    const { body } = await h.createOrder(input);
    const pid = Number(body.order.payment!.id);
    h.mp.approve(pid);
    const codes = await Promise.all(Array.from({ length: 20 }, () => h.webhook(pid)));
    expect(codes.every((c) => c === 200)).toBe(true);
    const after = await h.snapshot();
    expect(after.sales.sold).toBe(before.sales.sold + 1);
    const { rows } = await h.ctx.db.query(
      `SELECT count(*)::int AS c FROM audit_log WHERE action = 'order.paid' AND entity_id = (SELECT id::text FROM orders WHERE code = $1)`,
      [body.order.code],
    );
    expect(rows[0]!.c).toBe(1);
  });

  it('notificação de pagamento inexistente é confirmada (200) para o MP não reenviar para sempre', async () => {
    expect(await h.webhook(999_999_999)).toBe(200);
  });
});

describe('cartão de crédito', () => {
  it('aprovado na hora: pedido pago sem esperar webhook', async () => {
    const input = orderInput(next(), {
      payment: { method: 'card', token: 'APRO-token-123', paymentMethodId: 'master', installments: 1, attemptKey: 'attempt-0000000000000001' },
    });
    const { status, body } = await h.createOrder(input);
    expect(status).toBe(201);
    expect(body.order.status).toBe('paid');
    expect(body.order.paidWith).toBe('card');
  });

  it('recusado: libera a moto na hora e explica o motivo', async () => {
    const before = await unitStatuses();
    const input = orderInput(next(), {
      payment: { method: 'card', token: 'FUND-token-123', paymentMethodId: 'visa', installments: 1, attemptKey: 'attempt-0000000000000002' },
    });
    const { body } = await h.createOrder(input);
    expect(body.order.status).toBe('failed');
    expect(body.paymentError?.code).toBe('CARD_REJECTED');
    expect(body.paymentError?.message).toMatch(/limite/);
    expect(await unitStatuses()).toEqual(before);
  });

  it('trocar de Pix para cartão cancela o Pix antes de cobrar o cartão', async () => {
    const input = orderInput(next());
    const { body } = await h.createOrder(input);
    const pixId = Number(body.order.payment!.id);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/orders/${body.order.code}/payments`,
      headers: { 'x-order-token': input.clientToken },
      payload: { method: 'card', token: 'APRO-switch', paymentMethodId: 'master', installments: 1, attemptKey: 'attempt-switch-000000001' },
    });
    expect(res.json().order.status).toBe('paid');
    expect(h.mp.payments.get(pixId)!.status).toBe('cancelled');
  });

  it('se o Pix antigo for pago depois do cartão, o valor duplicado é estornado automaticamente', async () => {
    const input = orderInput(next());
    const { body } = await h.createOrder(input);
    const pixId = Number(body.order.payment!.id);
    await h.app.inject({
      method: 'POST',
      url: `/api/orders/${body.order.code}/payments`,
      headers: { 'x-order-token': input.clientToken },
      payload: { method: 'card', token: 'APRO-dup', paymentMethodId: 'master', installments: 1, attemptKey: 'attempt-dup-0000000000001' },
    });
    // Corrida: o cliente pagou o Pix no banco antes do cancelamento chegar.
    h.mp.setStatus(pixId, 'approved', 'accredited');
    expect(await h.webhook(pixId)).toBe(200);
    await h.worker.drain();
    expect(h.mp.payments.get(pixId)!.status).toBe('refunded');
    const view = (await orderToken(input.clientToken, body.order.code)).json();
    expect(view.status).toBe('paid'); // segue pago pelo cartão
  });
});

describe('expiração da reserva', () => {
  it('reserva vencida devolve a moto ao estoque e cancela o Pix', async () => {
    const input = orderInput(next());
    const { body } = await h.createOrder(input);
    const pid = Number(body.order.payment!.id);
    await h.ctx.db.query(`UPDATE orders SET hold_expires_at = now() - interval '1 minute' WHERE code = $1`, [body.order.code]);
    const before = await unitStatuses();
    expect(await h.ctx.orders.expireOverdue()).toBeGreaterThanOrEqual(1);
    const after = await unitStatuses();
    expect(after.available).toBe((before.available ?? 0) + 1);
    await h.worker.drain();
    expect(h.mp.payments.get(pid)!.status).toBe('cancelled');
    expect((await orderToken(input.clientToken, body.order.code)).json().status).toBe('expired');
  });

  it('Pix pago logo após expirar: se ainda há moto livre, a venda é garantida', async () => {
    const input = orderInput(next());
    const { body } = await h.createOrder(input);
    const pid = Number(body.order.payment!.id);
    await h.ctx.db.query(`UPDATE orders SET hold_expires_at = now() - interval '1 minute' WHERE code = $1`, [body.order.code]);
    await h.ctx.orders.expireOverdue();
    h.mp.approve(pid); // pagou antes de o cancelamento ser processado
    expect(await h.webhook(pid)).toBe(200);
    const view = (await orderToken(input.clientToken, body.order.code)).json();
    expect(view.status).toBe('paid');
    expect(view.statusReason).toMatch(/após o fim da reserva/);
  });
});

describe('regras de liberação', () => {
  it('não vende moto bloqueada nem com a live fora do ar', async () => {
    await seedLive(h.ctx, { slug: 'nmax-160-abs', released: false, units: 2 });
    const locked = await h.createOrder(orderInput(next(), { modelSlug: 'nmax-160-abs' }));
    expect(locked.body.error?.code).toBe('NOT_RELEASED');
    const snap = await h.snapshot();
    const nmax = snap.models.find((m) => m.slug === 'nmax-160-abs')!;
    expect(nmax.priceLiveCents).toBeNull(); // preço de live só aparece no anúncio

    await h.ctx.db.query(`UPDATE live_settings SET status = 'encerrada'`);
    const closed = await h.createOrder(orderInput(next()));
    expect(closed.body.error?.code).toBe('LIVE_NOT_OPEN');
    await h.ctx.db.query(`UPDATE live_settings SET status = 'ao_vivo'`);
  });

  it('depois de encerrada, vende até o prazo das condições e fecha quando ele passa', async () => {
    // Dentro do prazo: a loja continua vendendo, com o prazo no snapshot para o contador regressivo.
    await h.ctx.db.query(`UPDATE live_settings SET status = 'encerrada', offers_until = now() + interval '2 hours'`);
    const open = await h.snapshot();
    expect(open.live.status).toBe('encerrada');
    expect(open.live.salesOpen).toBe(true);
    expect(new Date(open.live.offersUntil!).getTime()).toBeGreaterThan(Date.now());
    expect(open.models.find((m) => m.slug === 'fazer-fz25-abs')!.purchasable).toBe(true);
    const ok = await h.createOrder(orderInput(next()));
    expect(ok.status).toBe(201);

    // Prazo vencido: fecha na loja e na API.
    await h.ctx.db.query(`UPDATE live_settings SET offers_until = now() - interval '1 minute'`);
    const over = await h.snapshot();
    expect(over.live.salesOpen).toBe(false);
    expect(over.models.find((m) => m.slug === 'fazer-fz25-abs')!.purchasable).toBe(false);
    const late = await h.createOrder(orderInput(next()));
    expect(late.status).toBe(409);
    expect(late.body.error?.code).toBe('LIVE_NOT_OPEN');

    await h.ctx.db.query(`UPDATE live_settings SET status = 'ao_vivo', offers_until = NULL`);
  });

  it('guarda a cor de preferência, reserva uma unidade dessa cor quando há e usa o WhatsApp da loja escolhida', async () => {
    const model = (await h.ctx.db.query<{ id: number }>(`SELECT id FROM models WHERE slug = 'fazer-fz25-abs'`)).rows[0]!.id;
    const blue = (await h.ctx.db.query<{ id: number }>(`INSERT INTO units (model_id, color) VALUES ($1, 'Azul') RETURNING id`, [model])).rows[0]!.id;
    await h.ctx.db.query(`UPDATE stores SET whatsapp = '5548911112222' WHERE id = 2`);

    const res = await h.createOrder({ ...orderInput(next()), storeId: 2, color: 'azul' });
    expect(res.status).toBe(201);
    expect(res.body.order.preferredColor).toBe('Azul'); // grafia do cadastro da moto
    expect(res.body.order.storeWhatsapp).toBe('5548911112222');
    const held = await h.ctx.db.query<{ id: number }>(`SELECT u.id FROM units u JOIN orders o ON o.id = u.order_id WHERE o.code = $1`, [res.body.order.code]);
    expect(held.rows[0]!.id).toBe(blue);

    // Sem unidade livre dessa cor, a compra sai mesmo assim (a cor é preferência) com outra unidade.
    const other = await h.createOrder({ ...orderInput(next()), color: 'Azul' });
    expect(other.status).toBe(201);
    expect(other.body.order.preferredColor).toBe('Azul');
    // Loja sem WhatsApp do gerente não divulga telefone nenhum (não há WhatsApp geral nem de consultor).
    expect(other.body.order.storeWhatsapp).toBeNull();

    // Cor que a moto não tem é recusada.
    const bad = await h.createOrder({ ...orderInput(next()), color: 'Roxa' });
    expect(bad.status).toBe(422);
  });

  it('valida CPF, WhatsApp, e-mail, endereço e aceite do termo', async () => {
    const bad = orderInput(next());
    bad.customer.cpf = '123.456.789-00';
    const res = await h.createOrder(bad);
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('VALIDATION');
    const noTerms = { ...orderInput(next()), acceptTerms: false as unknown as true };
    expect((await h.createOrder(noTerms)).status).toBe(422);
  });

  it('esgotado: responde SOLD_OUT quando todas as unidades foram vendidas', async () => {
    const { rows } = await h.ctx.db.query<{ c: number }>(`SELECT count(*)::int AS c FROM units WHERE status = 'available' AND model_id = (SELECT id FROM models WHERE slug = 'fazer-fz25-abs')`);
    for (let i = 0; i < rows[0]!.c; i++) {
      const r = await h.createOrder(
        orderInput(next(), { payment: { method: 'card', token: 'APRO-soldout', paymentMethodId: 'master', installments: 1, attemptKey: `attempt-soldout-${String(i).padStart(8, '0')}` } }),
      );
      expect(r.body.order.status).toBe('paid');
    }
    const pending = await h.ctx.db.query(`SELECT count(*)::int AS c FROM orders WHERE status = 'pending_payment'`);
    const res = await h.createOrder(orderInput(next()));
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe(pending.rows[0]!.c > 0 ? 'ALL_ON_HOLD' : 'SOLD_OUT');
  });
});
