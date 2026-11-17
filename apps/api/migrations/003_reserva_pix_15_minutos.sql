-- Reserva do Pix fixa em 15 minutos (pedido da operação em 17/11/2026). O campo saiu do painel e a API
-- não altera mais esse valor.
--
-- O Mercado Pago só aceita Pix com validade de 30 minutos ou mais, então a cobrança lá continua valendo
-- 30 minutos; quem manda é a reserva daqui: passados 15 minutos (mais a tolerância de HOLD_GRACE_SECONDS),
-- a unidade volta ao estoque e o Pix é cancelado no Mercado Pago.
ALTER TABLE live_settings ALTER COLUMN hold_minutes SET DEFAULT 15;
UPDATE live_settings SET hold_minutes = 15 WHERE id = 1;
