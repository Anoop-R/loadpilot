import { useState } from "react";

const CHAT_HISTORY_KEY = "loadpilot_concepts_search";

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((p, i) =>
    p.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="concept-highlight-match">{p}</mark>
      : p
  );
}

function Card({ title, emoji, children, search }: {
  title: string;
  emoji: string;
  children: React.ReactNode;
  search: string;
}) {
  const [open, setOpen] = useState(true);
  const q = search.trim().toLowerCase();

  // Determine if this card contains any matching text
  const cardText = typeof children === "string" ? children : "";
  const titleMatches = !q || title.toLowerCase().includes(q);

  // For filtering, we check the card title and let content show if title matches
  // Cards always show when search is empty
  if (q && !titleMatches) {
    // Check if any visible text in the subtree could match — we do this by
    // rendering nothing and letting parent decide; simpler: just check title
    // since sections inside handle their own visibility
    return null;
  }

  return (
    <div className="concepts-card">
      <button className="concepts-card-header" onClick={() => setOpen(v => !v)}>
        <span className="concepts-card-title">
          <span>{emoji}</span>
          {highlight(title, search)}
        </span>
        <span className="concepts-chevron">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="concepts-card-body">{children}</div>}
    </div>
  );
}

function Term({ term, children, search }: {
  term: string;
  children: React.ReactNode;
  search: string;
}) {
  const q = search.trim().toLowerCase();
  const termText = term.toLowerCase();
  const childText = typeof children === "string" ? children.toLowerCase() : "";
  if (q && !termText.includes(q) && !childText.includes(q)) return null;

  return (
    <div className="concept-term">
      <div className="concept-term-name">{highlight(term, search)}</div>
      <div className="concept-term-def">{children}</div>
    </div>
  );
}

function TestTypeRow({ name, emoji, when, shape, example, search }: {
  name: string; emoji: string; when: string; shape: string; example: string; search: string;
}) {
  const q = search.trim().toLowerCase();
  const allText = [name, when, shape, example].join(" ").toLowerCase();
  if (q && !allText.includes(q)) return null;

  return (
    <div className="test-type-row">
      <div className="test-type-header"><span>{emoji}</span><strong>{highlight(name, search)}</strong></div>
      <div className="test-type-meta"><span className="concept-label">Use when</span>{when}</div>
      <div className="test-type-meta"><span className="concept-label">Load shape</span>{shape}</div>
      <div className="test-type-meta concept-example">"{example}"</div>
    </div>
  );
}

function FailurePattern({ name, symptoms, cause, fix, search }: {
  name: string; symptoms: string; cause: string; fix: string; search: string;
}) {
  const q = search.trim().toLowerCase();
  const allText = [name, symptoms, cause, fix].join(" ").toLowerCase();
  if (q && !allText.includes(q)) return null;

  return (
    <div className="failure-pattern">
      <div className="failure-name">{highlight(name, search)}</div>
      <div className="failure-row"><span className="concept-label">Symptoms</span>{symptoms}</div>
      <div className="failure-row"><span className="concept-label">Likely cause</span>{cause}</div>
      <div className="failure-row"><span className="concept-label">What to investigate</span>{fix}</div>
    </div>
  );
}

const ALL_CARDS = [
  "What is load testing?",
  "Key metrics — what the numbers mean",
  "Test types — pick the right tool",
  "Reading your results",
  "Common failure patterns",
  "JMeter concepts — demystified",
  "Server-side monitoring",
  "What to do with your results",
];

