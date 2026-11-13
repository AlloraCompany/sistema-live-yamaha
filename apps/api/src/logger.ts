import pino from 'pino';

export type Logger = pino.Logger;

/**
 * Logs estruturados (JSON) com dados pessoais e segredos mascarados.
 * CPF, e-mail, tokens e dados de cartão nunca devem aparecer em log.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-order-token"]',
  'res.headers["set-cookie"]',
  '*.cpf',
  '*.customer_cpf',
  '*.email',
  '*.password',
  '*.token',
  '*.clientToken',
  '*.accessToken',
  'customer.cpf',
  'customer.email',
  'payment.token',
];

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    redact: { paths: LOG_REDACT_PATHS, censor: '[oculto]' },
    base: { service: 'lle' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } } : {}),
  });
}
