// Auto-correlation: runs a quick, one-pass "probe" through the configured
// steps (not a real load test — one user, once), captures the actual
// request/response traffic, and asks the LLM to find values that one step's
// response hands to a later step's request. This is what turns the most
// tedious part of multi-step scripting (manually finding and wiring up
// tokens) into one click.
//
// Confidence note: the probe-capture mechanism (which JMeter elements/
// properties to use) is verified the same way as everywhere else in this
// project — against real bytecode and bundled templates. What couldn't be
// verified end-to-end is an actual successful JMeter execution, for the same
// environment-specific reason documented elsewhere in this project. This is
// built defensively: any parsing failure or unexpected output just means no
// correlations get suggested, never a crash or a wrong/dangerous auto-edit.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

import { BuildConfig, buildProbeJmx, resolveSteps } from "../builders/jmxBuilder";
import { parseProbeXml, formatProbeAsTransactions } from "../utils/jtlParser";
import { buildAutoCorrelationPrompt, AutoCorrelation } from "../prompts/autoCorrelation";
import { callGroq, safeParseJson } from "../llm/groqClient";
import { detectJmeter, jmeterCommand, jmeterSpawnOptions } from "./jmeterDetect";

export interface AutoCorrelationResult {
  correlations: AutoCorrelation[];
  stepCount: number;
  log: string[];
}

const PROBE_TIMEOUT_MS = 30_000;

export async function runCorrelationProbe(
  config: BuildConfig,
  csv?: { filename: string; buffer: Buffer }
): Promise<AutoCorrelationResult> {
  const status = await detectJmeter();
  if (!status.available) {
    throw new Error(
      "Auto-correlation needs to run one real request through your steps, which requires JMeter " +
        "on this server — and none was detected. You can still wire up extraction manually using " +
        "the Correlation Detection tool."
    );
  }

  const steps = resolveSteps(config);
  if (steps.length < 2) {
    throw new Error("Auto-correlation needs at least 2 steps — add a step that might reuse a value from an earlier one.");
  }

  const dir = path.join(os.tmpdir(), `loadpilot-probe-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });

  try {
    const jmx = buildProbeJmx(config);
    fs.writeFileSync(path.join(dir, "plan.jmx"), jmx, "utf-8");
    if (csv) {
      fs.writeFileSync(path.join(dir, csv.filename), csv.buffer);
    }

    const log: string[] = [];
    await new Promise<void>((resolve, reject) => {
      let proc;
      try {
        proc = spawn(jmeterCommand(), ["-n", "-t", "plan.jmx"], { cwd: dir, ...jmeterSpawnOptions() });
      } catch (e: any) {
        return reject(new Error(`Failed to start JMeter: ${e.message}`));
      }

      const timer = setTimeout(() => {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        resolve(); // treat a hung probe as "done" — we'll report no usable results below
      }, PROBE_TIMEOUT_MS);

      proc.stdout?.on("data", (d) => log.push(...String(d).split(/\r?\n/).filter(Boolean)));
      proc.stderr?.on("data", (d) => log.push(...String(d).split(/\r?\n/).filter(Boolean)));
      proc.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`Failed to start JMeter: ${e.message}`));
      });
      proc.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const probeXmlPath = path.join(dir, "probe.xml");
    if (!fs.existsSync(probeXmlPath) || fs.statSync(probeXmlPath).size === 0) {
      throw new Error(
        "The probe run didn't produce any results — check the host/path are reachable. " +
          "Recent log lines:\n" +
          log.slice(-15).join("\n")
      );
    }

    const samples = parseProbeXml(fs.readFileSync(probeXmlPath, "utf-8"));
    if (samples.length === 0) {
      return { correlations: [], stepCount: steps.length, log: log.slice(-15) };
    }

    const transactions = formatProbeAsTransactions(samples);
    const stepLabels = steps.map((s) => s.name?.trim() || `${s.method} ${s.path}`);
    const { system, user } = buildAutoCorrelationPrompt(transactions, stepLabels);
    const result = await callGroq(system, user, { jsonMode: true, temperature: 0.2 });
    const parsed = safeParseJson<{ correlations?: AutoCorrelation[] }>(result.content);

    // Defensive filtering: only keep correlations that reference real step numbers,
    // in case the model returns something out of range.
    const correlations = (parsed.correlations || []).filter(
      (c) =>
        Number.isInteger(c.foundInStep) &&
        Number.isInteger(c.usedInStep) &&
        c.foundInStep >= 1 &&
        c.foundInStep <= steps.length &&
        c.usedInStep >= 1 &&
        c.usedInStep <= steps.length &&
        c.variableName?.trim() &&
        c.regex?.trim()
    );

    return { correlations, stepCount: steps.length, log: log.slice(-15) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
