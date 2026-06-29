-- Índices opcionais para melhorar a listagem global de status/responsáveis dos itens.
-- Rode uma vez no PostgreSQL, caso ainda não existam.

CREATE INDEX IF NOT EXISTS idx_item_user_item_status_updated
ON item_user (item_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_item_user_item_claimed
ON item_user (item_id, claimed);

CREATE INDEX IF NOT EXISTS idx_item_user_user_status
ON item_user (user_id, status);
