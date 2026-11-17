import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/modules/auth/sessions.js';
import { ADMIN_PASSWORD, assertInvariants, createHarness, orderInput, seedLive, type Harness } from './support/harness.js';
import { unzip as unzipRaw } from '../src/lib/zip.js';

const unzip = (b: Buffer) => new Map([...unzipRaw(b)].map(([k, v]) => [k, v.toString('utf8')]));

let h: Harness;
let modelId: number;

beforeAll(async () => {
  h = await createHarness();
  modelId = await seedLive(h.ctx, { units: 3 });
});
afterAll(async () => {
  await assertInvariants(h.ctx);
  await h.close();
});

async function login(password = ADMIN_PASSWORD) {
  return h.app.inject({ method: 'POST', url: '/api/admin/login', payload: { password } });
}

async function newSession(): Promise<string> {
  const res = await login();
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'lle_session')!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe('Strict');
  return `lle_session=${cookie.value}`;
}

// Uma sessão reaproveitada pelo arquivo: o login aceita só 5 tentativas por minuto por IP.
let cached: string | null = null;
async function admin(): Promise<{ cookie: string }> {
  cached ??= await newSession();
  return { cookie: cached };
}

const dashboard = (cookie: string) => h.app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: { cookie } });

describe('acesso ao painel (senha única)', () => {
  it('rejeita senha errada', async () => {
    const r = await login('senha-errada-123');
    expect(r.statusCode).toBe(401);
    expect(r.cookies.find((c) => c.name === 'lle_session')).toBeUndefined();
  });

  it('rotas internas exigem sessão', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/admin/dashboard' })).statusCode).toBe(401);
    const release = await h.app.inject({ method: 'POST', url: `/api/admin/models/${modelId}/release`, payload: { released: true } });
    expect(release.statusCode).toBe(401);
  });

  it('logout invalida a sessão no servidor', async () => {
    const cookie = await newSession();
    expect((await dashboard(cookie)).statusCode).toBe(200);
    await h.app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie } });
    expect((await dashboard(cookie)).statusCode).toBe(401);
  });
});

describe('liberação das motos durante a live', () => {
  it('liberar e bloquear refletem na loja na hora; reserva já em pagamento continua valendo', async () => {
    const { cookie } = await admin();
    const release = (released: boolean) =>
      h.app.inject({ method: 'POST', url: `/api/admin/models/${modelId}/release`, headers: { cookie }, payload: { released } });

    expect((await release(false)).statusCode).toBe(200);
    let model = (await h.snapshot()).models.find((m) => m.id === modelId)!;
    expect(model.released).toBe(false);
    expect(model.priceLiveCents).toBeNull();
    expect((await h.createOrder(orderInput(700))).body.error?.code).toBe('NOT_RELEASED');

    expect((await release(true)).statusCode).toBe(200);
    model = (await h.snapshot()).models.find((m) => m.id === modelId)!;
    expect(model.released).toBe(true);
    expect(model.priceLiveCents).toBeGreaterThan(0);

    // Cliente começa a pagar; a moto é bloqueada logo depois (o apresentador passou para a próxima).
    const pending = await h.createOrder(orderInput(701));
    expect(pending.body.order.status).toBe('pending_payment');
    expect((await release(false)).statusCode).toBe(200);
    const paymentId = Number(pending.body.order.payment!.id);
    h.mp.approve(paymentId);
    expect(await h.webhook(paymentId)).toBe(200);
    const { rows } = await h.ctx.db.query(`SELECT status FROM orders WHERE code = $1`, [pending.body.order.code]);
    expect(rows[0]!.status).toBe('paid');

    expect((await release(true)).statusCode).toBe(200);
  });

  it('venda de balcão sobe o termômetro na hora e o contador nunca fica negativo', async () => {
    const { cookie } = await admin();
    const before = (await h.snapshot()).sales.sold;
    const r = await h.app.inject({ method: 'POST', url: '/api/admin/live/offline-sales', headers: { cookie }, payload: { delta: 1 } });
    expect(r.statusCode).toBe(200);
    expect((await h.snapshot()).sales.sold).toBe(before + 1);

    await h.ctx.db.query(`UPDATE live_settings SET offline_sales = 0`);
    const neg = await h.app.inject({ method: 'POST', url: '/api/admin/live/offline-sales', headers: { cookie }, payload: { delta: -1 } });
    expect(neg.statusCode).toBe(409);
  });
});

