require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const categoriesRouter = require("./routes/categories");
const destinationsRouter = require("./routes/destinations");
const itemsRouter = require("./routes/items");

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:4200")
  .split(",")
  .map((origin) => origin.trim());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origem bloqueada pelo CORS"));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("API MochilaOk rodando. Teste /health");
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

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || "Erro interno" });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
