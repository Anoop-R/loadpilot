import { Router } from "express";
import {
  listSavedConfigs,
  getSavedConfig,
  createSavedConfig,
  updateSavedConfig,
  deleteSavedConfig,
} from "../savedConfigs/savedConfigsStore";
import { BuildConfig } from "../builders/jmxBuilder";
import { extractToken, getUsernameForToken } from "../auth/sessions";

const router = Router();

// GET /api/saved-configs
router.get("/", async (_req, res) => {
  try {
    res.json(await listSavedConfigs());
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to list saved configs" });
  }
});

// GET /api/saved-configs/:id
router.get("/:id", async (req, res) => {
  try {
    const record = await getSavedConfig(req.params.id);
    if (!record) return res.status(404).json({ error: "Saved config not found" });
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to load saved config" });
  }
});

// POST /api/saved-configs   body: { name, config }
router.post("/", async (req, res) => {
  try {
    const { name, config } = req.body as { name?: string; config?: BuildConfig };
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    if (!config) return res.status(400).json({ error: "Config is required" });
    const createdBy = getUsernameForToken(extractToken(req)) || undefined;
    res.json(await createSavedConfig(name.trim(), config, createdBy));
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to save config" });
  }
});

// PUT /api/saved-configs/:id   body: { name, config }
router.put("/:id", async (req, res) => {
  try {
    const { name, config } = req.body as { name?: string; config?: BuildConfig };
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    if (!config) return res.status(400).json({ error: "Config is required" });
    const record = await updateSavedConfig(req.params.id, name.trim(), config);
    if (!record) return res.status(404).json({ error: "Saved config not found" });
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update config" });
  }
});

// DELETE /api/saved-configs/:id
router.delete("/:id", async (req, res) => {
  try {
    const ok = await deleteSavedConfig(req.params.id);
    if (!ok) return res.status(404).json({ error: "Saved config not found" });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to delete config" });
  }
});

export default router;
