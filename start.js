#!/usr/bin/env node
const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Must be set BEFORE any child process spawns.
const NODE_OPTS = "--openssl-legacy-provider";
process.env.NODE_OPTIONS = NODE_OPTS;

const env = { ...process.env, NODE_OPTIONS: NODE_OPTS };
const opts = { stdio: "inherit", env };

// ─── Auto-setup: create .env if missing ─────────────────────────────────
const envPath = path.join(__dirname, "backend", ".env");
const envExample = path.join(__dirname, "backend", ".env.example");
if (!fs.existsSync(envPath) && fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, envPath);
  console.log("✓ Created backend\\.env from .env.example — edit it to add your GROQ_API_KEY.");
}

// ─── Auto-setup: install deps if node_modules missing ───────────────────
const rootModules   = path.join(__dirname, "node_modules");
const backendModules = path.join(__dirname, "backend", "node_modules");
const frontendModules = path.join(__dirname, "frontend", "node_modules");

if (!fs.existsSync(rootModules) || !fs.existsSync(backendModules) || !fs.existsSync(frontendModules)) {
  console.log("Installing dependencies (first run — this takes ~1 minute)...");
  execSync("npm install", { stdio: "inherit" });
  execSync("npm run install:all", { stdio: "inherit" });
  console.log("✓ Dependencies installed.");
}

// ─── Build ───────────────────────────────────────────────────────────────
console.log("Building frontend...");
execSync("npm run build --prefix frontend", opts);

console.log("Building backend...");
execSync("npm run build --prefix backend", opts);

// ─── Open JMeter GUI if available ────────────────────────────────────────
const JMETER_PATHS = [
  "C:\\Users\\Gunner\\Tools\\apache-jmeter-5.6.3\\bin\\jmeter.bat",
  "C:\\Users\\anoop\\Tools\\apache-jmeter-5.6.3\\bin\\jmeter.bat",
  "C:\\apache-jmeter-5.6.3\\bin\\jmeter.bat",
  "C:\\Tools\\apache-jmeter-5.6.3\\bin\\jmeter.bat",
];

// Also check PATH
let jmeterFound = false;
try {
  execSync("jmeter --version", { stdio: "ignore" });
  jmeterFound = true;
} catch { /* not in PATH */ }

if (!jmeterFound) {
  for (const p of JMETER_PATHS) {
    if (fs.existsSync(p)) {
      spawn("cmd", ["/c", "start", "", p], { detached: true, stdio: "ignore" });
      console.log(`✓ Opening JMeter GUI (${p})...`);
      jmeterFound = true;
      break;
    }
  }
}

if (!jmeterFound) {
  console.log("ℹ JMeter not found — you can still generate .jmx files and run them manually.");
}

// ─── Start server ─────────────────────────────────────────────────────────
console.log("Starting server...");
const server = spawn(
  process.execPath,
  [path.join(__dirname, "backend", "dist", "server.js")],
  { stdio: "inherit", env }
);

server.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT",  () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
