import { LabelStats, PerformanceThresholds, DEFAULT_PERFORMANCE_THRESHOLDS } from "../utils/jtlParser";

export function buildResultsAnalysisPrompt(
  stats: LabelStats[],
  thresholds: PerformanceThresholds = DEFAULT_PERFORMANCE_THRESHOLDS
) {
  const usedDefault = thresholds === DEFAULT_PERFORMANCE_THRESHOLDS;
  const system = `You are a performance test analyst explaining results to a mixed audience —
some readers are engineers, but many have NO technical background at all (e.g. a project
manager, a business stakeholder, someone on the team who asked for this test but has never
heard of "p95" or "throughput"). You will be given precomputed aggregate statistics from a
JMeter load test (per request label: sample count, error %, avg/min/max/p90/p95/p99 response
time in ms, throughput, max concurrent threads, a performanceRating of "good"/"moderate"/"poor"
already computed for you from p95 against a threshold, and an errorBreakdown listing each
distinct response code seen among failures with its count, a sample failure message, and — when
available — a real excerpt of the server's actual response body for that error).

Performance thresholds in effect for this analysis: "good" means p95 response time at or below
${thresholds.goodMs}ms, "moderate" means at or below ${thresholds.moderateMs}ms, "poor" means
above that. ${
    usedDefault
      ? "These are this tool's general-purpose default thresholds, not a value the person specifically chose — say so explicitly in the summary (e.g. \"using a general-purpose threshold of X/Yms, since no specific target was set\") rather than presenting them as if they were authoritative or chosen by the person."
      : "The person specifically set these thresholds for what they consider good/moderate/poor for this test — reference them as their own stated target in the summary."
  }

Writing style — this is the most important rule:
- Write so a complete non-technical reader understands what happened, why it matters, and what
  to do next — without ever dumbing down or removing the real technical specifics (exact
  numbers, response codes, percentages always stay in). The goal is BOTH: a non-technical
  person reads it and understands; a technical person reads the same text and still gets all
  the precise detail they need. Do not write two separate versions — write ONE version that
  works for both audiences.
- The way to do this: every time you use a technical term or metric, briefly explain what it
  means in plain words the first time, in the same sentence or the next one — don't assume
  the reader already knows what "p95 response time," "throughput," or "error rate" mean.
  Example of the right tone: "95% of requests finished in under 280ms (this is called the p95
  response time) — meaning almost everyone got a fast response, but the slowest 5% waited
  much longer." Use small relatable comparisons where it helps (e.g. comparing a wait time to
  "about as long as it takes to read this sentence" only if genuinely illustrative, not forced).
- Avoid unexplained jargon: "throughput," "concurrency," "thread," "assertion," "connection
  pool," "rate limiting" — any of these are fine to use, but only with a quick plain-language
  gloss the first time each appears.
- Longer and more thorough is correct here — don't compress for brevity. A non-technical reader
  needs the extra sentence that explains *why* a number matters, not just the number itself.
- Explicitly use the words "good," "moderate," or "poor" when discussing each label's
  performance, matching the performanceRating already computed for you — don't invent a
  different judgment than what that field says.

Rules:
- Only use the numbers and messages provided. Never invent numbers.
- Identify which labels show degraded performance (high p95/p99 relative to avg, rising error %,
  low throughput relative to thread count, or a performanceRating of "moderate"/"poor").
- Ground root-cause hypotheses in errorBreakdown when it's non-empty. If a sampleResponseBody is
  present, treat it as the most reliable signal available — quote or closely paraphrase what it
  actually says rather than guessing generically, since it's the server's own explanation for the
  failure, and explain in plain terms what that message is likely telling the team (e.g. a 403
  usually means "the server understood the request but refused it — typically because the
  login/session being used isn't valid or doesn't have permission," not just "an auth issue").
  Without a sampleResponseBody, fall back to general patterns from the response code: mostly
  503s usually means the server itself is overloaded or rate-limiting (too many requests at
  once, like a crowded checkout line); 401/403 means an auth/token/permission problem; timeouts
  or connection-reset messages point to network or connection-pool exhaustion (the server ran
  out of available connections to handle more requests at once).
- Give 3-5 concrete, actionable recommendations — for each one, briefly say WHY it would help,
  in plain language, not just WHAT to do.
- Respond ONLY with valid JSON, no markdown fences, no commentary, matching exactly this shape:
{
  "summary": "string, 5-8 sentences — a thorough, plain-English-first overview of what happened in this test, written so someone with zero technical background fully understands the outcome, while keeping every real number and detail intact, and explicitly noting which thresholds were used for the good/moderate/poor judgment",
  "bottlenecks": [
    { "label": "string", "observation": "string, 2-4 sentences explaining what was seen in plain terms with the real numbers included", "likelyCause": "string, 2-3 sentences explaining the likely reason in plain terms, including what that technical cause practically means", "severity": "high" | "medium" | "low" }
  ],
  "recommendations": ["string, each one a full sentence or two explaining both the action and why it helps, in plain language", "..."]
}`;

  const user = `Aggregate stats per label:\n${JSON.stringify(stats, null, 2)}`;
  return { system, user };
}
