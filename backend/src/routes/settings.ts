import { Router } from "express";
import { getSettings, updateSettings } from "../db/settings";

const router = Router();

router.get("/", async (_req, res) => {
  try { res.json(await getSettings()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.patch("/", async (req, res) => {
  try { res.json(await updateSettings(req.body)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