describe('estoque', () => {
  it('adiciona unidades e só retira unidade livre (nunca segurada ou vendida)', async () => {
    const { cookie } = await admin();
    const add = await h.app.inject({ method: 'POST', url: `/api/admin/models/${modelId}/units`, headers: { cookie }, payload: { quantity: 2, color: 'Preta' } });
    expect(add.json()).toEqual({ added: 2 });

    // Segura todas as unidades livres com pedidos em pagamento.
    const { rows } = await h.ctx.db.query<{ c: number }>(`SELECT count(*)::int AS c FROM units WHERE status = 'available'`);
    for (let i = 0; i < rows[0]!.c; i++) await h.createOrder(orderInput(500 + i));
    const remove = await h.app.inject({ method: 'POST', url: `/api/admin/models/${modelId}/units/remove`, headers: { cookie }, payload: {} });
    expect(remove.statusCode).toBe(409);
    expect(remove.json().error.code).toBe('NO_FREE_UNIT');
  });

  it('chassi é único', async () => {
    const { cookie } = await admin();
    const a = await h.app.inject({ method: 'POST', url: `/api/admin/models/${modelId}/units`, headers: { cookie }, payload: { chassis: '9C6RG3150R0012345' } });
    expect(a.statusCode).toBe(200);
    const b = await h.app.inject({ method: 'POST', url: `/api/admin/models/${modelId}/units`, headers: { cookie }, payload: { chassis: '9C6RG3150R0012345' } });
    expect(b.statusCode).toBe(422);
  });
});

describe('devolução do voucher (crédito não aprovado)', () => {
  it('estorna no Mercado Pago, devolve a moto e tira a venda do termômetro', async () => {
    const { cookie } = await admin();
    const input = orderInput(900, {
      payment: { method: 'card', token: 'APRO-refund', paymentMethodId: 'master', installments: 1, attemptKey: 'attempt-refund-000000001' },
    });
    const created = await h.createOrder(input);
    expect(created.body.order.status).toBe('paid');
    await h.worker.drain();
    await h.ctx.db.query(`UPDATE jobs SET run_at = now() WHERE status = 'queued'`);
    await h.worker.drain();
    const soldBefore = (await h.snapshot()).sales.sold;

    const { rows } = await h.ctx.db.query<{ id: string; unit_id: number }>(`SELECT id, unit_id FROM orders WHERE code = $1`, [created.body.order.code]);
    const order = rows[0]!;
    const r = await h.app.inject({
      method: 'POST',
      url: `/api/admin/orders/${order.id}/refund`,
      headers: { cookie },
      payload: { reason: 'Crédito não aprovado pelo banco' },
    });
    expect(r.statusCode).toBe(200);
    const unit = await h.ctx.db.query(`SELECT status FROM units WHERE id = $1`, [order.unit_id]);
    expect(unit.rows[0]!.status).toBe('available');

    await h.worker.drain(); // estorno no MP → sync → refunded
    const view = await h.app.inject({ method: 'GET', url: `/api/orders/${created.body.order.code}`, headers: { 'x-order-token': input.clientToken } });
    expect(view.json().status).toBe('refunded');
    expect((await h.snapshot()).sales.sold).toBe(soldBefore - 1);

    // Repetir a devolução não estorna duas vezes.
    const again = await h.app.inject({ method: 'POST', url: `/api/admin/orders/${order.id}/refund`, headers: { cookie }, payload: { reason: 'Crédito não aprovado pelo banco' } });
    expect(again.statusCode).toBe(409);
    expect(h.mp.calls.refund).toBe(1);
  });
});

