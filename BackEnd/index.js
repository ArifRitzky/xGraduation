const config = require("./config");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { query } = require("./db");
const { HttpError } = require("./utils/http");

const app = express();
app.disable("x-powered-by");
// Behind a hosting proxy (Render, Railway, etc.) so rate limiting reads the visitor's real IP.
if (config.isProd) app.set("trust proxy", 1);

// credentials: true is required so the browser sends the login cookie across origins (frontend <-> API).
app.use(cors({ origin: config.clientOrigins, credentials: true }));
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get("/health", async (req, res) => {
  try {
    await query("SELECT 1");
    res.json({
      status: "ok",
      database: "connected",
      time: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[health] Could not reach the database:", err.message);
    res.status(503).json({
      status: "error",
      database: "unreachable",
      detail: config.isProd ? undefined : err.message,
    });
  }
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api/projects", require("./routes/projects"));
app.use("/api/client", require("./routes/client"));

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError)
    return res.status(err.status).json({ error: err.message });
  if (err.type === "entity.parse.failed") {
    return res
      .status(400)
      .json({ error: "Request body is not valid JSON" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large" });
  }
  console.error(err);
  res.status(500).json({ error: "A server error occurred" });
});

// Only opens a port when run directly (npm run dev / npm start).
// Automated tests use the app without opening a port.
if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
    console.log(`Check database connection: http://localhost:${config.port}/health`);
    if (!config.googleApiKey) {
      console.warn(
        "[config] GOOGLE_API_KEY is not set: photos from Google Drive can't be displayed yet.",
      );
    }
  });
}

module.exports = app;
