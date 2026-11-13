import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { AppContext } from './context.js';
import { AppError } from './lib/errors.js';
import type { LiveHub } from './modules/live/hub.js';
import { publicRoutes } from './routes/public.js';
import { orderRoutes } from './routes/orders.js';
import { webhookRoutes } from './routes/webhooks.js';
import { adminRoutes } from './routes/admin.js';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    hub: LiveHub;
  }
}

export async function buildServer(ctx: AppContext, hub: LiveHub) {
  const { config } = ctx;
  const app = Fastify({
    loggerInstance: ctx.log,
    // Número = quantos proxies à frente (load balancer/CDN) são confiáveis para ler o IP real.
    trustProxy:
      typeof config.trustProxy === 'number'
        ? (_addr: string, hop: number) => hop < (config.trustProxy as number)
        : config.trustProxy,
    bodyLimit: 256 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  app.decorate('ctx', ctx);
  app.decorate('hub', hub);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'", 'https://sdk.mercadopago.com', 'https://*.mlstatic.com', 'https://*.mercadopago.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://*.mlstatic.com', 'https://*.mercadopago.com', 'https://*.mercadolibre.com'],
        fontSrc: ["'self'", 'data:', 'https://*.mlstatic.com'],
        connectSrc: [
          "'self'",
          'https://*.mercadopago.com',
          'https://*.mercadolibre.com',
          'https://*.mercadolivre.com',
        ],
        frameSrc: [
          'https://www.youtube-nocookie.com',
          'https://www.youtube.com',
          'https://*.mercadopago.com',
          'https://*.mercadolibre.com',
          'https://*.mercadolivre.com',
        ],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(rateLimit, {
    global: true,
    max: config.API_RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    // Snapshot/stream/mídia são servidos de memória ou cache: não entram no limite global.
    allowList: (req) => /^\/(api\/live\/|media\/|assets\/)/.test(req.url),
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: { code: 'RATE_LIMITED', message: 'Muitas requisições. Aguarde alguns segundos e tente de novo.' },
    }),
  });

  // Fotos enviadas pelo painel chegam como corpo binário (sem multipart).
  app.addContentTypeParser(
    ['image/webp', 'image/png', 'image/jpeg', 'image/avif'],
    { parseAs: 'buffer', bodyLimit: 6 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.error({ err }, err.message);
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Muitas requisições. Aguarde alguns segundos.' } });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST', message: 'Requisição inválida.' } });
    }
    req.log.error({ err }, 'erro inesperado');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Erro inesperado. Tente de novo em instantes.' } });
  });

  await app.register(publicRoutes);
  await app.register(orderRoutes);
  await app.register(webhookRoutes);
  await app.register(adminRoutes, { prefix: '/api/admin' });

  const webDist = config.WEB_DIST_DIR ? path.resolve(config.WEB_DIST_DIR) : null;
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      // O Cache-Control é definido abaixo (o padrão do plugin, max-age=0, sobrescreveria).
      cacheControl: false,
      setHeaders: (res, filePath) => {
        res.setHeader(
          'Cache-Control',
          filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
    // Rotas da SPA (/, /motos/..., /pedido/..., /painel) devolvem o index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/media/')) {
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      }
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } });
    });
  }

  return app;
}
