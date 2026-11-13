import type { FastifyInstance } from 'fastify';
import { UpstreamError } from '../lib/errors.js';
import { verifyMercadoPagoSignature } from '../modules/payments/mercadopago.js';

interface MpWebhookBody {
  type?: string;
  topic?: string;
  action?: string;
  data?: { id?: string | number };
  id?: string | number;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;

  /**
   * Notificações de pagamento do Mercado Pago.
   * Nunca confiamos no corpo: validamos a assinatura, consultamos o pagamento na API do MP e
   * aplicamos o estado real de forma idempotente. Reenvios (o MP repete até receber 200) são inofensivos.
   * Erro ao consultar o MP → 500, e o MP tenta de novo.
   */
  app.post<{ Querystring: Record<string, string | undefined>; Body: MpWebhookBody }>(
    '/api/webhooks/mercadopago',
    { config: { rateLimit: false } },
    async (req, reply) => {
      const q = req.query;
      const body = req.body ?? {};
      const type = q.type ?? q.topic ?? body.type ?? body.topic;
      const dataId = q['data.id'] ?? (body.data?.id != null ? String(body.data.id) : undefined) ?? q.id;
      const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined;

      const secret = ctx.config.MP_WEBHOOK_SECRET;
      if (secret) {
        const valid = verifyMercadoPagoSignature({
          secret,
          signatureHeader: typeof req.headers['x-signature'] === 'string' ? req.headers['x-signature'] : undefined,
          requestId,
          dataId: q['data.id'] ?? dataId,
        });
        if (!valid) {
          req.log.warn({ dataId, type }, 'webhook do Mercado Pago com assinatura inválida');
          return reply.status(401).send({ error: { code: 'INVALID_SIGNATURE', message: 'assinatura inválida' } });
        }
      } else {
        req.log.warn('MP_WEBHOOK_SECRET ausente: webhook aceito sem validação de assinatura (somente desenvolvimento)');
      }

      if (type !== 'payment' || !dataId || !/^\d+$/.test(dataId)) return reply.status(200).send({ ignored: true });

      const eventKey = requestId ?? `${dataId}:${body.action ?? type}:${Date.now()}`;
      await ctx.db.query(
        `INSERT INTO webhook_events (provider, event_key, resource_id) VALUES ('mercadopago', $1, $2)
         ON CONFLICT (provider, event_key) DO NOTHING`,
        [eventKey, dataId],
      );
      let result: string;
      try {
        result = await ctx.orders.syncPayment(dataId, { type: 'webhook', id: requestId });
      } catch (err) {
        // Pagamento inexistente (ex.: notificação de teste do painel do MP): confirma para não haver reenvio eterno.
        if (err instanceof UpstreamError && err.status === 404) result = 'not_found';
        else throw err;
      }
      await ctx.db.query(
        `UPDATE webhook_events SET processed_at = now(), result = $3 WHERE provider = 'mercadopago' AND event_key = $1 AND resource_id = $2`,
        [eventKey, dataId, result],
      );
      req.log.info({ paymentId: dataId, result }, 'webhook de pagamento processado');
      return reply.status(200).send({ ok: true });
    },
  );
}
