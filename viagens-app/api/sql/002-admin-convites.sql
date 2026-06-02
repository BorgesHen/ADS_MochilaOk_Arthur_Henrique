-- MochilaOK - permissões de administrador/convidado e convite de usuários já cadastrados.
-- Rode este arquivo no banco antes de testar a função de adicionar membros na viagem.

-- 1) Garante que a tabela de membros tenha data de entrada.
ALTER TABLE destination_members
  ADD COLUMN IF NOT EXISTS joined_at timestamptz DEFAULT now();

-- 2) Remove checks antigos sobre role, mesmo que o nome da constraint seja diferente.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'destination_members'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE destination_members DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;

-- 3) Padroniza permissões antigas.
-- O sistema anterior podia usar "OWNER"; agora usamos "ADMIN" e "MEMBER".
UPDATE destination_members
SET role = 'ADMIN'
WHERE UPPER(role) IN ('OWNER', 'ADMIN');

UPDATE destination_members
SET role = 'MEMBER'
WHERE role IS NULL OR UPPER(role) NOT IN ('ADMIN', 'MEMBER');

-- 4) Remove duplicidades antes de criar a constraint única.
-- Mantém uma linha por viagem/usuário, priorizando ADMIN.
WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY destination_id, user_id
      ORDER BY
        CASE WHEN UPPER(role) = 'ADMIN' THEN 0 ELSE 1 END,
        joined_at ASC NULLS LAST
    ) AS rn
  FROM destination_members
)
DELETE FROM destination_members dm
USING ranked r
WHERE dm.ctid = r.ctid
  AND r.rn > 1;

-- 5) Garante que cada pessoa apareça uma única vez dentro de uma viagem.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'destination_members_destination_user_unique'
  ) THEN
    ALTER TABLE destination_members
      ADD CONSTRAINT destination_members_destination_user_unique UNIQUE (destination_id, user_id);
  END IF;
END $$;

-- 6) Garante que o criador de cada viagem esteja como ADMIN.
INSERT INTO destination_members (destination_id, user_id, role)
SELECT id, owner_id, 'ADMIN'
FROM destinations
ON CONFLICT (destination_id, user_id)
DO UPDATE SET role = 'ADMIN';

-- 7) Trava o campo role nos valores esperados.
ALTER TABLE destination_members
  ADD CONSTRAINT destination_members_role_check CHECK (role IN ('ADMIN', 'MEMBER'));

-- 8) Garante updated_at no relacionamento usuário-item.
ALTER TABLE item_user
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 9) Se já houver mais de uma pessoa marcada como responsável pelo mesmo item,
-- mantém uma e libera as demais antes de criar o índice único.
WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY item_id
      ORDER BY updated_at DESC NULLS LAST
    ) AS rn
  FROM item_user
  WHERE claimed = true
)
UPDATE item_user iu
SET claimed = false,
    updated_at = now()
FROM ranked r
WHERE iu.ctid = r.ctid
  AND r.rn > 1;

-- 10) Garante que um item assumível tenha somente um responsável por vez.
CREATE UNIQUE INDEX IF NOT EXISTS item_user_one_claim_per_item
ON item_user (item_id)
WHERE claimed = true;
