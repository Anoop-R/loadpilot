import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load .env relative to this file so it works whether Node is started from
// the project root (npm start) or from the backend folder (npm run dev).
// __dirname in the compiled output is backend/dist/  → ../  is backend/
// __dirname in ts-node/tsx is backend/src/           → ../  is backend/
const _envBase = (process as any).pkg
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, "..");
dotenv.config({ path: path.join(_envBase, ".env") });

import resultsAnalysisRouter from "./routes/resultsAnalysis";
import correlationRouter from "./routes/correlationDetection";
import testDataRouter from "./routes/testDataGenerator";
import scriptReviewRouter from "./routes/scriptReview";
import builderRouter from "./routes/builder";
import runsRouter from "./routes/runs";
import savedConfigsRouter from "./routes/savedConfigs";
import authRouter from "./routes/auth";
import conversationalConfigRouter from "./routes/conversationalConfig";
import probeRouter from "./routes/probe";
import schedulesRouter, { initSchedules } from "./routes/schedules";
import settingsRouter from "./routes/settings";
import streamRouter from "./routes/stream";
import { connectMongo, isMongoConfigured } from "./db/mongo";

const app = express();

app.use(cors());
app.get('/health', (_req, res) => res.status(200).json({ ok: true, uptime: process.uptime() }));
app.use(express.json({ limit: "10mb" }));

app.use("/api/results-analysis", resultsAnalysisRouter);
app.use("/api/correlation", correlationRouter);
app.use("/api/test-data", testDataRouter);
app.use("/api/script-review", scriptReviewRouter);
app.use("/api/builder", builderRouter);
app.use("/api/runs", runsRouter);
app.use("/api/saved-configs", savedConfigsRouter);
app.use("/api/auth", authRouter);
app.use("/api/ai", conversationalConfigRouter);
app.use("/api/probe", probeRouter);
app.use("/api/schedules", schedulesRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/runs/:id/stream", (req: any, _res, next) => { req.params.id = req.params.id; next(); }, streamRouter);

app.get("/api/health", async (_req, res) => {
  const mongoConfigured = isMongoConfigured();
  const mongoConnected = mongoConfigured ? Boolean(await connectMongo()) : false;
  res.json({
    ok: true,
    groqKeyConfigured: Boolean(process.env.GROQ_API_KEY),
    mongoConfigured,
    mongoConnected,
  });
});

// Serve the built React frontend in production mode (when frontend/dist exists).
// In dev mode (npm run dev), Vite serves the frontend separately on port 5173.
// In production (npm start), Express serves everything on one port — teammates
// just open http://your-ip:4000, no Vite or separate frontend process needed.
const _serverBase = (process as any).pkg
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, "../..");
const frontendDist = path.join(_serverBase, "frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // For any non-API route, serve index.html so React Router works correctly
  app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  const isProduction = fs.existsSync(frontendDist);
  console.log(`LoadPilot running on http://localhost:${PORT}`);
  if (isProduction) {
    console.log(`Serving built frontend — share http://YOUR-LAN-IP:${PORT} with your team.`);
  } else {
    console.log(`Dev mode — open http://localhost:5173 (frontend on Vite).`);
  }
  if (!process.env.GROQ_API_KEY) {
    console.warn("WARNING: GROQ_API_KEY is not set. Copy .env.example to .env and add your key.");
  }
  console.log("✓ Storage: NeDB (local file database — no network needed).");
  initSchedules().catch(console.error);

  // Auto-open browser when running as packaged exe or via npm start
  const isExe = (process as any).pkg !== undefined;
  if (isExe || process.env.OPEN_BROWSER === "true") {
    setTimeout(() => {
      const url = `http://localhost:${PORT}`;
      const { spawn } = require("child_process");
      try {
        // Windows
        spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
        console.log(`Opening ${url} in browser...`);
      } catch { /* ignore */ }
    }, 1500);
  }
});
