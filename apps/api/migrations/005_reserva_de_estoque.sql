-- Reserva de estoque por moto (pedido da operação em 17/11/2026).
--
-- A live começa com parte das unidades de cada moto no site; o resto fica de reserva e entra à venda
-- conforme a procura. Este número é só do painel: a loja nunca mostra a reserva ao cliente. "Liberar 1 da
-- reserva" no painel tira uma unidade daqui e cria uma unidade disponível na loja.
ALTER TABLE models ADD COLUMN reserve_units int NOT NULL DEFAULT 0 CHECK (reserve_units >= 0);
