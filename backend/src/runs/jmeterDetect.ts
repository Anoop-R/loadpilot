import { spawn } from "child_process";

export interface JmeterStatus {
  available: boolean;
  version?: string;
  error?: string;
}

/**
 * On Windows, JMeter's launcher is "jmeter.bat", not "jmeter" — Node's spawn()
 * needs the extension spelled out explicitly to find and run it correctly,
 * even when its folder is on PATH. On macOS/Linux the launcher has no extension.
 */
export function jmeterCommand(): string {
  return process.platform === "win32" ? "jmeter.bat" : "jmeter";
}

/**
 * On Windows, spawning a .bat file without going through a shell throws
 * "spawn EINVAL" — CreateProcess can't execute a batch file directly. shell:true
 * routes it through cmd.exe instead, which can. Not needed on macOS/Linux, where
 * the plain "jmeter" launcher script is directly executable.
 */
export function jmeterSpawnOptions() {
  return { shell: process.platform === "win32" };
}

let cached: JmeterStatus | null = null;

export function detectJmeter(forceRefresh = false): Promise<JmeterStatus> {
  if (cached && !forceRefresh) return Promise.resolve(cached);

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(jmeterCommand(), ["--version"], jmeterSpawnOptions());
    } catch (e: any) {
      cached = { available: false, error: `Could not launch JMeter: ${e.message}` };
      return resolve(cached);
    }

    let out = "";
    let err = "";

    proc.stdout?.on("data", (d) => (out += d.toString()));
    proc.stderr?.on("data", (d) => (err += d.toString()));

    proc.on("error", (e) => {
      cached = { available: false, error: `JMeter is not installed or not on PATH (${e.message}).` };
      resolve(cached);
    });

    proc.on("close", (code) => {
      if (code === 0 || /Version/i.test(out + err)) {
        const match = (out + err).match(/Version\s+([0-9.]+)/i);
        cached = { available: true, version: match ? match[1] : undefined };
      } else {
        cached = { available: false, error: `jmeter --version exited with code ${code}` };
      }
      resolve(cached);
    });
  });
}
