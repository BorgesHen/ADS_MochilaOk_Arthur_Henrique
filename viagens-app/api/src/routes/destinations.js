const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const {
  normalizeRole,
  withNormalizedRole,
  ensureDestinationAccess,
  ensureDestinationAdmin,
} = require("../lib/access");

const router = express.Router();
const ALLOWED_MEMBER_ROLES = new Set(["ADMIN", "MEMBER"]);

function normalizeMember(member) {
  return {
    ...member,
    role: normalizeRole(member.role),
    is_admin: normalizeRole(member.role) === "ADMIN",
  };
}

function normalizeRoleInput(role) {
  const value = String(role || "MEMBER").toUpperCase();
  return ALLOWED_MEMBER_ROLES.has(value) ? value : "MEMBER";
}

router.get("/", requireAuth, async (req, res) => {
  const userId = req.user.sub;

  try {
    // Garante que as viagens criadas pelo usuário atual tenham a linha de membro ADMIN.
    // A listagem abaixo é propositalmente baseada em destination_members, porque é essa
    // tabela que define quem pode ver cada viagem.
    await pool.query(
      `
      INSERT INTO destination_members (destination_id, user_id, role)
      SELECT id, owner_id, 'ADMIN'
      FROM destinations
      WHERE owner_id = $1
      ON CONFLICT (destination_id, user_id)
      DO UPDATE SET role = 'ADMIN'
      `,
      [userId]
    );

    const q = await pool.query(
      `
      WITH minha_participacao AS (
        SELECT DISTINCT ON (dm.destination_id)
          dm.destination_id,
          dm.role
        FROM destination_members dm
        WHERE dm.user_id = $1
        ORDER BY
          dm.destination_id,
          CASE WHEN UPPER(dm.role) IN ('ADMIN', 'OWNER') THEN 0 ELSE 1 END
      )
      SELECT
        d.*,
        CASE
          WHEN d.owner_id = $1 THEN 'ADMIN'
          ELSE mp.role
        END AS my_role
      FROM minha_participacao mp
      JOIN destinations d ON d.id = mp.destination_id
      ORDER BY d.created_at DESC
      `,
      [userId]
    );

    res.json(q.rows.map(withNormalizedRole));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Erro ao carregar viagens" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const { title, location } = req.body;

  if (!title || String(title).trim().length < 2) {
    return res.status(400).json({ error: "title é obrigatório (mín 2)" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const ins = await client.query(
      `
      INSERT INTO destinations (title, location, owner_id)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [String(title).trim(), location || null, userId]
    );

    const destination = ins.rows[0];

    await client.query(
      `
      INSERT INTO destination_members (destination_id, user_id, role)
      VALUES ($1, $2, 'ADMIN')
      ON CONFLICT (destination_id, user_id)
      DO UPDATE SET role = 'ADMIN'
      `,
      [destination.id, userId]
    );

    await client.query("COMMIT");

    res.status(201).json({ ...destination, my_role: "ADMIN", is_admin: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const destination = await ensureDestinationAccess(req.user.sub, req.params.id);

    // Garante que o criador da viagem apareça como administrador, inclusive em viagens antigas.
    await pool.query(
      `
      INSERT INTO destination_members (destination_id, user_id, role)
      VALUES ($1, $2, 'ADMIN')
      ON CONFLICT (destination_id, user_id)
      DO UPDATE SET role = 'ADMIN'
      `,
      [req.params.id, destination.owner_id]
    );

    const members = await pool.query(
      `
      SELECT dm.user_id, dm.role, dm.joined_at, u.name, u.email,
             CASE WHEN dm.user_id = d.owner_id THEN true ELSE false END AS is_owner
      FROM destination_members dm
      JOIN users u ON u.id = dm.user_id
      JOIN destinations d ON d.id = dm.destination_id
      WHERE dm.destination_id = $1
      ORDER BY
        CASE WHEN dm.user_id = d.owner_id THEN 0 ELSE 1 END,
        CASE WHEN UPPER(dm.role) IN ('ADMIN', 'OWNER') THEN 0 ELSE 1 END,
        dm.joined_at ASC
      `,
      [req.params.id]
    );

    res.json({
      destination,
      members: members.rows.map(normalizeMember),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.patch("/:id", requireAuth, async (req, res) => {
  try {
    await ensureDestinationAdmin(req.user.sub, req.params.id);

    const { title, location } = req.body;

    if (!title || String(title).trim().length < 2) {
      return res.status(400).json({ error: "title é obrigatório (mín 2)" });
    }

    const q = await pool.query(
      `
      UPDATE destinations
      SET title = $1, location = $2
      WHERE id = $3
      RETURNING *
      `,
      [String(title).trim(), location || null, req.params.id]
    );

    res.json({ ...q.rows[0], my_role: "ADMIN", is_admin: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});


router.delete("/:id", requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await ensureDestinationAdmin(req.user.sub, req.params.id);

    await client.query("BEGIN");

    const destination = await client.query(
      `SELECT id, title FROM destinations WHERE id = $1`,
      [req.params.id]
    );

    if (destination.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Viagem não encontrada" });
    }

    // Exclusão manual na ordem correta. Mesmo que o banco tenha ON DELETE CASCADE,
    // manter esta sequência evita erro em bases antigas que foram criadas sem cascade.
    await client.query(
      `
      DELETE FROM item_user
      WHERE item_id IN (
        SELECT id FROM items WHERE destination_id = $1
      )
      `,
      [req.params.id]
    );

    await client.query(`DELETE FROM items WHERE destination_id = $1`, [req.params.id]);
    await client.query(`DELETE FROM categories WHERE destination_id = $1`, [req.params.id]);
    await client.query(`DELETE FROM destination_members WHERE destination_id = $1`, [req.params.id]);
    await client.query(`DELETE FROM destinations WHERE id = $1`, [req.params.id]);

    await client.query("COMMIT");

    res.json({ ok: true, deletedId: req.params.id });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post("/:id/members", requireAuth, async (req, res) => {
  try {
    const destination = await ensureDestinationAdmin(req.user.sub, req.params.id);
    const email = String(req.body.email || "").trim().toLowerCase();
    const role = normalizeRoleInput(req.body.role);

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Informe um e-mail válido" });
    }

    const user = await pool.query(
      `SELECT id, name, email FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({
        error: "Usuário não encontrado. Peça para a pessoa criar uma conta antes de convidar.",
      });
    }

    const invitedUser = user.rows[0];
    const finalRole = invitedUser.id === destination.owner_id ? "ADMIN" : role;

    await pool.query(
      `
      INSERT INTO destination_members (destination_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (destination_id, user_id)
      DO UPDATE SET role = EXCLUDED.role
      `,
      [req.params.id, invitedUser.id, finalRole]
    );

    const member = await pool.query(
      `
      SELECT dm.user_id, dm.role, dm.joined_at, u.name, u.email,
             CASE WHEN dm.user_id = d.owner_id THEN true ELSE false END AS is_owner
      FROM destination_members dm
      JOIN users u ON u.id = dm.user_id
      JOIN destinations d ON d.id = dm.destination_id
      WHERE dm.destination_id = $1 AND dm.user_id = $2
      `,
      [req.params.id, invitedUser.id]
    );

    res.status(201).json(normalizeMember(member.rows[0]));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.patch("/:id/members/:userId/role", requireAuth, async (req, res) => {
  try {
    await ensureDestinationAdmin(req.user.sub, req.params.id);

    const role = normalizeRoleInput(req.body.role);

    const destination = await pool.query(
      `SELECT owner_id FROM destinations WHERE id = $1`,
      [req.params.id]
    );

    if (destination.rows.length === 0) {
      return res.status(404).json({ error: "Viagem não encontrada" });
    }

    if (req.params.userId === destination.rows[0].owner_id && role !== "ADMIN") {
      return res.status(400).json({ error: "O criador da viagem precisa continuar como ADMIN" });
    }

    const q = await pool.query(
      `
      UPDATE destination_members
      SET role = $1
      WHERE destination_id = $2 AND user_id = $3
      RETURNING *
      `,
      [role, req.params.id, req.params.userId]
    );

    if (q.rows.length === 0) {
      return res.status(404).json({ error: "Membro não encontrado" });
    }

    res.json({ ok: true, role });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete("/:id/members/:userId", requireAuth, async (req, res) => {
  try {
    await ensureDestinationAdmin(req.user.sub, req.params.id);

    const destination = await pool.query(
      `SELECT owner_id FROM destinations WHERE id = $1`,
      [req.params.id]
    );

    if (destination.rows.length === 0) {
      return res.status(404).json({ error: "Viagem não encontrada" });
    }

    if (req.params.userId === destination.rows[0].owner_id) {
      return res.status(400).json({ error: "Não é possível remover o criador da viagem" });
    }

    await pool.query(
      `DELETE FROM destination_members WHERE destination_id = $1 AND user_id = $2`,
      [req.params.id, req.params.userId]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
