const express = require("express");
const pool = require("../db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const router = express.Router();

function signToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            email: user.email,
            name: user.name
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
}

router.post("/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        if(!name || !email || !password) {
            return res.status(400).json({ error: "Nome, email e senha são obrigatórios" });
        }
        if(String(password).length < 6) {
            return res.status(400).json({ error: "Senha deve ter ao menos 6 caracteres" });
        }

        const emailNorm = String(email).trim().toLowerCase();
        const exists = await pool.query("SELECT id FROM users WHERE email = $1", [emailNorm]);
        if(exists.rows.length > 0) {
            return res.status(400).json({ error: "Email já cadastrado" });
        }

        const password_hash = await bcrypt.hash(password, 10);

        const ins = await pool.query(
            "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email",
            [name.trim(), emailNorm, password_hash]
        );
        
        const user = ins.rows[0];
        const token = signToken(user);

        return res.status(201).json({ user, token });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Erro no servidor" });
    }
});

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if(!email || !password) {
            return res.status(400).json({ error: "Email e senha são obrigatórios" });
        }

        const emailNorm = String(email).trim().toLowerCase();
        const q = await pool.query("SELECT id, name, email, password_hash FROM users WHERE email = $1", [emailNorm]);

        if(q.rows.length === 0) {
            return res.status(400).json({ error: "Email ou senha inválidos" });
        }

        const row = q.rows[0];
        const ok = await bcrypt.compare(password, row.password_hash);
        if(!ok) {
            return res.status(400).json({ error: "Email ou senha inválidos" });
        }

        const user = {
            id: row.id,
            name: row.name,
            email: row.email,
            created_at: row.created_at
        };
        const token = signToken(user);
        return res.json({ user, token });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Erro no servidor" });
    }
});

module.exports = router;