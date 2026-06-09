const { Pool } = require("pg");
require("dotenv").config();

function stripSslParams(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    u.searchParams.delete("sslcert");
    u.searchParams.delete("sslkey");
    u.searchParams.delete("sslrootcert");
    return u.toString();
  } catch {
    return url;
  }
}

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error("DATABASE_URL não definida no .env");

const shouldUseSsl =
  raw.includes("sslmode=require") || process.env.DB_SSL === "true";

const isLocal = raw.includes("localhost") || raw.includes("127.0.0.1");

const pool = new Pool({
  connectionString: stripSslParams(raw),
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

module.exports = { pool };
