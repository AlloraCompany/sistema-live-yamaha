import type { Config } from './config.js';
import { createDb, type Db } from './db/pool.js';
import type { Logger } from './logger.js';
import { AuthService } from './modules/auth/sessions.js';
import { OrdersService } from './modules/orders/service.js';
import type { PaymentGateway } from './modules/payments/gateway.js';
import { MercadoPagoGateway } from './modules/payments/mercadopago.js';

/** Dependências compartilhadas por API e worker (montadas uma vez por processo). */
export interface AppContext {
  config: Config;
  log: Logger;
  db: Db;
  gateway: PaymentGateway | null;
  orders: OrdersService;
  auth: AuthService;
}

export function createContext(config: Config, log: Logger, appName = 'lle-api'): AppContext {
  const db = createDb({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    ssl: config.DATABASE_SSL,
    log,
    appName,
  });

  const gateway: PaymentGateway | null = config.MP_ACCESS_TOKEN
    ? new MercadoPagoGateway({
        accessToken: config.MP_ACCESS_TOKEN,
        apiBase: config.MP_API_BASE,
        // O MP só aceita notification_url https; em desenvolvimento local fica a URL configurada no painel do MP.
        notificationUrl: config.PUBLIC_BASE_URL.startsWith('https://')
          ? `${config.PUBLIC_BASE_URL}/api/webhooks/mercadopago`
          : null,
        statementDescriptor: config.MP_STATEMENT_DESCRIPTOR,
        timeoutMs: config.MP_TIMEOUT_MS,
      })
    : null;
  if (!gateway) log.warn('MP_ACCESS_TOKEN ausente: a loja não aceitará pagamentos neste ambiente');

  return {
    config,
    log,
    db,
    gateway,
    orders: new OrdersService({ db, log, gateway, holdGraceSeconds: config.HOLD_GRACE_SECONDS }),
    auth: new AuthService(db, config.ADMIN_PASSWORD, config.SESSION_TTL_HOURS),
  };
}
