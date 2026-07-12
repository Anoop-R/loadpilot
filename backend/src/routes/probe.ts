import { Router } from "express";
import https from "https";
import http from "http";
import { URL } from "url";

const router = Router();

interface ProbeRequest {
  protocol: string;
  domain: string;
  port?: number;
  path: string;
  method: string;
  headers: { name: string; value: string }[];
  body?: string;
}

// POST /api/probe — fire a single real HTTP request and return the result
router.post("/", async (req, res) => {
  const { protocol, domain, port, path, method, headers, body } = req.body as ProbeRequest;

  if (!domain || !method) {
    return res.status(400).json({ error: "domain and method are required." });
  }

  const url = `${protocol || "https"}://${domain}${port ? `:${port}` : ""}${path || "/"}`;

  try {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "LoadPilot/1.0 (probe)",
    };
    for (const h of headers || []) {
      if (h.name && h.value) reqHeaders[h.name] = h.value;
    }

    const startMs = Date.now();

    await new Promise<void>((resolve, reject) => {
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: method.toUpperCase(),
        headers: reqHeaders,
        timeout: 30000,
        // Skip cert verification for internal/dev endpoints
        rejectUnauthorized: false,
      };

      const reqObj = lib.request(options, (probeRes) => {
        let data = "";
        probeRes.on("data", chunk => { data += chunk; if (data.length > 50000) data = data.slice(0, 50000); });
        probeRes.on("end", () => {
          const durationMs = Date.now() - startMs;
          res.json({
            ok: true,
            status: probeRes.statusCode,
            statusText: probeRes.statusMessage,
            headers: probeRes.headers,
            body: data,
            durationMs,
            url,
          });
          resolve();
        });
      });

      reqObj.on("error", reject);
      reqObj.on("timeout", () => { reqObj.destroy(); reject(new Error("Request timed out after 30s")); });

      if (body && method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") {
        reqObj.write(body);
      }
      reqObj.end();
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || "Probe request failed" });
  }
});

export default router;
