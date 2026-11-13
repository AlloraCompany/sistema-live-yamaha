import http from 'node:http';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';

/**
 * Dublê HTTP da API de pagamentos do Mercado Pago — EXCLUSIVO PARA TESTES.
 * Reproduz o comportamento documentado que importa para a consistência:
 * X-Idempotency-Key obrigatório e respeitado, expiração mínima de 30 min do Pix,
 * cancelamento só de pagamentos abertos, estorno só de aprovados e webhooks assinados (x-signature).
 */
export interface FakePayment {
  id: number;
  status: string;
  status_detail: string;
  external_reference: string;
  transaction_amount: number;
  payment_method_id: string;
  date_created: string;
  date_last_updated: string;
  date_approved: string | null;
  date_of_expiration: string | null;
  point_of_interaction?: { transaction_data: { qr_code: string; qr_code_base64: string; ticket_url: string } };
  idempotencyKey: string;
  body: Record<string, unknown>;
}

export class FakeMercadoPago {
  readonly payments = new Map<number, FakePayment>();
  private byKey = new Map<string, number>();
  private refundKeys = new Set<string>();
  private nextId = 1_000_001;
  private clock = Date.now();
  readonly calls = { create: 0, get: 0, cancel: 0, refund: 0 };
  /** Próximas N criações respondem 500 sem criar nada (instabilidade do MP). */
  failNextCreates = 0;
  /** Próximas N criações criam o pagamento mas a resposta "se perde" (timeout do lado do cliente). */
  dropNextCreateResponses = 0;
  /** Atraso artificial por requisição (latência de rede). */
  latencyMs = 0;
  private server!: http.Server;
  url = '';

  static async start(): Promise<FakeMercadoPago> {
    const fake = new FakeMercadoPago();
    fake.server = http.createServer((req, res) => void fake.handle(req, res));
    fake.server.keepAliveTimeout = 60_000;
    await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', r));
    fake.url = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
    return fake;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise((r) => this.server.close(r));
  }

  private tick(): string {
    this.clock += 1; // updated_at sempre crescente (o serviço descarta leituras antigas)
    return new Date(this.clock).toISOString();
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== 'Bearer TEST-access-token') return send(401, { message: 'unauthorized' });
    const url = new URL(req.url!, 'http://x');
    const m = url.pathname.match(/^\/v1\/payments(?:\/(\d+))?(\/refunds)?$/);
    if (!m) return send(404, { message: 'not found' });
    const id = m[1] ? Number(m[1]) : null;

    if (req.method === 'POST' && !id) {
      this.calls.create++;
      const key = req.headers['x-idempotency-key'];
      if (typeof key !== 'string' || !key) return send(400, { message: "Header X-Idempotency-Key can't be null", error: 4292 });
      const existing = this.byKey.get(key);
      if (existing) return send(200, this.public(this.payments.get(existing)!));
      if (this.failNextCreates > 0) {
        this.failNextCreates--;
        return send(500, { message: 'internal_error' });
      }
      const p = this.create(key, body);
      if (typeof p === 'string') return send(400, { message: p });
      if (this.dropNextCreateResponses > 0) {
        this.dropNextCreateResponses--;
        req.socket.destroy();
        return;
      }
      return send(201, this.public(p));
    }
    const p = id ? this.payments.get(id) : undefined;
    if (!p) return send(404, { message: 'Payment not found' });

