require("dotenv").config();

const express = require("express");

const authRoutes = require("./routes/auth");
const destinationsRouter = require("./routes/destinations");
const categoriesRouter = require("./routes/categories");
const itemsRouter = require("./routes/items");

const app = express();

console.log("[BOOT] MochilaOk API iniciando...");
console.log("[BOOT] NODE_ENV:", process.env.NODE_ENV);
console.log("[BOOT] PORT recebida:", process.env.PORT);
console.log("[BOOT] DATABASE_URL configurada:", Boolean(process.env.DATABASE_URL));
console.log("[BOOT] JWT_SECRET configurado:", Boolean(process.env.JWT_SECRET));
console.log("[BOOT] CORS_ORIGIN:", process.env.CORS_ORIGIN);
console.log("[BOOT] CORS:", process.env.CORS);

const allowedOrigins = (
  process.env.CORS_ORIGIN ||
  process.env.CORS ||
  "*"
)
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""));

console.log("[BOOT] CORS_ORIGIN final:", allowedOrigins);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const normalizedOrigin = origin ? origin.replace(/\/$/, "") : "";

  const isAllowed =
    !origin ||
    allowedOrigins.includes("*") ||
    allowedOrigins.includes(normalizedOrigin);

  if (isAllowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization"
  );

  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    console.log("[CORS] Preflight:", origin, "Permitido:", isAllowed);
    return res.sendStatus(isAllowed ? 204 : 403);
  }

  if (!isAllowed) {
    console.warn("[CORS] Origem bloqueada:", origin);
    console.warn("[CORS] Origens permitidas:", allowedOrigins);

    return res.status(403).json({
      error: "Origem bloqueada pelo CORS",
      origin,
      allowedOrigins,
    });
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

app.use("/auth", authRoutes);
app.use("/destinations", destinationsRouter);
app.use("/destinations", categoriesRouter);
app.use("/destinations", itemsRouter);
app.use(itemsRouter);

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando em 0.0.0.0:${PORT}`);
});