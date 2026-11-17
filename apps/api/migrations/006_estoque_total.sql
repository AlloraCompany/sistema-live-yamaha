-- Estoque total de cada moto (o que existe de fato, contando o que ainda não foi para o site).
-- O painel só mostra este número ao lado de "Unidades disponíveis"; o cliente nunca vê.
-- Substitui a ideia de "reserva" da migration 005 (a coluna reserve_units fica no banco, sem uso).
ALTER TABLE models ADD COLUMN stock_total int NOT NULL DEFAULT 0 CHECK (stock_total >= 0);

UPDATE models m
   SET stock_total = m.reserve_units + (SELECT count(*) FROM units u WHERE u.model_id = m.id AND u.status <> 'removed');
