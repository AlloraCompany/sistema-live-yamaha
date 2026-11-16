-- Ajustes de 16/11/2026 (pedido da operação):
--  1. Depois de "Encerrada", as condições da live continuam valendo no site até um prazo (com contador na loja).
--  2. Cada loja tem o seu WhatsApp, usado no botão do comprovante.
--  3. O cliente escolhe a cor de preferência no checkout.

-- Até quando o site aceita compras depois que a live é encerrada. null = fecha na hora do encerramento.
ALTER TABLE live_settings ADD COLUMN offers_until timestamptz;
-- A live acontece uma única vez, em 18/11/2026: condições válidas até 19/11 às 10h (horário de Brasília).
UPDATE live_settings SET offers_until = '2026-11-19 10:00:00-03' WHERE id = 1;

ALTER TABLE stores ADD COLUMN whatsapp text;

ALTER TABLE orders ADD COLUMN preferred_color text;
