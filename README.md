# LoadPilot — Load Testing, Made Simple

AI-powered load testing built on JMeter. No JMeter knowledge needed.

---

## First-time setup (do this once per machine)

### 1. Extract the zip

Extract `jmeter-llm-toolkit.zip` to a folder. Recommended paths:

| Instance | Path |
|---|---|
| Shared (team) | `C:\LoadPilot\v28\jmeter-llm-toolkit\` |
| Dev (personal) | `C:\LoadPilot\dev\jmeter-llm-toolkit\` |

### 2. Create your `.env` file

Inside the `backend\` folder, create a file called `.env`:

```env
GROQ_API_KEY=your_groq_api_key_here
PORT=4000
```

Get a free Groq API key at https://console.groq.com

**For dev instance only**, change the port:
```env
PORT=4001
```

### 3. Add JMeter to PATH

Run this once in PowerShell (no admin needed — sets for your user only):

```powershell
[System.Environment]::SetEnvironmentVariable(
  "Path",
  $env:Path + ";C:\Users\YourName\Tools\apache-jmeter-5.6.3\bin",
  "User"
)
```

Replace the path with wherever JMeter is installed. Then close and reopen VS Code.

### 4. Install dependencies

```powershell
cd "C:\LoadPilot\v28\jmeter-llm-toolkit"
npm install
npm run install:all
```

### 5. Start the app

```powershell
npm start
```

Open http://localhost:4000 in your browser.

---

## Running two instances (team + personal dev)

### Shared team instance (port 4000)

```powershell
cd "C:\LoadPilot\v28\jmeter-llm-toolkit"
npm start
```

Share `http://YOUR-LAN-IP:4000` with teammates.
Find your LAN IP: run `ipconfig` and look for IPv4 Address.

### Personal dev instance (port 4001)

```powershell
cd "C:\LoadPilot\dev\jmeter-llm-toolkit"
npm start
```

Access at `http://localhost:4001` — only you can reach this.

The two instances share nothing by default. Run history is stored in
`backend\data\` inside each folder separately.

---

## Daily workflow

### Starting up

Open VS Code → open a terminal → navigate to your project folder → `npm start`.

Keep the terminal open while using the app. Closing it stops the server.

### Shutting down

Press `Ctrl+C` in the terminal running the server.

### npm start vs npm run dev

| Command | When to use |
|---|---|
| `npm start` | Production — builds everything, serves on the port. Use this for the shared team instance. |
| `npm run dev` | Development — hot reload on save, Vite serves frontend on :5173. Use this when actively making code changes. |

---

## Updating to a new version

### Shared team instance

```powershell
# 1. Stop the server (Ctrl+C)

# 2. Back up the old version
Rename-Item "C:\LoadPilot\v28" "C:\LoadPilot\v28-backup"

# 3. Extract new zip to C:\LoadPilot\v28\

# 4. Copy your .env across
Copy-Item "C:\LoadPilot\v28-backup\jmeter-llm-toolkit\backend\.env" `
          "C:\LoadPilot\v28\jmeter-llm-toolkit\backend\.env"

# 5. Copy run history across (so teammates don't lose their history)
Copy-Item "C:\LoadPilot\v28-backup\jmeter-llm-toolkit\backend\data" `
          "C:\LoadPilot\v28\jmeter-llm-toolkit\backend\" -Recurse -Force

# 6. Install and start
cd "C:\LoadPilot\v28\jmeter-llm-toolkit"
npm install && npm run install:all
npm start
```

### Dev instance

```powershell
# Same steps but use C:\LoadPilot\dev\ and keep PORT=4001 in .env
```

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `1` | Build & Run |
| `2` | Run Report |
| `3` | Results Analysis |
| `4` | Correlation |
| `5` | Test Data |
| `6` | Script Review |
| `7` | Learn Concepts |
| `T` | Toggle dark/light theme |
| `[` | Collapse/expand sidebar |
| `?` | Show shortcut help |

---

## CI/CD integration

### Trigger a run via API

```bash
curl -X POST http://YOUR-SERVER:4000/api/runs/trigger \
  -H "Content-Type: application/json" \
  -d '{"savedConfigId": "YOUR-CONFIG-UUID", "waitForCompletion": true}'
```

Returns: `{ runId, status, pollUrl, reportUrl }`

### GitHub Actions

Copy `.github/workflows/load-test.yml` from this repo into your project.
Add two GitHub Secrets:
- `LOADPILOT_URL` — e.g. `http://192.168.1.100:4000`
- `LOADPILOT_CONFIG_ID` — UUID of a saved config in LoadPilot

The workflow triggers on push to main, downloads the HTML report, and uploads it as a build artifact.

---

## Troubleshooting

### "GROQ_API_KEY is not set"
The `.env` file is missing or in the wrong folder.
It must be at `backend\.env` (not the root folder).
Run: `Test-Path "backend\.env"` — should say `True`.

### "JMeter was not found"
JMeter's `bin` folder is not in PATH.
Run: `jmeter --version` to check. If not found, repeat step 3 of setup.

### Run history disappeared after update
Copy the `backend\data\` folder from the old version to the new one.
See "Updating to a new version" above.

### Port already in use
Another process is using port 4000 (or 4001).
Find it: `netstat -ano | findstr :4000`
Kill it: `taskkill /PID <PID> /F`
Or change PORT in `.env`.

### App loads but AI features don't work
Check your Groq API key is valid at https://console.groq.com
The key starts with `gsk_`.

---

## Data locations

| Data | Location |
|---|---|
| Run history | `backend\data\runs.db` |
| Saved configs | `backend\data\savedConfigs.db` |
| Schedules | `backend\data\savedConfigs.db` (same file, different type) |
| JMeter run files | `backend\data\<run-id>\` |
| App settings | `backend\data\savedConfigs.db` |

To back up everything: copy the entire `backend\data\` folder.
To start fresh: delete `backend\data\` (run history and saved configs will be lost).

---

## Architecture

```
loadpilot/
├── backend/          Node/Express/TypeScript — API, JMeter execution, AI
│   ├── src/
│   │   ├── builders/ JMX file generation (HTTP, WebSocket, gRPC)
│   │   ├── db/       NeDB storage + settings
│   │   ├── prompts/  Groq AI prompts
│   │   ├── reports/  HTML report generation
│   │   ├── routes/   REST API endpoints
│   │   └── runs/     JMeter process management + SSE streaming
│   └── data/         Run history + configs (created on first run)
├── frontend/         React/Vite/TypeScript — the UI
│   └── src/
│       ├── components/ All UI components
│       └── utils/      Assertion parsing, load settings, JWT check
├── .github/
│   └── workflows/    GitHub Actions CI/CD templates
├── start.js          Production launcher
└── README.md         This file
```

Generated by LoadPilot. Built with JMeter, Groq, React, Express, NeDB.
