-- Live Limpa Estoque — esquema inicial.
-- Garantias de consistência ficam no banco (constraints, índices únicos parciais e triggers),
-- não só no código: mesmo um bug na aplicação não consegue vender a mesma moto duas vezes.

CREATE TABLE stores (
  id         smallserial PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  sort       int NOT NULL DEFAULT 0
);

CREATE TABLE consultants (
  id         serial PRIMARY KEY,
  name       text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  whatsapp   text,
  store_id   smallint REFERENCES stores(id),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Painel com senha única (variável ADMIN_PASSWORD). Guarda o hash da senha vigente só para
-- perceber, na subida, que ela foi trocada e encerrar as sessões abertas com a senha antiga.
CREATE TABLE admin_auth (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_hash  text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash  bytea PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ip          text,
  user_agent  text
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Configuração da transmissão: linha única.
CREATE TABLE live_settings (
  id                    smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status                text NOT NULL DEFAULT 'em_breve' CHECK (status IN ('em_breve', 'ao_vivo', 'encerrada')),
  starts_at             timestamptz,
  viewers_display       int NOT NULL DEFAULT 0 CHECK (viewers_display >= 0),
  youtube_url           text,
  voucher_amount_cents  int NOT NULL DEFAULT 100000 CHECK (voucher_amount_cents > 0),
  valid_until           date,
  whatsapp              text,
  show_thermometer      boolean NOT NULL DEFAULT true,
  show_locked_prices    boolean NOT NULL DEFAULT false,
  hold_minutes          int NOT NULL DEFAULT 30 CHECK (hold_minutes BETWEEN 5 AND 120),
  offline_sales         int NOT NULL DEFAULT 0 CHECK (offline_sales >= 0),
  testimonials          jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO live_settings (id) VALUES (1);

-- Cada +1/-1 de venda fora do site, para "última venda há X min" e auditoria.
CREATE TABLE offline_sale_events (
  id          bigserial PRIMARY KEY,
  delta       smallint NOT NULL CHECK (delta IN (-1, 1)),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE goals (
  id          serial PRIMARY KEY,
  threshold   int NOT NULL UNIQUE CHECK (threshold > 0),
  prize       text NOT NULL CHECK (length(prize) BETWEEN 1 AND 60),
  description text NOT NULL DEFAULT ''
);

CREATE TABLE models (
  id                  serial PRIMARY KEY,
  slug                text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name                text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  category_label      text NOT NULL DEFAULT '',
  colors              text[] NOT NULL DEFAULT '{}',
  price_live_cents    int NOT NULL CHECK (price_live_cents > 0),
  price_table_cents   int NOT NULL CHECK (price_table_cents > 0),
  down_payment_cents  int NOT NULL DEFAULT 0 CHECK (down_payment_cents >= 0),
  installment_cents   int NOT NULL DEFAULT 0 CHECK (installment_cents >= 0),
  installments        int NOT NULL DEFAULT 48 CHECK (installments BETWEEN 1 AND 120),
  rate_note           text NOT NULL DEFAULT '',
  specs               jsonb NOT NULL DEFAULT '[]'::jsonb,
  description         text NOT NULL DEFAULT '',
  offer_active        boolean NOT NULL DEFAULT true,
  released_at         timestamptz,           -- null = bloqueada (cadeado na loja)
  sort                int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id      int NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  color         text,
  content_type  text NOT NULL CHECK (content_type IN ('image/webp', 'image/png', 'image/jpeg', 'image/avif')),
  bytes         bytea NOT NULL,
  sort          int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_photos_model_idx ON model_photos (model_id, sort);

-- Uma linha por motocicleta física. É a unidade de concorrência: cada compra segura UMA linha.
CREATE TABLE units (
  id          serial PRIMARY KEY,
  model_id    int NOT NULL REFERENCES models(id),
  color       text,
  chassis     text UNIQUE,
  status      text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'held', 'sold', 'removed')),
  order_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Unidade segurada/vendida sempre aponta para o pedido; livre/removida nunca aponta.
  CONSTRAINT units_order_consistency CHECK ((status IN ('held', 'sold')) = (order_id IS NOT NULL))
);
-- Um pedido nunca segura duas motos.
CREATE UNIQUE INDEX units_order_uq ON units (order_id) WHERE order_id IS NOT NULL;
-- Índice parcial usado pela reserva (SELECT ... FOR UPDATE SKIP LOCKED).
CREATE INDEX units_available_idx ON units (model_id, id) WHERE status = 'available';
CREATE INDEX units_model_status_idx ON units (model_id, status);

CREATE TABLE orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Código único do voucher (comprovante): nunca se repete, nem entre pedidos vencidos ou devolvidos.
  code                  text NOT NULL UNIQUE CHECK (code ~ '^LLE-[0-9A-HJKMNP-TV-Z]{6}$'),
  access_token_hash     bytea NOT NULL UNIQUE,
  model_id              int NOT NULL REFERENCES models(id),
  unit_id               int REFERENCES units(id),
  store_id              smallint NOT NULL REFERENCES stores(id),
  consultant_id         int REFERENCES consultants(id),
  status                text NOT NULL CHECK (status IN (
                          'pending_payment', 'paid', 'expired', 'failed',
                          'refund_pending', 'refunded', 'completed')),
  status_reason         text,
  customer_name         text NOT NULL,
  customer_cpf          char(11) NOT NULL,
  customer_whatsapp     text NOT NULL,
  customer_email        text NOT NULL,
  model_name            text NOT NULL,
  price_live_cents      int NOT NULL,
  voucher_amount_cents  int NOT NULL CHECK (voucher_amount_cents > 0),
  valid_until           date,
  hold_expires_at       timestamptz NOT NULL,
  current_payment_id    bigint,
  pix_attempt           int NOT NULL DEFAULT 0,
  paid_payment_id       bigint,
  paid_method           text CHECK (paid_method IN ('pix', 'card')),
  paid_at               timestamptz,
  terms_accepted_at     timestamptz NOT NULL,
  client_ip             text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Pedido pago (ou em devolução) sempre sabe qual pagamento o quitou.
  CONSTRAINT orders_paid_consistency CHECK (
    (status IN ('paid', 'completed', 'refund_pending', 'refunded')) = (paid_payment_id IS NOT NULL)
  ),
  -- Pedido aguardando pagamento sempre segura uma unidade.
  CONSTRAINT orders_pending_has_unit CHECK (status <> 'pending_payment' OR unit_id IS NOT NULL)
);
-- Um mesmo CPF não segura duas unidades do mesmo modelo ao mesmo tempo (anti-acúmulo e duplo clique).
CREATE UNIQUE INDEX orders_one_pending_per_cpf_model ON orders (customer_cpf, model_id) WHERE status = 'pending_payment';
-- Um pagamento aprovado só pode quitar um pedido.
CREATE UNIQUE INDEX orders_paid_payment_uq ON orders (paid_payment_id) WHERE paid_payment_id IS NOT NULL;
CREATE INDEX orders_pending_expiry_idx ON orders (hold_expires_at) WHERE status = 'pending_payment';
CREATE INDEX orders_status_paid_idx ON orders (status, paid_at);
CREATE INDEX orders_created_idx ON orders (created_at DESC);

ALTER TABLE units ADD CONSTRAINT units_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) DEFERRABLE INITIALLY DEFERRED;

-- Espelho dos pagamentos no Mercado Pago (id = id do pagamento no MP).
CREATE TABLE payments (
  id                   bigint PRIMARY KEY,
  order_id             uuid NOT NULL REFERENCES orders(id),
  method               text NOT NULL CHECK (method IN ('pix', 'card')),
  status               text NOT NULL,
  status_detail        text,
  amount_cents         int NOT NULL,
  idempotency_key      text NOT NULL UNIQUE,
  pix_qr_code          text,
  pix_qr_base64        text,
  pix_ticket_url       text,
  expires_at           timestamptz,
  approved_at          timestamptz,
  provider_updated_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE INDEX payments_open_idx ON payments (updated_at) WHERE status IN ('pending', 'in_process', 'authorized');

-- Fila de trabalhos em background (claim com FOR UPDATE SKIP LOCKED; vários workers em paralelo).
CREATE TABLE jobs (
  id            bigserial PRIMARY KEY,
  type          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key    text,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  run_at        timestamptz NOT NULL DEFAULT now(),
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 15,
  locked_until  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX jobs_dedupe_active_uq ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');
CREATE INDEX jobs_ready_idx ON jobs (run_at) WHERE status = 'queued';
CREATE INDEX jobs_running_idx ON jobs (locked_until) WHERE status = 'running';

CREATE TABLE webhook_events (
  id            bigserial PRIMARY KEY,
  provider      text NOT NULL,
  event_key     text NOT NULL,
  resource_id   text,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  result        text,
  UNIQUE (provider, event_key)
);

CREATE TABLE waitlist (
  id          serial PRIMARY KEY,
  model_id    int NOT NULL REFERENCES models(id),
  name        text NOT NULL,
  whatsapp    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, whatsapp)
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_type  text NOT NULL CHECK (actor_type IN ('admin', 'customer', 'system', 'webhook')),
  actor_id    text,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  data        jsonb
);
CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id);

-- Tempo real: qualquer mudança visível na loja dispara NOTIFY (entregue só no COMMIT;
-- várias mudanças na mesma transação viram uma notificação).
CREATE FUNCTION notify_live_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('live_changed', '');
  RETURN NULL;
END $$;

CREATE FUNCTION notify_orders_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('orders_changed', '');
  RETURN NULL;
END $$;

CREATE TRIGGER units_live AFTER INSERT OR UPDATE OR DELETE ON units FOR EACH STATEMENT EXECUTE FUNCTION notify_live_changed();
CREATE TRIGGER models_live AFTER INSERT OR UPDATE OR DELETE ON models FOR EACH STATEMENT EXECUTE FUNCTION notify_live_changed();
CREATE TRIGGER photos_live AFTER INSERT OR UPDATE OR DELETE ON model_photos FOR EACH STATEMENT EXECUTE FUNCTION notify_live_changed();
CREATE TRIGGER settings_live AFTER UPDATE ON live_settings FOR EACH STATEMENT EXECUTE FUNCTION notify_live_changed();
CREATE TRIGGER goals_live AFTER INSERT OR UPDATE OR DELETE ON goals FOR EACH STATEMENT EXECUTE FUNCTION notify_live_changed();
CREATE TRIGGER stores_live AFTER INSERT OR UPDATE OR DELETE ON stores FOR EACH STATEMENT EXECUTE FUNCTION notify_live_changed();
CREATE TRIGGER orders_live AFTER INSERT OR UPDATE OR DELETE ON orders FOR EACH STATEMENT EXECUTE FUNCTION notify_live_changed();

CREATE TRIGGER orders_admin AFTER INSERT OR UPDATE ON orders FOR EACH STATEMENT EXECUTE FUNCTION notify_orders_changed();
CREATE TRIGGER payments_admin AFTER INSERT OR UPDATE ON payments FOR EACH STATEMENT EXECUTE FUNCTION notify_orders_changed();
CREATE TRIGGER waitlist_admin AFTER INSERT ON waitlist FOR EACH STATEMENT EXECUTE FUNCTION notify_orders_changed();

-- Lojas de retirada do wireframe.
INSERT INTO stores (slug, name, sort) VALUES
  ('via-expressa', 'Via Expressa', 1),
  ('centro', 'Centro', 2),
  ('sul-da-ilha', 'Sul da Ilha', 3);
