import { Router } from "express";
import { loginOrRegister } from "../auth/userStore";
import { createSession, destroySession, extractToken, getUsernameForToken } from "../auth/sessions";
import { isMongoConfigured } from "../db/mongo";

const router = Router();

// GET /api/auth/status — whether sign-in is available at all (needs MongoDB).
router.get("/status", (_req, res) => {
  res.json({ available: isMongoConfigured() });
});

// POST /api/auth/login — logs in, or creates the account if the username is new.
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username?.trim() || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }
    const cleanUsername = username.trim();
    const result = await loginOrRegister(cleanUsername, password);
    if (!result.ok) return res.status(401).json({ error: result.error });

    const token = createSession(cleanUsername);
    res.json({ token, username: cleanUsername, isNewAccount: result.isNewAccount });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Sign-in failed" });
  }
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  destroySession(extractToken(req));
  res.json({ ok: true });
});

// GET /api/auth/me — who does this session token belong to, if anyone.
router.get("/me", (req, res) => {
  const username = getUsernameForToken(extractToken(req));
  if (!username) return res.status(401).json({ error: "Not signed in" });
  res.json({ username });
});

export default router;