export default function ConceptsTab() {
  const [search, setSearch] = useState("");
  const s = search; // alias for readability in JSX

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Performance Testing Concepts</h2>
        <p className="muted">
          Everything you need to understand load testing — from basic terms to advanced patterns —
          explained in plain English with real examples from production API testing.
        </p>
        <div className="concepts-search-row">
          <input
            className="concepts-search"
            placeholder="Search concepts… e.g. p95, spike, throughput, 502"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoComplete="off"
          />
          {search && (
            <button className="small" onClick={() => setSearch("")}>Clear</button>
          )}
        </div>
      </div>

      <Card title="What is load testing?" emoji="🎯" search={s}>
        <p className="concept-intro">
          Load testing checks how your API behaves when multiple people use it at the same time.
          A single user testing an endpoint tells you nothing about what happens when 10, 40, or 100 people
          all send requests simultaneously — the server might slow down, run out of memory, or start rejecting requests entirely.
        </p>
        <p className="concept-intro">
          Think of it like a coffee shop: one customer is easy. What happens when 20 walk in at once?
          Load testing is how you find out before your real users do.
        </p>
        <div className="concept-highlight">
          <strong>The core question load testing answers:</strong> "At what point does my API start struggling,
          and what does that look like to end users?"
        </div>
        <Term term="Why test before production?" search={s}>
          Finding a performance problem in testing costs an hour of your time. Finding it in production costs
          user trust, revenue, and potentially customer data. Load testing is cheap insurance.
        </Term>
        <Term term="What counts as 'good performance'?" search={s}>
          There's no universal answer — it depends entirely on what your API does. A search autocomplete should
          respond in under 200ms. An AI query that processes complex data might reasonably take 15 seconds.
          The right number is whatever your actual users consider acceptable for that specific action.
        </Term>
      </Card>

      <Card title="Key metrics — what the numbers mean" emoji="📊" search={s}>
        <Term term="Response time" search={s}>
          How long it takes from sending a request to receiving the complete response. Measured in milliseconds.
          <em>1000ms = 1 second. 30000ms = 30 seconds.</em>
        </Term>
        <Term term="p50 / p90 / p95 / p99 (percentiles)" search={s}>
          "p95 = 800ms" means 95% of requests finished in 800ms or faster — and 5% took longer.
          p95 is the most useful metric because it shows what almost every user experiences.
          <em>Averages hide slow outliers. Percentiles expose them.</em>
        </Term>
        <Term term="Why averages are misleading" search={s}>
          If 99 requests take 100ms and 1 takes 10,000ms, the average is 199ms. But 1% of your users waited 10 seconds.
          That 1% might be your most important users. Always look at p95 and p99, not just average.
          <em>A good p50 with a terrible p99 is a hidden problem waiting to surface.</em>
        </Term>
        <Term term="Throughput" search={s}>
          How many requests the server handles per second (req/s) or per minute (RPM).
          If throughput drops under load while users increase, the server is queuing requests — it can't keep up.
          <em>Watch for: throughput stops increasing even as you add more users → you've hit the server's ceiling.</em>
        </Term>
        <Term term="Error rate" search={s}>
          The percentage of requests that failed. Under normal load, this should be near 0%.
          Rising errors under load usually mean the server is at its limit and starting to reject requests.
          <em>Even 1% errors means 1 in 100 of your users saw a failure. At 10,000 req/min that's 100 failures per minute.</em>
        </Term>
        <Term term="Concurrent users" search={s}>
          How many simulated users are actively making requests at the same time. This is your primary
          load control — increasing this is how you stress-test the system.
          <em>Not the same as total users of your app. Concurrent = actively hitting the server right now.</em>
        </Term>
        <Term term="Ramp-up time" search={s}>
          How gradually users come online. 10 users with 10s ramp-up = 1 new user per second.
          Ramp-up simulates natural traffic buildup and gives servers time to warm up.
          <em>0 ramp-up = all users hit simultaneously = the most aggressive scenario.</em>
        </Term>
        <Term term="Think time" search={s}>
          The pause between a user receiving a response and sending the next request — simulating reading time,
          clicking around, filling in a form. Without think time, JMeter hammers as fast as possible.
          <em>For AI endpoints where users wait for the response before doing anything: think time = 0 is often realistic.</em>
        </Term>
        <Term term="p95 vs p99 — which matters more?" search={s}>
          p95 = "what almost all users experience." p99 = "what the slowest 1% experience."
          For AI endpoints with variable processing times, p99 can be 3–5x higher than p95.
          <em>Rule of thumb: optimize for p95 first. Alert on p99. Never ignore either.</em>
        </Term>
      </Card>

      <Card title="Test types — pick the right tool for the question" emoji="🧪" search={s}>
        <TestTypeRow name="Load test" emoji="🔵" search={s}
          when="You want to verify the system handles your expected peak traffic without degrading."
          shape="Steady users → constant load for a fixed duration."
          example="10 users for 2 minutes — does the AI chatbot handle simultaneous team queries?" />
        <TestTypeRow name="Soak test (endurance)" emoji="🟡" search={s}
          when="You want to find problems that only appear over hours — memory leaks, connection pool exhaustion, gradual slowdown."
          shape="Moderate users → runs for 4–8+ hours. Watch for response times that gradually climb."
          example="5 users for 4 hours overnight — does response time stay consistent or slowly get worse?" />
        <TestTypeRow name="Spike test" emoji="🔴" search={s}
          when="You want to know if the system can handle a sudden unexpected burst of traffic and recover afterward."
          shape="Base load + a sharp spike of extra users for a short period, then back to base."
          example="5 users normal, then 40 users for 60 seconds (simulating everyone joining a meeting), then back to 5." />
        <TestTypeRow name="Step-Up test (staircase)" emoji="🟢" search={s}
          when="You want to find exactly at which user count performance starts degrading — your system's capacity limit."
          shape="Users increase in equal steps at regular intervals. Look at where response time jumps."
          example="10 → 20 → 30 → 40 users, each step lasting 60 seconds. The step where errors appear is your limit." />
        <TestTypeRow name="Breakpoint test" emoji="⚫" search={s}
          when="You want to find the absolute maximum — run until something breaks, observe what breaks first."
          shape="High user count, very long duration. Stop manually when failures climb above your threshold."
          example="100 users, 1 hour. Watch the Run Report live and note when error rate first exceeds 1%." />
        <div className="concept-highlight" style={{ marginTop: 16 }}>
          <strong>Decision guide:</strong> Start every new API with a Load test. Add a Soak test overnight once it passes.
          Use Step-Up for capacity planning. Use Spike if your service sees predictable bursts (events, launches, morning rush).
          Breakpoint is for when you need a hard number to put in a capacity report.
        </div>
      </Card>

      <Card title="Reading your results — what to look for" emoji="🔍" search={s}>
        <Term term="The chart vs the table" search={s}>
          The table shows aggregate numbers for the whole run. The chart shows how performance changed over time.
          A great average can hide a disaster — the chart reveals if performance degraded during the test
          or if there was a burst of errors at a specific moment.
          <em>Always check the chart shape first, then the table numbers.</em>
        </Term>
        <Term term="What a good result looks like" search={s}>
          Error rate under 1%, p95 response time within your threshold, throughput stable throughout.
          The chart shows a flat line — no gradual worsening, no spikes.
        </Term>
        <Term term="Warning signs" search={s}>
          Slowly increasing response time (line curves upward over time), error rate above 1%,
          throughput lower than expected, p99 significantly higher than p95.
          <em>Gradual slowdown = likely a resource leak. Sudden jump = hitting a capacity limit.</em>
        </Term>
        <Term term="Throughput drop under load" search={s}>
          If throughput drops as users increase, the server is queuing requests it can't process fast enough.
          Response times will also be rising at this point.
          <em>Throughput ceiling = the server's effective capacity limit for this workload.</em>
        </Term>
        <Term term="The 'fast but wrong' trap" search={s}>
          A server can return HTTP 200 (success) with an error message inside the body.
          Without a JSON Path assertion checking the response content, those requests look like successes
          in your results even though they failed. Always assert on content, not just status code.
        </Term>
        <Term term="Interpreting the Calls view" search={s}>
          The Calls view shows every individual request. Click a failed row to see the actual server response body —
          this usually tells you exactly why the request failed. Sort by Failed to see patterns:
          are all failures hitting one specific step? Are they clustered at a specific time in the run?
        </Term>
      </Card>

      <Card title="Common failure patterns and what they mean" emoji="🚨" search={s}>
        <FailurePattern search={s}
          name="502 Bad Gateway — errors appear immediately at low user count"
          symptoms="Requests fail instantly with 502 (not slow — fast failures, 1-2s). Error rate is high even with few users."
          cause="The server crashed, the Lambda function exceeded concurrency or timeout, or the API gateway can't reach the backend."
          fix="Check Lambda CloudWatch logs for the actual error. Check concurrency settings. Check if the function timeout is shorter than the AI's processing time." />
        <FailurePattern search={s}
          name="Gradual response time increase over the run"
          symptoms="p95 starts at 5s, climbs to 15s, then 30s during a 10-minute test — but error rate stays low."
          cause="Memory leak — the longer it runs, the slower it gets as memory fills and GC runs more. Also: connection pool exhaustion or database index degradation."
          fix="Run a Soak test overnight. Watch server memory during the test. Restart the server and see if performance resets (confirms memory leak). This is exactly what Soak tests are designed to catch." />
        <FailurePattern search={s}
          name="Errors only appear above a specific user count"
          symptoms="0% errors at 10 users, 0% at 20 users, 15% errors at 30 users, 40% errors at 40 users."
          cause="A hard capacity limit is being hit — thread pool, database connection pool, or API rate limit exhausted at exactly that threshold."
          fix="Run a Step-Up test to pinpoint the exact threshold. Check database max_connections. Check Lambda concurrency limit. The user count at which errors appear is your production ceiling." />
        <FailurePattern search={s}
          name="Spike causes errors that persist after the spike ends"
          symptoms="Errors appear during the spike but also continue for 30-60 seconds after user count drops back to base."
          cause="The system doesn't auto-recover. Queued requests are still being processed, connection pool hasn't been released, or a circuit breaker opened and hasn't reset."
          fix="Check auto-scaling configuration. Check circuit breaker reset time. Check if requests are queuing server-side after the spike." />
        <FailurePattern search={s}
          name="Most users fine, but some consistently slow (high p99)"
          symptoms="p50 and p90 are good, but p99 is 10x higher. The slow requests aren't random — they happen consistently."
          cause="Cold starts (Lambda/containers where some requests hit a cold instance). Or specific data patterns that trigger slow database queries."
          fix="Check if cold start time matches the slow requests. Add pre-warming requests before the main test. Add database slow query logging." />
        <FailurePattern search={s}
          name="Low throughput despite low error rate"
          symptoms="10 users, all requests succeed, but throughput is only 0.3 req/s when you expected 1 req/s."
          cause="The server is slow — each request takes longer than expected, so users can't send the next one until the current one finishes. With a 30s response time and no think time, you'll get ~2 req/min per user."
          fix="This isn't a problem if the response time is expected (AI endpoints). If unexpected, profile the server to find what's slow — database query, downstream API call, computation." />
      </Card>

      <Card title="JMeter concepts — demystified" emoji="⚙️" search={s}>
        <Term term="Thread group" search={s}>
          JMeter's name for a group of simulated users. Each thread = one simulated user running independently.
          Most tests have one thread group. Spike and Step-Up tests use multiple thread groups with different start times.
        </Term>
        <Term term="Sampler" search={s}>
          A single HTTP request sent to your API. Each step in LoadPilot becomes one sampler in the JMX file.
          Results in your report are broken down by sampler (shown as "Step 1", "Step 2", etc.).
        </Term>
        <Term term="Assertion" search={s}>
          A pass/fail rule applied to each response. Failed assertion = error in results, even if status was 200.
          LoadPilot supports: status code (expect 200), response time (expect under 3s), JSON Path (expect $.status = "ok").
        </Term>
        <Term term="Extractor" search={s}>
          Pulls a value out of one response for use in the next request. Classic use: login returns a session token,
          extractor saves it, next step sends it as a header. LoadPilot supports JSON Path ($.auth.token)
          and Regex extractors.
        </Term>
        <Term term="Transaction Controller" search={s}>
          Groups multiple steps together and records their combined time as one result row, in addition to individual
          step rows. Useful for measuring end-to-end journey time (e.g., "Login Flow" = login + token + first API call).
        </Term>
        <Term term="ConstantThroughputTimer" search={s}>
          Controls the overall request rate to a fixed target (e.g. 40 req/min). JMeter dynamically adjusts
          wait times — shorter waits when responses are slow, longer when fast — to maintain the rate.
          Better than a fixed Think time when response times vary significantly.
          <em>This is the "Max throughput" field in LoadPilot.</em>
        </Term>
        <Term term="SynchronizingTimer" search={s}>
          Holds all users at a barrier until a set number are ready, then releases them all simultaneously.
          More precise than ramp-up=0 for "everyone fires at the exact same millisecond" tests.
          <em>Use case: testing what happens when 40 users all click "submit" in the same second.</em>
        </Term>
        <Term term=".jmx file" search={s}>
          The test plan file JMeter reads. LoadPilot generates this from your form settings. You can open
          it in JMeter's GUI for inspection. It's XML — readable in any text editor.
        </Term>
        <Term term=".jtl file" search={s}>
          The results file JMeter writes during the test. One row per request, with timestamp, response time,
          status code, success/failure, failure message, and more. LoadPilot reads this to generate your report.
          You can also upload a .jtl from an external JMeter run to the Results Analysis tab.
        </Term>
        <Term term="Listeners (View Results Tree, Summary Report)" search={s}>
          JMeter components that capture and display results. LoadPilot adds a Failure Response Capture listener
          automatically — this records the full server response body for every failed request, which appears
          in the Calls view when you click a failed row.
        </Term>
      </Card>

      <Card title="Server-side monitoring — what to watch during a test" emoji="🖥️" search={s}>
        <p className="concept-intro">
          LoadPilot only sees what the client sees — response time and HTTP status. To diagnose why something
          is slow, you also need to watch the server during the test. Here's what to check for each common setup:
        </p>
        <Term term="AWS Lambda" search={s}>
          CloudWatch → Log groups → your function. Look for: TimeoutError (function exceeds max execution time),
          out-of-memory errors, or upstream errors from your AI provider.
          Key metrics: ConcurrentExecutions (hitting account limit?), Duration (approaching timeout?),
          Throttles (Lambda rejecting requests before they even start?).
        </Term>
        <Term term="EC2 / traditional server" search={s}>
          Watch CPU% (should stay under 80% for headroom), memory usage (rising over time = possible leak),
          network I/O (saturated = network bottleneck), disk I/O if the app writes logs under load.
        </Term>
        <Term term="Database" search={s}>
          Active connections (hitting max_connections?), slow query log (which queries degrade under concurrent load?),
          lock waits (concurrent writes blocking each other?), CPU% on the DB server itself.
        </Term>
        <Term term="The CPU vs I/O distinction" search={s}>
          When response times rise, does server CPU also rise? If yes — CPU-bound, needs more compute or optimization.
          If no — I/O-bound (waiting for database, downstream API, or disk). These need completely different fixes.
          <em>CPU-bound: scale up or optimize algorithms. I/O-bound: add caching, connection pooling, or faster storage.</em>
        </Term>
        <Term term="What to monitor for AI/LLM endpoints" search={s}>
          Monitor your AI provider's rate limits and response times separately from your own API's behavior.
          A spike in your p99 might be your Lambda hitting AWS Bedrock's concurrency limit, not your code's fault.
          Check the provider's dashboard alongside LoadPilot's results.
        </Term>
      </Card>

      <Card title="What to do with your results — next steps" emoji="✅" search={s}>
        <Term term="Passed — all metrics within thresholds" search={s}>
          Save the config and results as your baseline. Run it again after every major release to catch regressions.
          Consider a Soak test overnight and a Step-Up test to find your capacity ceiling.
        </Term>
        <Term term="High error rate — where to start" search={s}>
          Open the Calls view → filter to Failed → click a failed row to see the actual server response.
          That message usually tells you exactly what broke. Then check server-side logs for more detail.
        </Term>
        <Term term="Slow but no errors — where to start" search={s}>
          Check the chart — is it getting worse over time (soak issue, likely a leak) or was it slow from
          the start (capacity issue, needs more compute or optimization)? Then check server CPU and memory during the test.
        </Term>
        <Term term="Good under load but fails after hours (soak failure)" search={s}>
          Memory leak is the most common cause. Profile server memory usage and look for objects that accumulate.
          Check for unclosed database connections, HTTP clients that don't release connections, or unbounded caches.
        </Term>
        <Term term="Setting a realistic baseline user count" search={s}>
          Don't guess — look at your real production access logs and find the actual peak concurrent user count.
          Use that as your load test baseline. Test at 2× for stress, 3× for capacity planning.
        </Term>
        <Term term="How often to run load tests" search={s}>
          Before every major release. After significant infrastructure changes. After your AI provider updates
          their model or changes their API. Monthly for any production API that matters.
          <em>Treat it like any other QA step — not a one-time event.</em>
        </Term>
      </Card>
    </div>
  );
}
