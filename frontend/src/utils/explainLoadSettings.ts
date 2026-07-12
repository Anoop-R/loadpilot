import type { BuildConfig } from "../types";

export interface LoadSettingRow {
  label: string;
  value: string;
  meaning: string;
}

export function explainLoadSettings(config: BuildConfig): LoadSettingRow[] {
  const load = config.load;
  const testType = (config as any).testType || "load";
  const rows: LoadSettingRow[] = [];
  const users = Number(load.users) || 0;

  // Test type
  const typeLabels: Record<string, string> = {
    load: "Load test", soak: "Soak test", spike: "Spike test",
    stepup: "Step-Up test", breakpoint: "Breakpoint test",
  };
  const typeMeanings: Record<string, string> = {
    load: "Steady pressure — the same number of users ran for the full duration.",
    soak: "Long-duration test — moderate users ran for an extended period to catch gradual slowdowns and memory leaks.",
    spike: "Surge test — base load ran throughout, with a sudden burst of extra users for a short period.",
    stepup: "Staircase test — users were added in waves, showing exactly at which user count performance degrades.",
    breakpoint: "Limit-finding test — high user count run until failure appeared.",
  };
  rows.push({ label: "Test type", value: typeLabels[testType] || testType, meaning: typeMeanings[testType] || "" });

  // Users
  rows.push({
    label: "Concurrent users",
    value: String(users),
    meaning: `${users} simulated users hit the API simultaneously. ${
      users <= 5 ? "A light load — suitable for smoke testing." :
      users <= 20 ? "A moderate load — representative of normal usage." :
      users <= 50 ? "A significant load — tests how the API handles a busy period." :
      "A heavy load — stress-testing the system's limits."
    }`,
  });

  // Ramp-up
  const ramp = Number(load.rampUpSeconds) || 0;
  rows.push({
    label: "Ramp-up",
    value: `${ramp}s`,
    meaning: ramp === 0
      ? `All ${users} users started at the exact same moment — the most aggressive scenario, simulating a sudden surge.`
      : `Users were added gradually over ${ramp}s (~1 new user every ${(ramp / Math.max(users, 1)).toFixed(1)}s), giving the server time to warm up.`,
  });

  // Duration or loop count
  const loopCount = Number(load.loopCount) || 0;
  const duration = Number(load.durationSeconds) || 0;
  if (loopCount > 0) {
    rows.push({
      label: "Loop count",
      value: `${loopCount} per user`,
      meaning: loopCount === 1
        ? `Each user fired exactly one request then stopped — a single simultaneous burst. Total: ${users} requests.`
        : `Each user fired ${loopCount} requests then stopped. Total planned: ${users * loopCount} requests.`,
    });
  } else {
    rows.push({
      label: "Duration",
      value: `${duration}s (${(duration / 60).toFixed(1)} min)`,
      meaning: duration < 60
        ? "Short smoke-check duration."
        : duration < 300
        ? "Standard load test — long enough to see whether performance is stable under sustained pressure."
        : duration < 1800
        ? "Medium-duration test — good for spotting gradual degradation."
        : "Long soak test — designed to catch memory leaks and slow degradation over time.",
    });
  }

  // Pacing
  if (load.targetThroughputPerMinute) {
    rows.push({
      label: "Throughput cap",
      value: `${load.targetThroughputPerMinute} req/min`,
      meaning: `A Constant Throughput Timer kept the overall rate at ≤${load.targetThroughputPerMinute} req/min across all users. JMeter automatically adjusted wait times — so varying response times didn't cause the rate to spike above this limit.`,
    });
  } else if (load.thinkTimeMs) {
    const random = load.thinkTimeRandomMs ? ` + up to ${load.thinkTimeRandomMs}ms random` : "";
    rows.push({
      label: "Think time",
      value: `${load.thinkTimeMs}ms${random}`,
      meaning: load.thinkTimeRandomMs
        ? `Each user paused ${load.thinkTimeMs}–${load.thinkTimeMs + load.thinkTimeRandomMs}ms (randomly) between requests — simulating realistic reading time with natural variation.`
        : `Each user waited ${load.thinkTimeMs}ms between requests — simulating the time a real user takes to read a response before acting on it.`,
    });
  } else {
    rows.push({
      label: "Think time",
      value: "None (full speed)",
      meaning: "No pause between requests — each user sent the next request the moment the previous one finished. Maximum throughput from the configured user count.",
    });
  }

  // Sync timer
  if (load.syncTimer) {
    rows.push({
      label: "Synchronizing timer",
      value: `Release when ${load.syncTimer.groupSize} ready`,
      meaning: `All ${load.syncTimer.groupSize} users were held at a starting line and released simultaneously — every request fired at the exact same millisecond.`,
    });
  }

  // On failure
  const onErrorMap: Record<string, { value: string; meaning: string }> = {
    continue:    { value: "Keep going", meaning: "Failures were recorded but didn't stop the test — giving the most complete picture of error rates across the full run." },
    stopthread:  { value: "Stop that user", meaning: "When a user's request failed, that user's session ended but others kept running." },
    stoptest:    { value: "Stop whole test (graceful)", meaning: "The first failure caused the test to stop after in-flight requests finished." },
    stoptestnow: { value: "Stop whole test (immediate)", meaning: "The first failure caused the test to stop immediately, abandoning in-flight requests." },
  };
  const onErr = onErrorMap[load.onError || "continue"] || onErrorMap.continue;
  rows.push({ label: "On failure", value: onErr.value, meaning: onErr.meaning });

  return rows;
}
