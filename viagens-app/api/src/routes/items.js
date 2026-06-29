const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

function getUserId(req) {
  return req.user?.sub || req.user?.id;
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

async function ensureDestinationAccess(client, destinationId, userId) {
  const result = await client.query(
    `
    SELECT role
    FROM destination_members
    WHERE destination_id = $1
      AND user_id = $2
    `,
    [destinationId, userId]
  );

  if (result.rowCount === 0) {
    const error = new Error("Viagem não encontrada ou sem acesso.");
    error.status = 404;
    throw error;
  }

  return result.rows[0];
}

async function ensureDestinationAdmin(client, destinationId, userId) {
  const member = await ensureDestinationAccess(client, destinationId, userId);

  if (member.role !== "ADMIN") {
    const error = new Error("Apenas administradores podem realizar esta ação.");
    error.status = 403;
    throw error;
  }

  return member;
}

async function getItemAccess(client, itemId, userId) {
  const result = await client.query(
    `
    SELECT
      i.id,
      i.destination_id,
      i.category_id,
      i.title,
      c.mode AS category_mode,
      dm.role AS my_role
    FROM items i
    JOIN categories c
      ON c.id = i.category_id
    JOIN destination_members dm
      ON dm.destination_id = i.destination_id
    WHERE i.id = $1
      AND dm.user_id = $2
    `,
    [itemId, userId]
  );

  if (result.rowCount === 0) {
    const error = new Error("Item não encontrado ou sem acesso.");
    error.status = 404;
    throw error;
  }

  return result.rows[0];
}

async function ensureItemAdmin(client, itemId, userId) {
  const item = await getItemAccess(client, itemId, userId);

  if (item.my_role !== "ADMIN") {
    const error = new Error("Apenas administradores podem editar ou excluir itens.");
    error.status = 403;
    throw error;
  }

  return item;
}

/**
 * Lista itens da viagem.
 */
router.get("/destinations/:destinationId/items", requireAuth, async (req, res) => {
  try {
    const destinationId = req.params.destinationId;
    const userId = getUserId(req);

    await ensureDestinationAccess(pool, destinationId, userId);

    const result = await pool.query(
  `
  SELECT
    i.id,
    i.destination_id,
    i.category_id,
    i.title,
    i.qty,
    i.unit,
    i.notes,
    i.created_by,
    i.created_at,

    c.name AS category_name,
    c.mode AS category_mode,

    COALESCE(my_item.status, 'PENDING') AS my_status,
    COALESCE(my_item.claimed, false) AS my_claimed,

    claimed_user.id AS claimed_by_id,
    claimed_user.name AS claimed_by_name,
    claimed_user.email AS claimed_by_email,

    done_user.id AS done_by_id,
    done_user.name AS done_by_name,
    done_user.email AS done_by_email,
    done_user.updated_at AS done_at,

    COALESCE(done_users.users, '[]'::json) AS done_by_users,

    CASE
      WHEN done_user.id IS NULL THEN 'PENDING'
      ELSE 'DONE'
    END AS global_status,

    creator.name AS created_by_name

  FROM items i

  JOIN categories c
    ON c.id = i.category_id

  LEFT JOIN item_user my_item
    ON my_item.item_id = i.id
   AND my_item.user_id = $2

  LEFT JOIN item_user claimed
    ON claimed.item_id = i.id
   AND claimed.claimed = true

  LEFT JOIN users claimed_user
    ON claimed_user.id = claimed.user_id

  LEFT JOIN LATERAL (
    SELECT
      u.id,
      u.name,
      u.email,
      iu.updated_at
    FROM item_user iu
    JOIN users u
      ON u.id = iu.user_id
    WHERE iu.item_id = i.id
      AND iu.status = 'DONE'
    ORDER BY iu.updated_at DESC
    LIMIT 1
  ) done_user ON true

  LEFT JOIN LATERAL (
    SELECT
      json_agg(
        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'updated_at', iu.updated_at
        )
        ORDER BY iu.updated_at DESC
      ) AS users
    FROM item_user iu
    JOIN users u
      ON u.id = iu.user_id
    WHERE iu.item_id = i.id
      AND iu.status = 'DONE'
  ) done_users ON true

  LEFT JOIN users creator
    ON creator.id = i.created_by

  WHERE i.destination_id = $1

  ORDER BY
    c.sort_order ASC,
    c.name ASC,
    i.created_at ASC
  `,
  [destinationId, userId]
);

    return res.json(result.rows);
  } catch (err) {
    console.error("ERRO LISTAR ITENS:", err);

    return res.status(err.status || 500).json({
      error: err.message || "Erro ao listar itens.",
    });
  }
});

/**
 * Admin cria item dentro da viagem.
 */
router.post("/destinations/:destinationId/items", requireAuth, async (req, res) => {
  try {
    const destinationId = req.params.destinationId;
    const userId = getUserId(req);

    await ensureDestinationAdmin(pool, destinationId, userId);

    const categoryId = normalizeText(req.body.category_id);
    const title = normalizeText(req.body.title);
    const unit = normalizeText(req.body.unit);
    const notes = normalizeText(req.body.notes);

    const qtyRaw = req.body.qty;
    const qty =
      qtyRaw === undefined || qtyRaw === null || qtyRaw === ""
        ? 1
        : Number(qtyRaw);

    if (!categoryId) {
      return res.status(400).json({ error: "Informe a categoria do item." });
    }

    if (!title) {
      return res.status(400).json({ error: "Informe o nome do item." });
    }

    if (Number.isNaN(qty)) {
      return res.status(400).json({ error: "Quantidade inválida." });
    }

    const categoryResult = await pool.query(
      `
      SELECT id
      FROM categories
      WHERE id = $1
        AND destination_id = $2
      `,
      [categoryId, destinationId]
    );

    if (categoryResult.rowCount === 0) {
      return res.status(400).json({
        error: "Categoria não pertence a esta viagem.",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO items (
        destination_id,
        category_id,
        title,
        qty,
        unit,
        notes,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [destinationId, categoryId, title, qty, unit, notes, userId]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("ERRO CRIAR ITEM:", err);

    return res.status(err.status || 500).json({
      error: err.message || "Erro ao criar item.",
    });
  }
});

/**
 * Admin edita item.
 */
router.patch("/items/:itemId", requireAuth, async (req, res) => {
  try {
    const itemId = req.params.itemId;
    const userId = getUserId(req);

    const item = await ensureItemAdmin(pool, itemId, userId);

    const title = normalizeText(req.body.title);
    const unit = normalizeText(req.body.unit);
    const notes = normalizeText(req.body.notes);

    const qtyRaw = req.body.qty;
    const qty =
      qtyRaw === undefined || qtyRaw === null || qtyRaw === ""
        ? null
        : Number(qtyRaw);

    const categoryId = normalizeText(req.body.category_id);

    if (!title) {
      return res.status(400).json({ error: "Informe o nome do item." });
    }

    if (qtyRaw !== undefined && qtyRaw !== null && qtyRaw !== "" && Number.isNaN(qty)) {
      return res.status(400).json({ error: "Quantidade inválida." });
    }

    if (categoryId) {
      const categoryResult = await pool.query(
        `
        SELECT id
        FROM categories
        WHERE id = $1
          AND destination_id = $2
        `,
        [categoryId, item.destination_id]
      );

      if (categoryResult.rowCount === 0) {
        return res.status(400).json({
          error: "Categoria não pertence a esta viagem.",
        });
      }
    }

    const result = await pool.query(
      `
      UPDATE items
      SET
        category_id = COALESCE($2, category_id),
        title = $3,
        qty = COALESCE($4, qty),
        unit = $5,
        notes = $6
      WHERE id = $1
      RETURNING *
      `,
      [itemId, categoryId, title, qty, unit, notes]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("ERRO EDITAR ITEM:", err);

    return res.status(err.status || 500).json({
      error: err.message || "Erro ao editar item.",
    });
  }
});

/**
 * Admin exclui item.
 */
router.delete("/items/:itemId", requireAuth, async (req, res) => {
  try {
    const itemId = req.params.itemId;
    const userId = getUserId(req);

    await ensureItemAdmin(pool, itemId, userId);

    await pool.query(
      `
      DELETE FROM items
      WHERE id = $1
      `,
      [itemId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("ERRO EXCLUIR ITEM:", err);

    return res.status(err.status || 500).json({
      error: err.message || "Erro ao excluir item.",
    });
  }
});

/**
 * Usuário marca item como feito ou pendente.
 *
 * Frontend chama:
 * PATCH /items/:itemId/status
 *
 * Body:
 * { "status": "DONE" }
 * ou
 * { "status": "PENDING" }
 */
router.patch("/items/:itemId/status", requireAuth, async (req, res) => {
  try {
    const itemId = req.params.itemId;
    const userId = getUserId(req);

    const status = String(req.body.status || "").trim().toUpperCase();

    if (!["PENDING", "DONE"].includes(status)) {
      return res.status(400).json({
        error: "Status inválido. Use PENDING ou DONE.",
      });
    }

    await getItemAccess(pool, itemId, userId);

    const result = await pool.query(
      `
      INSERT INTO item_user (
        item_id,
        user_id,
        status,
        claimed,
        updated_at
      )
      VALUES ($1, $2, $3, false, now())
      ON CONFLICT (item_id, user_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = now()
      RETURNING *
      `,
      [itemId, userId, status]
    );

    return res.json({
      ok: true,
      item_user: result.rows[0],
    });
  } catch (err) {
    console.error("ERRO ALTERAR STATUS DO ITEM:", err);

    return res.status(err.status || 500).json({
      error: err.message || "Erro ao alterar status do item.",
    });
  }
});

/**
 * Usuário assume ou libera um item.
 *
 * Frontend chama:
 * PATCH /items/:itemId/claim
 *
 * Body:
 * { "claimed": true }
 * ou
 * { "claimed": false }
 */
router.patch("/items/:itemId/claim", requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    const itemId = req.params.itemId;
    const userId = getUserId(req);
    const claimed = Boolean(req.body.claimed);

    await client.query("BEGIN");

    const item = await getItemAccess(client, itemId, userId);

    if (item.category_mode !== "CLAIMABLE") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Este item pertence a uma categoria do tipo checklist por pessoa.",
      });
    }

    if (claimed) {
      const alreadyClaimed = await client.query(
        `
        SELECT
          iu.user_id,
          u.name,
          u.email
        FROM item_user iu
        JOIN users u
          ON u.id = iu.user_id
        WHERE iu.item_id = $1
          AND iu.claimed = true
          AND iu.user_id <> $2
        `,
        [itemId, userId]
      );

      if (alreadyClaimed.rowCount > 0) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          error: `Este item já foi assumido por ${alreadyClaimed.rows[0].name}.`,
          claimed_by: alreadyClaimed.rows[0],
        });
      }

      const result = await client.query(
        `
        INSERT INTO item_user (
          item_id,
          user_id,
          claimed,
          status,
          updated_at
        )
        VALUES ($1, $2, true, 'PENDING', now())
        ON CONFLICT (item_id, user_id)
        DO UPDATE SET
          claimed = true,
          status = 'PENDING',
          updated_at = now()
        RETURNING *
        `,
        [itemId, userId]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        item_user: result.rows[0],
      });
    }

    const result = await client.query(
      `
      INSERT INTO item_user (
        item_id,
        user_id,
        claimed,
        status,
        updated_at
      )
      VALUES ($1, $2, false, 'PENDING', now())
      ON CONFLICT (item_id, user_id)
      DO UPDATE SET
        claimed = false,
        status = 'PENDING',
        updated_at = now()
      RETURNING *
      `,
      [itemId, userId]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      item_user: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");

    console.error("ERRO ASSUMIR ITEM:", err);

    if (err.code === "23505") {
      return res.status(409).json({
        error: "Este item já foi assumido por outra pessoa.",
      });
    }

    return res.status(err.status || 500).json({
      error: err.message || "Erro ao assumir item.",
    });
  } finally {
    client.release();
  }
});

module.exports = router;