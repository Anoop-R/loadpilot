/**
 * Parses JMeter's own periodic "summary +" / final "summary =" log lines for
 * a running total of completed samples and current active-thread count.
 * Real example lines this handles:
 *   "summary +    271 in 00:00:19 =   14.0/s Avg: ... Active: 5 Started: 5 Finished: 0"
 *   "summary =    487 in 00:00:30 =   16.1/s Avg: ..."
 * "summary +" lines are periodic deltas (sample count since the last line),
 * so they're summed to build a running total; a "summary =" line (only
 * present once the run has actually finished) is the authoritative grand
 * total and overrides the running sum.
 */
export interface SampleProgress {
  totalSamples: number;
  activeThreads: number | null;
  finished: boolean;
}

export function parseSampleProgress(logTail: string[]): SampleProgress {
  let total = 0;
  let active: number | null = null;
  let finished = false;

  for (const line of logTail) {
    const deltaMatch = line.match(/^summary \+\s+(\d+) in/);
    const finalMatch = line.match(/^summary =\s+(\d+) in/);
    if (deltaMatch) total += parseInt(deltaMatch[1], 10);
    if (finalMatch) {
      total = parseInt(finalMatch[1], 10);
      finished = true;
    }
    const activeMatch = line.match(/Active:\s*(\d+)/);
    if (activeMatch) active = parseInt(activeMatch[1], 10);
  }

  return { totalSamples: total, activeThreads: active, finished };
}
