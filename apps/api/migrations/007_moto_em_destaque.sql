-- Moto em destaque na loja: a que o apresentador está mostrando agora.
-- Escolhida no painel (botão "Destacar"); liberar uma moto também a coloca em destaque.
ALTER TABLE live_settings ADD COLUMN featured_model_id int REFERENCES models(id) ON DELETE SET NULL;