    if (req.method === 'GET' && !m[2]) {
      this.calls.get++;
      return send(200, this.public(p));
    }
    if (req.method === 'PUT' && !m[2]) {
      this.calls.cancel++;
      if (body.status !== 'cancelled') return send(400, { message: 'unsupported' });
      if (!['pending', 'in_process', 'authorized'].includes(p.status)) {
        return send(400, { message: 'Invalid status for cancellation', error: 2018 });
      }
      this.setStatus(p.id, 'cancelled', 'by_collector');
      return send(200, this.public(p));
    }
    if (req.method === 'POST' && m[2]) {
      this.calls.refund++;
      const key = req.headers['x-idempotency-key'];
      if (typeof key !== 'string' || !key) return send(400, { message: "Header X-Idempotency-Key can't be null", error: 4292 });
      if (this.refundKeys.has(key)) return send(201, { id: p.id, status: 'approved' });
      if (p.status !== 'approved') return send(400, { message: 'Payment not refundable' });
      this.refundKeys.add(key);
      this.setStatus(p.id, 'refunded', 'refunded');
      return send(201, { id: p.id, status: 'approved' });
    }
    return send(405, { message: 'method not allowed' });
  }

  private create(key: string, body: Record<string, unknown>): FakePayment | string {
    const method = String(body.payment_method_id ?? '');
    const payer = body.payer as { email?: string; identification?: { number?: string } } | undefined;
    if (!payer?.email) return 'payer.email required';
    if (typeof body.transaction_amount !== 'number' || body.transaction_amount <= 0) return 'invalid transaction_amount';
    if (typeof body.external_reference !== 'string' || body.external_reference.length > 64) return 'invalid external_reference';
    const now = new Date(this.clock);
    const id = this.nextId++;
    const p: FakePayment = {
      id,
      status: 'pending',
      status_detail: 'pending_waiting_transfer',
      external_reference: body.external_reference,
      transaction_amount: body.transaction_amount,
      payment_method_id: method,
      date_created: now.toISOString(),
      date_last_updated: this.tick(),
      date_approved: null,
      date_of_expiration: null,
      idempotencyKey: key,
      body,
    };
    if (method === 'pix') {
      if (!payer.identification?.number) return 'payer.identification required for pix';
      const exp = String(body.date_of_expiration ?? '');
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/.test(exp)) return 'invalid date_of_expiration format';
      if (new Date(exp).getTime() < Date.now() + 30 * 60 * 1000 - 1000) return 'date_of_expiration must be at least 30 minutes';
      p.date_of_expiration = exp;
      p.point_of_interaction = {
        transaction_data: {
          qr_code: `00020126580014br.gov.bcb.pix0136fake-${id}5204000053039865406${body.transaction_amount}`,
          qr_code_base64: Buffer.from(`qr-${id}`).toString('base64'),
          ticket_url: `https://www.mercadopago.com.br/payments/${id}/ticket`,
        },
      };
    } else {
      if (!body.token) return 'token required';
      const token = String(body.token);
      if (token.startsWith('APRO')) {
        p.status = 'approved';
        p.status_detail = 'accredited';
        p.date_approved = new Date().toISOString();
      } else if (token.startsWith('CONT')) {
        p.status = 'in_process';
        p.status_detail = 'pending_contingency';
      } else {
        p.status = 'rejected';
        p.status_detail = token.startsWith('FUND') ? 'cc_rejected_insufficient_amount' : 'cc_rejected_other_reason';
      }
    }
    this.payments.set(id, p);
    this.byKey.set(key, id);
    return p;
  }

  private public(p: FakePayment) {
    const { idempotencyKey: _k, body: _b, ...rest } = p;
    return rest;
  }

  /** Simula o cliente pagando o Pix no app do banco. */
  approve(id: number): FakePayment {
    return this.setStatus(id, 'approved', 'accredited');
  }

  setStatus(id: number, status: string, detail: string): FakePayment {
    const p = this.payments.get(id);
    if (!p) throw new Error(`pagamento ${id} não existe`);
    p.status = status;
    p.status_detail = detail;
    p.date_last_updated = this.tick();
    if (status === 'approved') p.date_approved = new Date().toISOString();
    return p;
  }

  forOrder(orderId: string): FakePayment[] {
    return [...this.payments.values()].filter((p) => p.external_reference === orderId);
  }

  /** Notificação de webhook exatamente como o MP envia, assinada com o segredo da aplicação. */
  webhook(paymentId: number, secret: string, requestId = `req-${Math.random().toString(36).slice(2)}`) {
    const ts = String(Math.floor(Date.now() / 1000));
    const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
    return {
      method: 'POST' as const,
      url: `/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`,
      headers: { 'content-type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
      payload: {
        action: 'payment.updated',
        api_version: 'v1',
        data: { id: String(paymentId) },
        date_created: new Date().toISOString(),
        id: Math.floor(Math.random() * 1e9),
        live_mode: false,
        type: 'payment',
        user_id: 123,
      },
    };
  }
}
