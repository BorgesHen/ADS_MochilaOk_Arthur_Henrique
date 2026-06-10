require("dotenv").config();

const { Pool } = require("pg");

const raw = process.env.DATABASE_URL;

if (!raw) {
  throw new Error("DATABASE_URL não configurada nas variáveis de ambiente.");
}

const isLocal =
  raw.includes("localhost") ||
  raw.includes("127.0.0.1");

const isRailwayInternal =
  raw.includes(".railway.internal") ||
  raw.includes("railway.internal");

const shouldUseSsl =
  !isLocal &&
  !isRailwayInternal &&
  (raw.includes("sslmode=require") || process.env.DB_SSL === "true");

const pool = new Pool({
  connectionString: raw,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("Erro inesperado no pool do PostgreSQL:", err);
});

/**
 * Exporta dos dois jeitos:
 *
 * 1) const pool = require("../db");
 * 2) const { pool } = require("../db");
 *
 * Assim evita erro em arquivos que importam de formas diferentes.
 */
module.exports = pool;
module.exports.pool = pool;