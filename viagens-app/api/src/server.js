require("dotenv").config();

const express = require("express");

const app = express();

const authRoutes = require("./routes/auth");
const destinationsRouter = require("./routes/destinations");
const categoriesRouter = require("./routes/categories");
const itemsRouter = require("./routes/items");
const aiRoutes = require("./routes/ai")

console.log("[BOOT] MochilaOk API iniciando...");
console.log("[BOOT] CORS FIX DEFINITIVO 2026-06-10 02");
console.log("[BOOT] NODE_ENV:", process.env.NODE_ENV);
console.log("[BOOT] PORT recebida:", process.env.PORT);
console.log("[BOOT] DATABASE_URL configurada:", Boolean(process.env.DATABASE_URL));
console.log("[BOOT] JWT_SECRET configurado:", Boolean(process.env.JWT_SECRET));
console.log("[BOOT] CORS_ORIGIN:", process.env.CORS_ORIGIN);
console.log("[BOOT] CORS:", process.env.CORS);
console.log("[BOOT[ GEMINI API iniciando a conexão...")

app.use((req, res, next) => {
  const origin = req.headers.origin;

  console.log(`[REQ] ${req.method} ${req.originalUrl} origin=${origin || "-"}`);

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization"
  );

  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    console.log(`[CORS] Preflight respondido: ${req.originalUrl}`);
    return res.status(204).end();
  }

  return next();
});

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("API MochilaOk rodando. Teste /health");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "mochilaok-api",
  });
});

app.get("/debug-cors", (req, res) => {
  res.json({
    ok: true,
    origin: req.headers.origin || null,
    corsOrigin: process.env.CORS_ORIGIN || null,
    cors: process.env.CORS || null,
  });
});


app.use("/auth", authRoutes);
app.use("/destinations", destinationsRouter);
app.use("/destinations", categoriesRouter);

app.use(itemsRouter);
app.use(aiRoutes)

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando em 0.0.0.0:${PORT}`);
});