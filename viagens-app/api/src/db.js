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
  raw.includes(".railway.internal");

const shouldUseSsl =
  !isLocal &&
  !isRailwayInternal &&
  raw.includes("sslmode=require");

const pool = new Pool({
  connectionString: raw,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
});

module.exports = pool;