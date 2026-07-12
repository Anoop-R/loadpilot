import { BuildConfig, BuildStep } from "./types";

/** Mirrors the backend's resolveSteps() — normalizes a legacy single-request config into a one-step list. */
export function resolveSteps(config: BuildConfig): BuildStep[] {
  if (config.steps && config.steps.length > 0) return config.steps;
  return [
    {
      name: config.testName,
      method: config.method || "GET",
      path: config.path || "/",
      headers: config.headers || [],
      body: config.body,
      assertions: config.assertions,
    },
  ];
}