describe('tarefas com falha', () => {
  it('estorno recusado pelo Mercado Pago aparece no painel e volta para a fila com um clique, sem SQL', async () => {
    const { cookie } = await admin();
    const created = await h.createOrder(
      orderInput(950, {
        payment: { method: 'card', token: 'APRO-jobs', paymentMethodId: 'master', installments: 1, attemptKey: 'attempt-jobs-0000000001' },
      }),
    );
    expect(created.body.order.status).toBe('paid');
    const { rows: ord } = await h.ctx.db.query<{ id: string }>(`SELECT id FROM orders WHERE code = $1`, [created.body.order.code]);
    const refund = await h.app.inject({
      method: 'POST',
      url: `/api/admin/orders/${ord[0]!.id}/refund`,
      headers: { cookie },
      payload: { reason: 'Cliente desistiu dentro de 7 dias' },
    });
    expect(refund.statusCode).toBe(200);
    // O estorno esgotou as tentativas (ex.: conta do Mercado Pago sem saldo por horas).
    const failed = await h.ctx.db.query<{ id: number }>(
      `UPDATE jobs SET status = 'failed', attempts = max_attempts, last_error = 'saldo insuficiente para estorno'
        WHERE type = 'payment.refund' AND payload->>'orderId' = $1 RETURNING id`,
      [ord[0]!.id],
    );
    const jobId = failed.rows[0]!.id;

    const listed = (await dashboard(cookie)).json().failedJobs;
    expect(listed).toContainEqual(
      expect.objectContaining({ id: jobId, type: 'payment.refund', orderCode: created.body.order.code, lastError: 'saldo insuficiente para estorno' }),
    );

    const retry = () => h.app.inject({ method: 'POST', url: `/api/admin/jobs/${jobId}/retry`, headers: { cookie }, payload: {} });
    expect((await retry()).statusCode).toBe(200);
    expect((await retry()).statusCode).toBe(409);

    await h.worker.drain();
    const { rows } = await h.ctx.db.query(`SELECT status FROM jobs WHERE id = $1`, [jobId]);
    expect(rows[0]!.status).toBe('done');
    const { rows: after } = await h.ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [ord[0]!.id]);
    expect(after[0]!.status).toBe('refunded');
    expect((await dashboard(cookie)).json().failedJobs.map((j: { id: number }) => j.id)).not.toContain(jobId);
  });
});

