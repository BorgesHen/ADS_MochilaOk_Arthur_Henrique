const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const {
  ensureDestinationAccess,
  ensureDestinationAdmin,
  ensureItemAccess,
  ensureItemAdmin,
} = require("../lib/access");

const router = express.Router();
const ALLOWED_STATUS = new Set(["PENDING", "DONE"]);

router.get("/:destinationId/items", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const destinationId = req.params.destinationId;

  await ensureDestinationAccess(userId, destinationId);

  const q = await pool.query(
    `
    SELECT
      i.id, i.destination_id, i.category_id, i.title, i.qty, i.unit, i.notes, i.created_by, i.created_at,
      c.name AS category_name,
      c.mode AS category_mode,
      COALESCE(
        CASE
          WHEN c.mode = 'CLAIMABLE' THEN cl.status
          ELSE iu.status
        END,
        'PENDING'
      ) AS my_status,
      COALESCE(iu.claimed, false) AS my_claimed,
      cl.user_id AS claimed_by,
      cl.status AS claimed_status,
      cu.name AS claimed_by_name,
      cu.email AS claimed_by_email
    FROM items i
    JOIN categories c ON c.id = i.category_id
    LEFT JOIN item_user iu
      ON iu.item_id = i.id AND iu.user_id = $2
    LEFT JOIN LATERAL (
      SELECT user_id, status
      FROM item_user
      WHERE item_id = i.id AND claimed = true
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    ) cl ON true
    LEFT JOIN users cu ON cu.id = cl.user_id
    WHERE i.destination_id = $1
    ORDER BY c.sort_order ASC, c.name ASC, i.created_at DESC
    `,
    [destinationId, userId]
  );

  res.json(q.rows);
});

router.post("/:destinationId/items", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const destinationId = req.params.destinationId;
  const { category_id, title, qty, unit, notes } = req.body;

  await ensureDestinationAdmin(userId, destinationId);

  if (!category_id) return res.status(400).json({ error: "category_id é obrigatório" });
  if (!title || String(title).trim().length < 2) return res.status(400).json({ error: "title é obrigatório (mín 2)" });

  const cat = await pool.query(
    `SELECT id FROM categories WHERE id = $1 AND destination_id = $2`,
    [category_id, destinationId]
  );
  if (cat.rows.length === 0) return res.status(400).json({ error: "Categoria inválida para esta viagem" });

  const ins = await pool.query(
    `
    INSERT INTO items (destination_id, category_id, title, qty, unit, notes, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
    `,
    [
      destinationId,
      category_id,
      String(title).trim(),
      qty == null ? null : Number(qty),
      unit || null,
      notes || null,
      userId,
    ]
  );

  res.status(201).json(ins.rows[0]);
});

router.patch("/items/:itemId", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const itemId = req.params.itemId;
  const item = await ensureItemAdmin(userId, itemId);

  const { category_id, title, qty, unit, notes } = req.body;

  if (!category_id) return res.status(400).json({ error: "category_id é obrigatório" });
  if (!title || String(title).trim().length < 2) return res.status(400).json({ error: "title é obrigatório (mín 2)" });

  const cat = await pool.query(
    `SELECT id FROM categories WHERE id = $1 AND destination_id = $2`,
    [category_id, item.destination_id]
  );
  if (cat.rows.length === 0) return res.status(400).json({ error: "Categoria inválida para esta viagem" });

  const q = await pool.query(
    `
    UPDATE items
    SET category_id = $1, title = $2, qty = $3, unit = $4, notes = $5
    WHERE id = $6
    RETURNING *
    `,
    [
      category_id,
      String(title).trim(),
      qty == null ? null : Number(qty),
      unit || null,
      notes || null,
      itemId,
    ]
  );

  res.json(q.rows[0]);
});

router.delete("/items/:itemId", requireAuth, async (req, res) => {
  const item = await ensureItemAdmin(req.user.sub, req.params.itemId);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM item_user WHERE item_id = $1`, [item.id]);
    await client.query(`DELETE FROM items WHERE id = $1`, [item.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch("/items/:itemId/claim", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const itemId = req.params.itemId;
  const claimed = !!req.body.claimed;

  await ensureItemAccess(userId, itemId);

  const qMode = await pool.query(
    `
    SELECT c.mode
    FROM items i
    JOIN categories c ON c.id = i.category_id
    WHERE i.id = $1
    `,
    [itemId]
  );

  if (qMode.rows[0]?.mode !== "CLAIMABLE") {
    return res.status(400).json({ error: "Este item não é assumível" });
  }

  if (claimed) {
    const alreadyClaimed = await pool.query(
      `
      SELECT user_id
      FROM item_user
      WHERE item_id = $1 AND claimed = true AND user_id <> $2
      LIMIT 1
      `,
      [itemId, userId]
    );

    if (alreadyClaimed.rows.length > 0) {
      return res.status(409).json({ error: "Este item já foi assumido por outra pessoa" });
    }

    await pool.query(
      `
      INSERT INTO item_user (item_id, user_id, claimed, status)
      VALUES ($1, $2, true, 'PENDING')
      ON CONFLICT (item_id, user_id)
      DO UPDATE SET claimed = true, status = 'PENDING', updated_at = now()
      `,
      [itemId, userId]
    );

    return res.json({ ok: true, claimed: true });
  }

  await pool.query(
    `UPDATE item_user SET claimed = false, status = 'PENDING', updated_at = now() WHERE item_id = $1 AND user_id = $2`,
    [itemId, userId]
  );

  return res.json({ ok: true, claimed: false });
});

router.patch("/items/:itemId/status", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const itemId = req.params.itemId;
  const { status } = req.body;

  if (!ALLOWED_STATUS.has(status)) {
    return res.status(400).json({ error: "status deve ser PENDING ou DONE" });
  }

  await ensureItemAccess(userId, itemId);

  const qMode = await pool.query(
    `
    SELECT c.mode
    FROM items i
    JOIN categories c ON c.id = i.category_id
    WHERE i.id = $1
    `,
    [itemId]
  );

  const mode = qMode.rows[0]?.mode;

  if (mode === "CLAIMABLE") {
    const mine = await pool.query(
      `SELECT claimed FROM item_user WHERE item_id = $1 AND user_id = $2`,
      [itemId, userId]
    );
    if (mine.rows.length === 0 || mine.rows[0].claimed !== true) {
      return res.status(403).json({ error: "Você precisa assumir o item antes de mudar o status" });
    }
  }

  await pool.query(
    `
    INSERT INTO item_user (item_id, user_id, claimed, status)
    VALUES ($1, $2, false, $3)
    ON CONFLICT (item_id, user_id)
    DO UPDATE SET status = $3, updated_at = now()
    `,
    [itemId, userId, status]
  );

  res.json({ ok: true, status });
});

module.exports = router;
