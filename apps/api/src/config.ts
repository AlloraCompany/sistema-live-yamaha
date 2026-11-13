import { z } from 'zod';

/**
 * Configuração lida exclusivamente de variáveis de ambiente (12-factor).
 * Valores ausentes ou inválidos derrubam o processo na inicialização, nunca no meio de uma venda.
 */

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    PUBLIC_BASE_URL: z.string().url(),
    WEB_DIST_DIR: optionalString,

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(200).default(20),
    DATABASE_SSL: bool.default('false'),

    TRUST_PROXY: z.string().default('false'),
    /** Senha única do painel (/painel). Obrigatória em produção. */
    ADMIN_PASSWORD: optionalString.refine(
      (v) => v === undefined || (v.length >= 12 && /[A-Za-z]/.test(v) && /\d/.test(v)),
      'use ao menos 12 caracteres, com letras e números',
    ),
    COOKIE_SECURE: bool.optional(),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
    RUN_WORKER_IN_PROCESS: bool.default('false'),
    MAX_SSE_CLIENTS: z.coerce.number().int().positive().default(20_000),
    ORDER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
    API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),

    /** Tolerância após o fim da reserva antes de liberar a moto (cobre atraso de webhook). */
    HOLD_GRACE_SECONDS: z.coerce.number().int().min(0).max(900).default(120),

    /**
     * Só para o ensaio antes de existirem as credenciais do Mercado Pago: deixa a API subir em produção
     * sem pagamentos (a loja recusa compras com uma mensagem clara). Nunca use no dia da live.
     */
    ALLOW_START_WITHOUT_PAYMENTS: bool.default('false'),
    MP_ACCESS_TOKEN: optionalString,
    MP_PUBLIC_KEY: optionalString,
    MP_WEBHOOK_SECRET: optionalString,
    MP_API_BASE: z.string().url().default('https://api.mercadopago.com'),
    MP_STATEMENT_DESCRIPTOR: z.string().max(22).default('GERACAO YAMAHA'),
    MP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

    STORE_LEGAL_NAME: z.string().default('Geração Yamaha'),
    STORE_CNPJ: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      const required = env.ALLOW_START_WITHOUT_PAYMENTS
        ? (['ADMIN_PASSWORD'] as const)
        : (['ADMIN_PASSWORD', 'MP_ACCESS_TOKEN', 'MP_PUBLIC_KEY', 'MP_WEBHOOK_SECRET'] as const);
      for (const key of required) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'obrigatório em produção' });
      }
    }
  });

export type Env = z.infer<typeof schema>;

export interface Config extends Env {
  isProduction: boolean;
  trustProxy: boolean | number | string;
  cookieSecure: boolean;
}

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${lines}`);
  }
  const env = parsed.data;
  const tp = env.TRUST_PROXY;
  const trustProxy = tp === 'true' ? true : tp === 'false' ? false : /^\d+$/.test(tp) ? Number(tp) : tp;
  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    trustProxy,
    cookieSecure: env.COOKIE_SECURE ?? env.PUBLIC_BASE_URL.startsWith('https://'),
  };
}
