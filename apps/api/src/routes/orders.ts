import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CreateOrderResult } from '@lle/shared';
import { parse } from '../http/validation.js';
import { AppError, Errors } from '../lib/errors.js';
import { createOrderSchema, paymentInputSchema } from '../modules/orders/schemas.js';
import { loadOrderView } from '../modules/orders/view.js';
import { renderReceiptPdf } from '../modules/orders/receipt.js';

type CodeParams = { Params: { code: string } };

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;

  /** O token do pedido vai em header (nunca na URL) e só o hash fica no banco. */
  async function orderIdFrom(req: FastifyRequest<CodeParams>): Promise<string> {
    const token = req.headers['x-order-token'];
    if (typeof token !== 'string' || token.length < 43 || !/^LLE-[0-9A-Z]{6}$/.test(req.params.code)) {
      throw Errors.notFound('Pedido');
    }
    return ctx.orders.findIdByCodeAndToken(req.params.code, token);
  }

  function errorBody(err: AppError | null) {
    return err ? { code: err.code, message: err.message } : null;
  }

  app.post(
    '/api/orders',
    { config: { rateLimit: { max: ctx.config.ORDER_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } } },
    async (req, reply): Promise<CreateOrderResult> => {
      // Sem meio de pagamento configurado, nem segura a moto (evita prender estoque à toa).
      if (!ctx.gateway) throw Errors.paymentsNotConfigured();
      const input = parse(createOrderSchema, req.body);
      const { orderId, created } = await ctx.orders.createOrder(input, req.ip);
      req.log.info({ orderId, created, method: input.payment.method }, created ? 'pedido criado' : 'pedido reaproveitado');
      const { error } = await ctx.orders.startPayment(orderId, input.payment);
      reply.status(created ? 201 : 200);
      return { order: await loadOrderView(ctx.db.pool, orderId), paymentError: errorBody(error) };
    },
  );

  app.get<CodeParams>('/api/orders/:code', async (req, reply) => {
    const id = await orderIdFrom(req);
    reply.header('Cache-Control', 'no-store');
    return loadOrderView(ctx.db.pool, id);
  });

  app.post<CodeParams>(
    '/api/orders/:code/payments',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req): Promise<CreateOrderResult> => {
      const id = await orderIdFrom(req);
      const payment = parse(paymentInputSchema, req.body);
      const { error } = await ctx.orders.startPayment(id, payment);
      return { order: await loadOrderView(ctx.db.pool, id), paymentError: errorBody(error) };
    },
  );

  app.get<CodeParams>('/api/orders/:code/receipt.pdf', async (req, reply) => {
    const id = await orderIdFrom(req);
    const view = await loadOrderView(ctx.db.pool, id);
    if (!['paid', 'completed'].includes(view.status)) {
      throw new AppError('NOT_PAID', 'O comprovante fica disponível após a confirmação do pagamento.', 409);
    }
    const pdf = await renderReceiptPdf(view, { legalName: ctx.config.STORE_LEGAL_NAME, cnpj: ctx.config.STORE_CNPJ ?? null });
    return reply
      .header('Cache-Control', 'no-store')
      .header('Content-Disposition', `attachment; filename="voucher-${view.code}.pdf"`)
      .type('application/pdf')
      .send(pdf);
  });
}
