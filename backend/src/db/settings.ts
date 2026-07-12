/**
 * App-wide settings store backed by NeDB.
 * Stores key-value pairs for configuration that persists across restarts.
 * Used for: distributed JMeter agent IPs, default thresholds, etc.
 */

import { getConfigsDb, dbFindOne, dbUpsert } from "./nedb";

export interface AppSettings {
  remoteAgents: string[];
  defaultGoodMs: number;
  defaultAcceptableMs: number;
  timezone: string;
  maxConcurrentRuns: number;
  datadogApiKey?: string;
  datadogSite?: string;
  newrelicLicenseKey?: string;
  metricsWebhookUrl?: string;
}

const DEFAULTS: AppSettings = {
  remoteAgents: [],
  defaultGoodMs: 2000,
  defaultAcceptableMs: 5000,
  timezone: "Asia/Kolkata",
  maxConcurrentRuns: 3,
};

const SETTINGS_KEY = "app_settings";

export async function getSettings(): Promise<AppSettings> {
  const db = getConfigsDb();
  const doc = await dbFindOne<{ _type: string; data: AppSettings }>(db, { _type: SETTINGS_KEY });
  if (!doc) return { ...DEFAULTS };
  return { ...DEFAULTS, ...doc.data };
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const updated = { ...current, ...patch };
  const db = getConfigsDb();
  await dbUpsert(db, { _type: SETTINGS_KEY }, { _type: SETTINGS_KEY, data: updated });
  return updated;
}

