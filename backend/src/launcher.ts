/**
 * launcher.ts — Entry point for the packaged .exe
 *
 * When LoadPilot is distributed as a .exe (via pkg), this file:
 * 1. Sets up the data directory relative to the exe
 * 2. Starts the Express server
 * 3. Opens the default browser to localhost:PORT
 * 4. Shows a system tray message (Windows)
 */

import { execSync, spawn } from "child_process";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// When running as exe, __dirname is the directory containing the exe
// When running via node, it's the src directory
const isExe = (process as any).pkg !== undefined;
const baseDir = isExe ? path.dirname(process.execPath) : path.join(__dirname, "..", "..");

// Load .env from same directory as exe
const envPath = path.join(baseDir, ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  // Create default .env
  const example = path.join(baseDir, ".env.example");
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, envPath);
    console.log(`✓ Created .env — please add your GROQ_API_KEY to: ${envPath}`);
  }
}

const PORT = process.env.PORT || 4000;

// Override data directory to be next to the exe
process.env.LOADPILOT_DATA_DIR = path.join(baseDir, "data");
fs.mkdirSync(process.env.LOADPILOT_DATA_DIR, { recursive: true });

// Start the server
import "./server";

// Open browser after short delay
setTimeout(() => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n✓ LoadPilot is running. Opening ${url} in your browser...`);
  
  try {
    // Windows
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
  } catch {
    console.log(`Open your browser and go to: ${url}`);
  }
}, 2000);

console.log(`
╔════════════════════════════════════════╗
║         LoadPilot is starting...       ║
║                                        ║
║  Port: ${PORT}                               ║
║  Data: ${process.env.LOADPILOT_DATA_DIR?.slice(0,30)}...  ║
╚════════════════════════════════════════╝
`);