describe('relatório pós-live', () => {
  const sheets = (body: Buffer) => {
    const files = unzip(body);
    const names = [...files.get('xl/workbook.xml')!.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]!);
    return Object.fromEntries(names.map((n, i) => [n, files.get(`xl/worksheets/sheet${i + 1}.xml`)!]));
  };

  it('planilha liga cada venda ao código único e à transação do MP, e lista quem quase comprou', async () => {
    const { cookie } = await admin();
    // As reservas penduradas do teste de estoque vencem: viram "quase compraram".
    await h.ctx.db.query(`UPDATE orders SET hold_expires_at = now() - interval '1 hour' WHERE status = 'pending_payment'`);
    await h.ctx.orders.expireOverdue();
    // Um deles volta e compra: precisa sair da lista de "quase compraram".
    const comeback = await h.createOrder(
      orderInput(500, {
        payment: { method: 'card', token: 'APRO-volta', paymentMethodId: 'visa', installments: 1, attemptKey: 'attempt-volta-000000001' },
      }),
    );
    expect(comeback.body.order.status).toBe('paid');

    const r = await h.app.inject({ method: 'GET', url: '/api/admin/reports/live.xlsx', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    expect(r.headers['content-disposition']).toMatch(/relatorio-live-\d{4}-\d{2}-\d{2}-todas-as-lojas\.xlsx/);
    const s = sheets(r.rawPayload);
    expect(Object.keys(s)).toEqual(['Resumo', 'Vendas', 'Devolvidos', 'Quase compraram', 'Por moto', 'Lista de espera']);
    expect(s['Vendas']).toContain(comeback.body.order.code);
    expect(s['Vendas']).toContain(comeback.body.order.payment!.id);
    expect(s['Devolvidos']).toContain('Crédito não aprovado pelo banco');
    expect(s['Quase compraram']).toContain('Cliente Teste 501');
    expect(s['Quase compraram']).toContain('Gerou o Pix e não pagou a tempo');
    expect(s['Quase compraram']).not.toContain('Cliente Teste 500<');

    // Por loja: só as vendas daquela loja e sem a lista de espera (que é por moto).
    const other = await h.app.inject({ method: 'GET', url: '/api/admin/reports/live.xlsx?store=2', headers: { cookie } });
    const so = sheets(other.rawPayload);
    expect(Object.keys(so)).not.toContain('Lista de espera');
    expect(so['Vendas']).not.toContain('LLE-');
    expect((await h.app.inject({ method: 'GET', url: '/api/admin/reports/live.xlsx?store=999', headers: { cookie } })).statusCode).toBe(404);
  });

  it('PDF com um comprovante por venda válida', async () => {
    const { cookie } = await admin();
    const r = await h.app.inject({ method: 'GET', url: '/api/admin/reports/receipts.pdf', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = (r.rawPayload.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;
    const { rows } = await h.ctx.db.query(`SELECT count(*)::int AS c FROM orders WHERE status IN ('paid', 'completed')`);
    expect(pages).toBe(rows[0]!.c);
  });
});

describe('painel', () => {
  it('dashboard traz KPIs coerentes com o banco', async () => {
    const { cookie } = await admin();
    const r = await dashboard(cookie);
    expect(r.statusCode).toBe(200);
    const d = r.json();
    const { rows } = await h.ctx.db.query(`SELECT count(*)::int AS c FROM orders WHERE status = 'pending_payment'`);
    expect(d.kpis.pixInProgress).toBe(rows[0]!.c);
    expect(d.models[0].stock.held).toBe(rows[0]!.c);
  });

  it('status da live acompanha o link: sem link fica "Em breve", link novo coloca "Ao vivo", "Encerrada" é só por clique', async () => {
    const { cookie } = await admin();
    const patch = (payload: Record<string, unknown>) => h.app.inject({ method: 'PATCH', url: '/api/admin/live', headers: { cookie }, payload });
    const status = async () => (await h.ctx.db.query<{ status: string }>(`SELECT status FROM live_settings`)).rows[0]!.status;
    const before = (await h.ctx.db.query(`SELECT status, youtube_url FROM live_settings`)).rows[0]!;

    await h.ctx.db.query(`UPDATE live_settings SET status = 'em_breve', youtube_url = NULL`);
    // Sem link não dá para colocar "Ao vivo".
    const noLink = await patch({ status: 'ao_vivo' });
    expect(noLink.statusCode).toBe(422);
    expect(await status()).toBe('em_breve');

    // Salvar o link (com os outros campos do formulário) coloca a live no ar sozinha.
    const linked = await patch({ youtubeUrl: 'youtube.com/live/oiX0yOjXZco?feature=share', viewers: 10 });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().status).toBe('ao_vivo');

    // Salvar de novo o mesmo link não mexe no status escolhido à mão.
    expect((await patch({ status: 'em_breve' })).json().status).toBe('em_breve');
    expect((await patch({ youtubeUrl: 'youtube.com/live/oiX0yOjXZco?feature=share', viewers: 20 })).json().status).toBe('em_breve');
    expect((await patch({ status: 'ao_vivo' })).json().status).toBe('ao_vivo');

    // Encerrar é por clique e não volta sozinho ao salvar o formulário; o prazo das condições vai para a loja.
    const ended = await patch({ status: 'encerrada', offersUntil: '2026-11-19T10:00:00-03:00' });
    expect(ended.json().status).toBe('encerrada');
    expect(ended.json().offersUntil).toBe('2026-11-19T13:00:00.000Z');
    expect((await patch({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' })).json().status).toBe('encerrada');

    // Tirar o link com a live no ar volta para "Em breve".
    await patch({ status: 'ao_vivo' });
    expect((await patch({ youtubeUrl: null })).json().status).toBe('em_breve');

    await h.ctx.db.query(`UPDATE live_settings SET status = $1, youtube_url = $2, offers_until = NULL`, [before.status, before.youtube_url]);
  });

  it('cada loja tem nome e WhatsApp próprios, editados pelo painel', async () => {
    const { cookie } = await admin();
    const ok = await h.app.inject({
      method: 'PATCH',
      url: '/api/admin/stores/3',
      headers: { cookie },
      payload: { name: 'Sul da Ilha', whatsapp: '(48) 98888-7777' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().find((s: { id: number }) => s.id === 3)).toMatchObject({ name: 'Sul da Ilha', whatsapp: '5548988887777' });
    expect((await dashboard(cookie)).json().stores).toHaveLength(3);

    const bad = await h.app.inject({ method: 'PATCH', url: '/api/admin/stores/3', headers: { cookie }, payload: { name: 'Sul da Ilha', whatsapp: '123' } });
    expect(bad.statusCode).toBe(422);
    expect((await h.app.inject({ method: 'PATCH', url: '/api/admin/stores/99', headers: { cookie }, payload: { name: 'Outra' } })).statusCode).toBe(404);
  });

  it('lojas podem ser adicionadas e removidas pelo painel; telefone fixo também vale como contato', async () => {
    const { cookie } = await admin();
    const post = (payload: Record<string, unknown>) => h.app.inject({ method: 'POST', url: '/api/admin/stores', headers: { cookie }, payload });
    const del = (id: number) => h.app.inject({ method: 'DELETE', url: `/api/admin/stores/${id}`, headers: { cookie } });

    const created = await post({ name: 'Balneário Camboriú', whatsapp: '(47) 3333-4444' }); // número fictício, fixo
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;
    const names = (created.json().stores as { name: string }[]).map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'pt-BR'))); // ordem alfabética
    expect(created.json().stores.find((s: { id: number }) => s.id === id)).toMatchObject({ name: 'Balneário Camboriú', whatsapp: '554733334444' });
    expect((await h.snapshot()).stores.map((s) => s.id)).toContain(id);
    expect((await post({ name: 'balneario camboriu' })).statusCode).toBe(422); // mesmo nome

    // Remover tira do checkout (a loja não é apagada) e a compra nela passa a ser recusada.
    const removed = await del(id);
    expect(removed.statusCode).toBe(200);
    expect(removed.json().map((s: { id: number }) => s.id)).not.toContain(id);
    expect((await h.snapshot()).stores.map((s) => s.id)).not.toContain(id);
    expect((await h.createOrder(orderInput(900, { storeId: id }))).status).toBe(422);
    expect((await del(id)).statusCode).toBe(404);

    // Adicionar de novo com o mesmo nome reaproveita a loja removida.
    const back = await post({ name: 'Balneário Camboriú', whatsapp: null });
    expect(back.json().id).toBe(id);
    await del(id);
  });

  it('páginas abertas pelo endereço *.fly.dev vão para o endereço oficial; a API continua respondendo', async () => {
    const flyHost = { host: 'live-yamaha-geracao.fly.dev' };
    const page = await h.app.inject({ method: 'GET', url: '/painel?x=1', headers: flyHost });
    expect(page.statusCode).toBe(302);
    expect(page.headers.location).toBe('https://live.exemplo.test/painel?x=1');

    const api = await h.app.inject({ method: 'GET', url: '/api/live/snapshot', headers: flyHost });
    expect(api.statusCode).toBe(200);

    const official = await h.app.inject({ method: 'GET', url: '/painel', headers: { host: 'live.exemplo.test' } });
    expect(official.statusCode).not.toBe(302);
  });
});

// Por último: estes testes encerram todas as sessões e gastam o limite de tentativas de login.
describe('senha do painel', () => {
  it('trocar ADMIN_PASSWORD encerra as sessões abertas com a senha antiga', async () => {
    expect(await h.ctx.auth.revokeSessionsIfPasswordChanged()).toBe(true); // primeira subida grava a senha vigente
    const cookie = await newSession();
    expect(await h.ctx.auth.revokeSessionsIfPasswordChanged()).toBe(false); // mesma senha: ninguém é desconectado
    expect((await dashboard(cookie)).statusCode).toBe(200);

    const afterChange = new AuthService(h.ctx.db, 'OutraSenhaForte2027', 12);
    expect(await afterChange.revokeSessionsIfPasswordChanged()).toBe(true);
    expect((await dashboard(cookie)).statusCode).toBe(401);
    expect((await afterChange.login('OutraSenhaForte2027', { ip: null, userAgent: null })).length).toBeGreaterThan(20);
    cached = null;
  });

  it('limita tentativas de login por IP (sem bloquear a conta)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await login('chute-errado-0' + i)).statusCode);
    expect(statuses).not.toContain(200);
    expect(statuses.at(-1)).toBe(429);
  });
});
