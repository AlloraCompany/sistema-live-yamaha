-- "Eu quero!" (pedido da operação em 17/11/2026): na moto esgotada, o cliente toca um botão pedindo que ela
-- volte na live. Não pede nome nem telefone: guarda só a contagem por moto, para o operador ver a procura
-- no painel e o apresentador decidir se abre mais unidades. Substitui o formulário da lista de espera.
--
-- Sem NOTIFY de propósito: um pico de toques não deve recarregar a loja nem o painel a cada clique
-- (o painel já se atualiza sozinho a cada 30 segundos e a cada venda).
CREATE TABLE model_wants (
  model_id    int PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
  count       int NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
