import { Router } from "express";
import { randomUUID } from "crypto";
import cron from "node-cron";
import { getConfigsDb, dbFind, dbInsert, dbUpdate, dbDelete, dbFindOne } from "../db/nedb";
import { createRun } from "../runs/runManager";

const router = Router();

export interface Schedule {
  id: string;
  name: string;
  config: any;
  cronExpr: string;    // e.g. "0 2 * * *" = 2am daily
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastRunId?: string;
  nextRunAt?: string;
}

function getSchedulesDb() { return getConfigsDb(); }

function computeNextRun(cronExpr: string): string | undefined {
  try {
    const interval = cron.schedule(cronExpr, () => {});
    // node-cron doesn't expose nextDate() easily — compute approximate next
    const now = new Date();
    // Return a human-readable approximation
    return undefined;
  } catch { return undefined; }
}

// Active cron jobs map
const jobs = new Map<string, ReturnType<typeof cron.schedule>>();

export async function initSchedules() {
  const schedules = await dbFind<Schedule & { _type: string }>(getSchedulesDb(), { _type: "schedule", enabled: true });
  for (const s of schedules) {
    startJob(s);
  }
  if (schedules.length > 0) {
    console.log(`✓ Loaded ${schedules.length} scheduled run(s).`);
  }
}

function startJob(s: Schedule) {
  if (jobs.has(s.id)) jobs.get(s.id)!.stop();
  if (!cron.validate(s.cronExpr)) return;

  const job = cron.schedule(s.cronExpr, async () => {
    console.log(`[Schedule] Running "${s.name}"...`);
    try {
      const run = await createRun(s.config, undefined, `schedule:${s.id}`);
      await dbUpdate(getSchedulesDb(), { id: s.id }, {
        $set: { lastRunAt: new Date().toISOString(), lastRunId: run.id }
      });
      console.log(`[Schedule] "${s.name}" started as run ${run.id}`);
    } catch (err: any) {
      console.error(`[Schedule] "${s.name}" failed: ${err.message}`);
    }
  });

  jobs.set(s.id, job);
}

// GET /api/schedules
router.get("/", async (_req, res) => {
  try {
    const all = await dbFind<Schedule & { _type: string }>(getSchedulesDb(), { _type: "schedule" }, { createdAt: -1 });
    res.json(all.map(({ _id, _type, ...rest }: any) => rest));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/schedules
router.post("/", async (req, res) => {
  try {
    const { name, config, cronExpr, enabled = true } = req.body;
    if (!name || !config || !cronExpr) return res.status(400).json({ error: "name, config, cronExpr required" });
    if (!cron.validate(cronExpr)) return res.status(400).json({ error: `Invalid cron expression: "${cronExpr}"` });

    const schedule: Schedule & { _type: string } = {
      _type: "schedule", id: randomUUID(), name, config, cronExpr,
      enabled, createdAt: new Date().toISOString(),
    };
    await dbInsert(getSchedulesDb(), schedule);
    if (enabled) startJob(schedule);
    const { _type, ...result } = schedule as any;
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/schedules/:id — enable/disable/update
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const patch = req.body;
    await dbUpdate(getSchedulesDb(), { id, _type: "schedule" }, { $set: patch });
    const updated = await dbFindOne<Schedule & { _type: string }>(getSchedulesDb(), { id });
    if (!updated) return res.status(404).json({ error: "Not found" });

    if (updated.enabled) startJob(updated);
    else { jobs.get(id)?.stop(); jobs.delete(id); }

    const { _type, ...result } = updated as any;
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/schedules/:id
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    jobs.get(id)?.stop();
    jobs.delete(id);
    await dbDelete(getSchedulesDb(), { id, _type: "schedule" });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
