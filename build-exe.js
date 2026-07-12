#!/usr/bin/env node
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = __dirname;
const RELEASE = path.join(ROOT, "release");

try {
  console.log("Building LoadPilot .exe...\n");

  console.log("Step 1/4: Building frontend...");
  execSync("npm run build --prefix frontend", { stdio: "inherit", cwd: ROOT });

  console.log("\nStep 2/4: Building backend...");
  execSync("npm run build --prefix backend", { stdio: "inherit", cwd: ROOT });

  console.log("\nStep 3/4: Preparing release folder...");
  if (fs.existsSync(RELEASE)) fs.rmSync(RELEASE, { recursive: true });
  fs.mkdirSync(RELEASE, { recursive: true });
  fs.mkdirSync(path.join(RELEASE, "data"), { recursive: true });

  // Copy frontend dist next to exe — server.ts looks for this at exe location
  fs.cpSync(
    path.join(ROOT, "frontend", "dist"),
    path.join(RELEASE, "frontend", "dist"),
    { recursive: true }
  );

  // Copy .env.example
  fs.copyFileSync(
    path.join(ROOT, "backend", ".env.example"),
    path.join(RELEASE, ".env.example")
  );

  // Copy node_modules that pkg can't bundle (native modules)
  const nativeModules = ["@seald-io/nedb"];
  for (const mod of nativeModules) {
    const src = path.join(ROOT, "backend", "node_modules", mod);
    const dst = path.join(RELEASE, "node_modules", mod);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dst, { recursive: true });
    }
  }

  // Write README
  fs.writeFileSync(path.join(RELEASE, "README.txt"),
`LoadPilot - Quick Start
========================
1. Copy .env.example to .env
2. Add your GROQ_API_KEY to .env
3. Double-click LoadPilot.exe
4. Browser opens at http://localhost:4000

Run history is saved in the data\\ folder.
`);

  console.log("\nStep 4/4: Creating LoadPilot.exe...");
  execSync(
    `npx pkg backend\\dist\\server.js ` +
    `--targets node18-win-x64 ` +
    `--output release\\LoadPilot.exe ` +
    `--public`,
    { stdio: "inherit", cwd: ROOT }
  );

  const exePath = path.join(RELEASE, "LoadPilot.exe");
  if (fs.existsSync(exePath)) {
    const size = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
    console.log(`\n✅ Done! LoadPilot.exe created (${size} MB)`);
    console.log(`📁 Release folder: ${RELEASE}`);
  } else {
    console.error("❌ LoadPilot.exe was not created.");
    process.exit(1);
  }
} catch (err) {
  console.error("\n❌ Build failed:", err.message);
  process.exit(1);
}
