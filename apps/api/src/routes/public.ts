import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizeBrPhone } from '@lle/shared';
import { parse } from '../http/validation.js';
import { Errors } from '../lib/errors.js';

const waitlistSchema = z.object({
  modelSlug: z.string().min(1).max(80),
  name: z.string().trim().min(2).max(80),
  whatsapp: z.string().transform((s, ctx) => {
    const n = normalizeBrPhone(s);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'WhatsApp inválido.' });
      return z.NEVER;
    }
    return n;
  }),
});

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  const { ctx, hub } = app;

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/ready', async (_req, reply) => {
    await ctx.db.query('SELECT 1');
    if (!hub.current().json) return reply.status(503).send({ ok: false, reason: 'snapshot ainda não carregado' });
    return { ok: true, viewersConnected: hub.viewers.size };
  });

  app.get('/api/config', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return {
      mpPublicKey: ctx.config.MP_PUBLIC_KEY ?? null,
      storeLegalName: ctx.config.STORE_LEGAL_NAME,
      storeCnpj: ctx.config.STORE_CNPJ ?? null,
    };
  });

  // Estado da live servido da memória; CDN pode segurar 1s (milhares de leituras → 1 por segundo na origem).
  app.get('/api/live/snapshot', async (req, reply) => {
    const { json, version } = hub.current();
    if (!json) throw new Error('snapshot indisponível');
    const etag = `"${version}"`;
    reply.header('Cache-Control', 'public, max-age=1, stale-while-revalidate=5').header('ETag', etag);
    if (req.headers['if-none-match'] === etag) return reply.status(304).send();
    return reply.type('application/json').send(json);
  });

  app.get('/api/live/stream', (req, reply) => {
    reply.hijack();
    const ok = hub.viewers.open(reply.raw, hub.initialMessage());
    if (!ok) {
      // Instância cheia: o load balancer/cliente tenta outra ou cai no polling do snapshot.
      reply.raw.writeHead(503, { 'Retry-After': '5', 'Content-Type': 'application/json' });
      reply.raw.end(JSON.stringify({ error: { code: 'BUSY', message: 'Instância no limite de conexões.' } }));
      req.log.warn('limite de conexões SSE atingido');
    }
  });

  app.get<{ Params: { id: string } }>('/media/:id', async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw Errors.notFound('Imagem');
    const etag = `"${req.params.id}"`;
    if (req.headers['if-none-match'] === etag) return reply.status(304).send();
    const { rows } = await ctx.db.query<{ content_type: string; bytes: Buffer }>(
      `SELECT content_type, bytes FROM model_photos WHERE id = $1`,
      [req.params.id],
    );
    if (!rows[0]) throw Errors.notFound('Imagem');
    // Conteúdo imutável (cada upload gera um id novo): cache eterno em CDN e navegador.
    return reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('ETag', etag)
      .type(rows[0].content_type)
      .send(rows[0].bytes);
  });

  // "Eu quero!": um toque na moto esgotada, sem dados pessoais. Só soma na contagem da moto.
  // O limite por IP é folgado porque, no celular, muita gente sai pela mesma rede da operadora.
  app.post('/api/models/:slug/want', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { slug } = parse(z.object({ slug: z.string().min(1).max(80) }), req.params);
    const { rowCount } = await ctx.db.query(
      `INSERT INTO model_wants (model_id, count)
            SELECT id, 1 FROM models WHERE slug = $1 AND offer_active AND released_at IS NOT NULL
       ON CONFLICT (model_id) DO UPDATE SET count = model_wants.count + 1, updated_at = now()`,
      [slug],
    );
    if (!rowCount) throw Errors.notFound('Moto');
    return { ok: true };
  });

  app.post('/api/waitlist', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const input = parse(waitlistSchema, req.body);
    const { rows } = await ctx.db.query<{ id: number }>(`SELECT id FROM models WHERE slug = $1`, [input.modelSlug]);
    if (!rows[0]) throw Errors.notFound('Moto');
    await ctx.db.query(
      `INSERT INTO waitlist (model_id, name, whatsapp) VALUES ($1, $2, $3) ON CONFLICT (model_id, whatsapp) DO NOTHING`,
      [rows[0].id, input.name, input.whatsapp],
    );
    return { ok: true };
  });
}
