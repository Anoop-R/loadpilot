// Converts a simple, no-code-friendly BuildConfig into a real JMeter .jmx file.
//
// Every element/property name below was cross-checked against either a bundled
// official JMeter template or extracted directly from the installed JMeter's
// compiled classes (see project notes) — including several easy-to-get-wrong
// details: the historically misspelled "Asserion.test_strings" property name,
// the exact bit values for ResponseAssertion.test_type (MATCH=1, CONTAINS=2,
// NOT=4, EQUALS=8, SUBSTRING=16), and RegexExtractor's exact property set
// (verified against a real example in JMeter's own bundled advanced-test-plan
// template, which actually uses a RegexExtractor for cross-request correlation
// — the same job this builder uses it for in multi-step flows).

export interface BuildHeader {
  name: string;
  value: string;
  /**
   * When true, this header's real value is still used for the actual HTTP
   * request (JMeter needs it to work) — but anywhere a copy of the config
   * gets persisted for documentation/sharing purposes rather than execution
   * (currently: the HTML report), the value is masked instead of shown in
   * plain text. Does NOT affect the generated .jmx used to actually run the
   * test, which always needs the real value.
   */
  sensitive?: boolean;
}

export interface BuildAssertions {
  /**
   * One status code (e.g. "200"), or several separated by commas/whitespace
   * (e.g. "200, 201, 204") when more than one response is acceptable. Multiple
   * values are combined into a single regex-alternation match rather than
   * multiple separate assertions — JMeter's Response Assertion requires ALL
   * listed patterns to match when there's more than one (AND logic, verified
   * directly in ResponseAssertion's bytecode), so just adding extra entries
   * for "any of these codes" would silently make the assertion impossible to
   * pass once more than one code is listed.
   */
  expectedStatusCode?: string;
  maxResponseTimeMs?: number;
  /**
   * JSON Path assertion — checks that a specific field in the JSON response
   * has the expected value. e.g. jsonPath="$.status" jsonPathExpected="ok"
   * verifies the response contains {"status":"ok"}.
   * Verified class: JSONPathAssertion (TestBean style, JMeter 5.x+).
   * Properties: JSON_PATH, EXPECTED_VALUE, JSONVALIDATION=true, ISREGEX=false.
   */
  jsonPath?: string;
  jsonPathExpected?: string;
}

export interface BuildExtract {
  /** Variable name later steps can reference as ${variableName}. */
  variableName: string;
  /**
   * Extraction method:
   * - "regex" (default): a regex with exactly one capture group applied to
   *   the full response body. Works for JSON, XML, or plain text.
   * - "jsonpath": a JSON Path expression like $.token or $.data.id, applied
   *   only to JSON responses. More readable and reliable for JSON than regex.
   *   Verified class: JSONPathExtractor (TestBean style, JMeter 5.x+).
   *   Properties: VAR, JSON_PATH, DEFAULT_VALUE, MATCH_NO=-1.
   */
  type?: "regex" | "jsonpath";
  regex?: string;      // used when type = "regex" (or omitted, for backward compat)
  jsonPath?: string;   // used when type = "jsonpath"
  defaultValue?: string;
}

export interface BuildStep {
  name?: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  headers: BuildHeader[];
  body?: string;
  assertions?: BuildAssertions;
  extract?: BuildExtract;
  sensitiveValues?: string[];
  /**
   * When set, this step and every sibling step that shares the same
   * transactionName are wrapped together inside a JMeter Transaction
   * Controller with that name. The controller records the combined end-to-end
   * time of all steps in the group as one result row alongside the individual
   * step rows. Steps without a transactionName are left unwrapped (unchanged).
   */
  transactionName?: string;
}

export type TestType = "load" | "soak" | "spike" | "stepup" | "breakpoint";

export interface SpikeConfig {
  baseUsers: number;
  spikeUsers: number;
  spikeStartSeconds: number;
  spikeDurationSeconds: number;
}

export interface StepUpConfig {
  stepsCount: number;
  usersPerStep: number;
  stepDurationSeconds: number;
  rampPerStep: number;
}

export interface BuildConfig {
  testName: string;
  protocol: "http" | "https" | "ws" | "wss" | "grpc" | "graphql" | "jdbc";
  /** gRPC-specific config */
  grpc?: {
    protoFile?: string;
    service: string;
    method: string;
    tls: boolean;
  };
  /** JDBC-specific config */
  jdbc?: {
    url: string;           // e.g. jdbc:postgresql://localhost:5432/mydb
    driver: string;        // e.g. org.postgresql.Driver
    username: string;
    password: string;
    query: string;
    queryType: "Select Statement" | "Update Statement" | "Callable Statement";
  };
  domain: string;
  port?: number;
  /**
   * Test type determines the load shape. "load" (default) is a standard
   * constant-load test. Each type generates a different ThreadGroup structure:
   * - load: single thread group, constant users, duration-based
   * - soak: single thread group, low-moderate users, very long duration (hours)
   * - spike: two thread groups — base load + spike that starts after a delay
   * - stepup: N thread groups, each starting later, building load progressively
   * - breakpoint: single thread group with very long duration, intended to be
   *   stopped manually when failure is observed
   */
  testType?: TestType;
  spikeConfig?: SpikeConfig;
  stepUpConfig?: StepUpConfig;

  /** Multi-step flow (login -> browse -> checkout, etc). Takes priority over the legacy flat fields below if present and non-empty. */
  steps?: BuildStep[];

  // Legacy single-request fields, kept for backward compatibility with
  // configs saved before multi-step support existed. Used only when `steps`
  // is absent/empty.
  method?: BuildStep["method"];
  path?: string;
  headers?: BuildHeader[];
  body?: string;
  assertions?: BuildAssertions;

  load: {
    users: number;
    rampUpSeconds: number;
    durationSeconds: number;
    /** Base/constant pause before each request. Combined with thinkTimeRandomMs, becomes a Uniform Random Timer instead of a plain Constant Timer. */
    thinkTimeMs?: number;
    /**
     * Additional random delay (0 to this value, uniformly distributed) added
     * on top of thinkTimeMs each time — e.g. thinkTimeMs=2000,
     * thinkTimeRandomMs=3000 means each pause is somewhere between 2000ms
     * and 5000ms, different every time, rather than always exactly 2000ms.
     * Verified directly against JMeter's bytecode: UniformRandomTimer
     * extends RandomTimer extends ConstantTimer, so it genuinely uses
     * ConstantTimer.delay for the base and RandomTimer.range for the random
     * portion — not two unrelated properties.
     */
    thinkTimeRandomMs?: number;
    /**
     * Caps overall request rate at this many requests per minute, shared
     * across all concurrent users, regardless of how long each individual
     * response takes — the right tool when response times vary a lot (e.g.
     * 11-19 seconds) and a fixed think-time delay would make throughput
     * fluctuate unpredictably. JMeter automatically waits less when
     * responses are slow and more when they're fast, to track the target
     * rate, instead of you calculating a fixed delay by hand. When set,
     * this takes priority over thinkTimeMs/thinkTimeRandomMs — a Constant
     * Throughput Timer is generated instead of a Constant/Uniform Random
     * Timer, since they solve the same problem (pacing requests) and using
     * both at once doesn't make sense.
     * Verified directly against JMeter's bytecode: ConstantThroughputTimer
     * is a TestBean-style element (same family as CSVDataSet) with a bare
     * "throughput" property already expressed in requests-PER-MINUTE (a
     * real JMeter quirk, not something this tool converts), and a
     * "calcMode" integer property confirmed — by reading getCalcMode()'s
     * actual bytecode, which calls .ordinal() on the underlying enum — to
     * be 3 for "All Active Threads (shared)", the mode that shares one
     * target rate across every concurrent user, not per-thread.
     */
    targetThroughputPerMinute?: number;
    /**
     * When set, each simulated user runs through the steps exactly this many
     * times (e.g. loopCount=1 means every user fires exactly one request and
     * stops). Mutually exclusive with the duration-based scheduler — when
     * loopCount is set, durationSeconds is ignored in the generated .jmx.
     * The classic "all N users hit the API exactly once" config is:
     * rampUpSeconds=0, loopCount=1.
     */
    loopCount?: number;
    /**
     * Synchronizing Timer — holds all threads at a barrier until exactly this
     * many are ready, then releases them all simultaneously. More precise than
     * rampUpSeconds=0 for "all N users hit at the exact same moment" tests.
     * Verified TestBean style: SyncTimer class, groupSize + timeoutInMs props.
     * Set to the same value as `users` to synchronize all of them.
     * timeoutInMs=0 means wait indefinitely (safe for small thread counts).
     */
    syncTimer?: { groupSize: number; timeoutInMs?: number };
    /**
     * What a simulated user does after one of its requests fails an assertion.
     * Verified directly against JMeter's AbstractThreadGroup bytecode — these
     * five values (and only these) are real, recognized values for
     * ThreadGroup.on_sample_error:
     *  - "continue" (default): keep going as if nothing happened.
     *  - "stopthread": that one simulated user's session ends right there;
     *    other concurrent users are unaffected and keep running normally.
     *  - "stoptest": the whole run winds down gracefully — in-flight
     *    requests are allowed to finish, but no new ones start.
     *  - "stoptestnow": the whole run stops immediately, including
     *    interrupting any in-flight requests.
     * Important honest limitation: JMeter's own mechanism triggers on the
     * very FIRST failure — there's no built-in "stop after N failures"
     * threshold to configure (confirmed: no such property exists on the
     * underlying class). If failure-count-based stopping is ever needed,
     * that would require custom JSR223 scripting layered on top of this,
     * not a setting JMeter exposes natively.
     */
    onError?: "continue" | "stopthread" | "stoptest" | "stoptestnow";
  };
  csv?: {
    filename: string; // filename as it will sit next to the .jmx (e.g. "data.csv")
    variableNames: string[];
    /**
     * When true, each simulated user (JMeter thread) claims one CSV row ONCE,
     * at the start of its run, and keeps using that same row's values for
     * every loop iteration — giving each concurrent user a stable identity/
     * session for the whole test, instead of picking a new row every loop.
     * Implemented by nesting the CSVDataSet inside a OnceOnlyController.
     */
    stickyPerUser?: boolean;
  };
  /**
   * Optional p95-response-time thresholds used to rate each request label as
   * "good" / "moderate" / "poor" in Results Analysis and the HTML report.
   * If not specified, a documented general-purpose default is used (see
   * jtlParser.ts's DEFAULT_PERFORMANCE_THRESHOLDS) — explicitly NOT claimed
   * to be an authoritative industry standard, since reasonable expectations
   * genuinely vary by what the endpoint actually does.
   */
  performanceThresholds?: {
    goodMs: number;
    moderateMs: number;
  };
  /**
   * When true, adds a JMeter HTTP Cookie Manager to the test plan. This
   * automatically captures and resends cookies (like a browser does) —
   * required for APIs that use cookie-based session tokens instead of or in
   * addition to header-based auth. Without this, each request is sent without
   * any cookies the server set on previous responses.
   * Verified class: CookieManager, guiclass: CookiePanel.
   */
  cookieManager?: boolean;
}

/** Resolves the effective list of steps, normalizing legacy single-request configs into a one-step list. */
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

function esc(value: string | number | undefined): string {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function headerManagerXml(headers: BuildHeader[]): string {
  if (!headers || headers.length === 0) return "";
  const items = headers
    .filter((h) => h.name.trim())
    .map(
      (h) => `            <elementProp name="" elementType="Header">
              <stringProp name="Header.name">${esc(h.name)}</stringProp>
              <stringProp name="Header.value">${esc(h.value)}</stringProp>
            </elementProp>`
    )
    .join("\n");
  if (!items) return "";
  return `        <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="Headers" enabled="true">
          <collectionProp name="HeaderManager.headers">
${items}
          </collectionProp>
        </HeaderManager>
        <hashTree/>
`;
}

function bodyArgumentsXml(body: string | undefined): string {
  if (!body) {
    return `<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
            <collectionProp name="Arguments.arguments"/>
          </elementProp>`;
  }
  return `<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
            <collectionProp name="Arguments.arguments">
              <elementProp name="" elementType="HTTPArgument">
                <boolProp name="HTTPArgument.always_encode">false</boolProp>
                <stringProp name="Argument.value">${esc(body)}</stringProp>
                <stringProp name="Argument.metadata">=</stringProp>
                <boolProp name="HTTPArgument.use_equals">true</boolProp>
                <stringProp name="Argument.name"></stringProp>
              </elementProp>
            </collectionProp>
          </elementProp>`;
}

/**
 * Splits "200, 201, 204" (or whitespace-separated) into individual codes.
 * A single value (the common case) comes back as a one-element array.
 */
function splitMultiValue(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function assertionsXml(assertions?: BuildAssertions): string {
  let xml = "";
  if (assertions?.expectedStatusCode) {
    const codes = splitMultiValue(assertions.expectedStatusCode);
    if (codes.length > 1) {
      // Multiple acceptable codes: one regex-alternation pattern, "Contains" mode (bit 2).
      // MATCH (1) causes JMeter to show the confusing [[[4]]]00 format in failure messages
      // because it displays per-group regex matches. CONTAINS (2) shows the clean
      // "received: 400, comparison: ^(200|201)$" format instead.
      const pattern = `^(${codes.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`;
      xml += `        <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="Check status code" enabled="true">
          <collectionProp name="Asserion.test_strings">
            <stringProp name="49586">${esc(pattern)}</stringProp>
          </collectionProp>
          <stringProp name="Assertion.test_field">Assertion.response_code</stringProp>
          <intProp name="Assertion.test_type">2</intProp>
          <boolProp name="Assertion.assume_success">false</boolProp>
        </ResponseAssertion>
        <hashTree/>
`;
    } else {
      xml += `        <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="Check status code" enabled="true">
          <collectionProp name="Asserion.test_strings">
            <stringProp name="49586">${esc(codes[0])}</stringProp>
          </collectionProp>
          <stringProp name="Assertion.test_field">Assertion.response_code</stringProp>
          <intProp name="Assertion.test_type">8</intProp>
          <boolProp name="Assertion.assume_success">false</boolProp>
        </ResponseAssertion>
        <hashTree/>
`;
    }
  }
  if (assertions?.maxResponseTimeMs) {
    xml += `        <DurationAssertion guiclass="DurationAssertionGui" testclass="DurationAssertion" testname="Max response time" enabled="true">
          <stringProp name="DurationAssertion.duration">${esc(assertions.maxResponseTimeMs)}</stringProp>
        </DurationAssertion>
        <hashTree/>
`;
  }
  // JSON Path assertion (JMeter 5.x+, TestBean style)
  // Verified class: JSONPathAssertion. Properties: JSON_PATH, EXPECTED_VALUE,
  // JSONVALIDATION (true = validate the value, not just existence),
  // EXPECT_NULL=false, INVERT=false, ISREGEX=false (plain string match).
  if (assertions?.jsonPath?.trim()) {
    xml += `        <JSONPathAssertion guiclass="TestBeanGUI" testclass="JSONPathAssertion" testname="Check JSON field ${esc(assertions.jsonPath)}" enabled="true">
          <stringProp name="JSON_PATH">${esc(assertions.jsonPath)}</stringProp>
          <stringProp name="EXPECTED_VALUE">${esc(assertions.jsonPathExpected ?? "")}</stringProp>
          <boolProp name="JSONVALIDATION">${Boolean(assertions.jsonPathExpected).toString()}</boolProp>
          <boolProp name="EXPECT_NULL">false</boolProp>
          <boolProp name="INVERT">false</boolProp>
          <boolProp name="ISREGEX">false</boolProp>
        </JSONPathAssertion>
        <hashTree/>
`;
  }
  return xml;
}

/**
 * RegexExtractor XML — property names and shape verified against a real
 * example in JMeter's own bundled build-adv-web-test-plan.jmx template, which
 * uses one for exactly this purpose (extracting a value from one response to
 * reuse in a later request).
 */
function extractorXml(extract?: BuildExtract): string {
  if (!extract || !extract.variableName.trim()) return "";

  // JSON Path extractor (JMeter 5.x+)
  // TestBean style — verified class: JSONPathExtractor in package
  // org.apache.jmeter.extractor.json.jsonpath. Properties: VAR (variable
  // name), JSON_PATH (the expression), DEFAULT_VALUE, MATCH_NO (-1 = random
  // from all matches, 0 = first, 1..N = Nth).
  if (extract.type === "jsonpath" && extract.jsonPath?.trim()) {
    return `        <JSONPathExtractor guiclass="TestBeanGUI" testclass="JSONPathExtractor" testname="Extract ${esc(extract.variableName)}" enabled="true">
          <stringProp name="VAR">${esc(extract.variableName)}</stringProp>
          <stringProp name="JSON_PATH">${esc(extract.jsonPath)}</stringProp>
          <stringProp name="DEFAULT_VALUE">${esc(extract.defaultValue || "")}</stringProp>
          <intProp name="MATCH_NO">0</intProp>
        </JSONPathExtractor>
        <hashTree/>
`;
  }

  // Regex extractor — backward compatible, also the fallback when type is omitted
  const regex = extract.regex ?? "";
  if (!regex.trim()) return "";
  return `        <RegexExtractor guiclass="RegexExtractorGui" testclass="RegexExtractor" testname="Extract ${esc(
    extract.variableName
  )}" enabled="true">
          <stringProp name="RegexExtractor.useHeaders">false</stringProp>
          <stringProp name="RegexExtractor.refname">${esc(extract.variableName)}</stringProp>
          <stringProp name="RegexExtractor.regex">${esc(regex)}</stringProp>
          <stringProp name="RegexExtractor.template">$1$</stringProp>
          <stringProp name="RegexExtractor.default">${esc(extract.defaultValue || "")}</stringProp>
          <stringProp name="RegexExtractor.match_number">1</stringProp>
        </RegexExtractor>
        <hashTree/>
`;
}

function cookieManagerXml(enabled?: boolean): string {
  if (!enabled) return "";
  // CookieManager — automatically captures cookies from each response and
  // sends them with subsequent requests, exactly like a browser. Verified
  // class names from saveservice.properties.
  return `      <CookieManager guiclass="CookiePanel" testclass="CookieManager" testname="HTTP Cookie Manager" enabled="true">
        <collectionProp name="CookieManager.cookies"/>
        <boolProp name="CookieManager.clearEachIteration">false</boolProp>
        <boolProp name="CookieManager.controlledByThreadGroup">false</boolProp>
      </CookieManager>
      <hashTree/>
`;
}

function syncTimerXml(syncTimer?: BuildConfig["load"]["syncTimer"]): string {
  if (!syncTimer) return "";
  // SyncTimer (TestBean style) — verified via bytecode:
  // groupSize = number of threads to wait for before releasing the barrier.
  // timeoutInMs = max wait; 0 = wait indefinitely.
  return `        <SyncTimer guiclass="TestBeanGUI" testclass="SyncTimer" testname="Synchronizing Timer" enabled="true">
          <intProp name="groupSize">${esc(syncTimer.groupSize)}</intProp>
          <longProp name="timeoutInMs">${esc(syncTimer.timeoutInMs ?? 0)}</longProp>
        </SyncTimer>
        <hashTree/>
`;
}

function csvDataSetXml(csv?: BuildConfig["csv"]): string {
  if (!csv || csv.stickyPerUser) return "";
  return `      <CSVDataSet guiclass="TestBeanGUI" testclass="CSVDataSet" testname="CSV Data Set Config" enabled="true">
        <stringProp name="delimiter">,</stringProp>
        <stringProp name="fileEncoding">UTF-8</stringProp>
        <stringProp name="filename">${esc(csv.filename)}</stringProp>
        <boolProp name="quotedData">false</boolProp>
        <boolProp name="recycle">true</boolProp>
        <stringProp name="shareMode">shareMode.all</stringProp>
        <boolProp name="stopThread">false</boolProp>
        <stringProp name="variableNames">${esc(csv.variableNames.join(","))}</stringProp>
      </CSVDataSet>
      <hashTree/>
`;
}

/**
 * The "sticky per user" alternative: nests the CSVDataSet inside a
 * OnceOnlyController placed at the start of the ThreadGroup's loop, so each
 * thread (simulated user) claims exactly one row ONCE — on its very first
 * iteration — and keeps using those same values for every subsequent loop,
 * instead of picking a fresh row every time. shareMode stays "shareMode.all"
 * (a single shared pointer across all threads) specifically so that each
 * thread's one-time claim pulls the next available row in sequence, giving
 * concurrent threads distinct rows rather than every thread starting at row 0.
 * OnceOnlyController needs no configurable properties of its own — its
 * "run children exactly once per thread" behavior comes from its Java
 * implementation, not from any settable property (confirmed: it has no
 * GUI fields beyond enable/name, unlike its parent class LoopController).
 */
function stickyCsvDataSetXml(csv?: BuildConfig["csv"]): string {
  if (!csv || !csv.stickyPerUser) return "";
  return `        <OnceOnlyController guiclass="OnceOnlyControllerGui" testclass="OnceOnlyController" testname="Assign user data once" enabled="true"/>
        <hashTree>
          <CSVDataSet guiclass="TestBeanGUI" testclass="CSVDataSet" testname="CSV Data Set Config" enabled="true">
            <stringProp name="delimiter">,</stringProp>
            <stringProp name="fileEncoding">UTF-8</stringProp>
            <stringProp name="filename">${esc(csv.filename)}</stringProp>
            <boolProp name="quotedData">false</boolProp>
            <boolProp name="recycle">true</boolProp>
            <stringProp name="shareMode">shareMode.all</stringProp>
            <boolProp name="stopThread">false</boolProp>
            <stringProp name="variableNames">${esc(csv.variableNames.join(","))}</stringProp>
          </CSVDataSet>
          <hashTree/>
        </hashTree>
`;
}

/**
 * Picks the right timer element based on what's set:
 *  - neither set: no timer at all (unchanged default behavior)
 *  - only thinkTimeMs: plain ConstantTimer, exactly as before (backward compatible)
 *  - thinkTimeRandomMs set (with or without thinkTimeMs): UniformRandomTimer,
 *    using ConstantTimer.delay for the base and RandomTimer.range for the
 *    random portion — verified these are the real properties via bytecode
 *    (UniformRandomTimer extends RandomTimer extends ConstantTimer).
 */
function timerXml(thinkTimeMs?: number, thinkTimeRandomMs?: number, targetThroughputPerMinute?: number): string {
  if (targetThroughputPerMinute) {
    // TestBean-style element (same family as CSVDataSet): bare property
    // names, guiclass="TestBeanGUI". "throughput" is genuinely expressed in
    // requests-per-minute by JMeter itself — not converted here. calcMode=3
    // is "All Active Threads (shared)", confirmed via the enum's declared
    // order and getCalcMode()'s actual bytecode (calls .ordinal()).
    return `        <ConstantThroughputTimer guiclass="TestBeanGUI" testclass="ConstantThroughputTimer" testname="Constant Throughput Timer" enabled="true">
          <doubleProp>
            <name>throughput</name>
            <value>${targetThroughputPerMinute}</value>
            <savedValue>0.0</savedValue>
          </doubleProp>
          <intProp name="calcMode">3</intProp>
        </ConstantThroughputTimer>
        <hashTree/>
`;
  }
  if (thinkTimeRandomMs) {
    return `        <UniformRandomTimer guiclass="UniformRandomTimerGui" testclass="UniformRandomTimer" testname="Uniform Random Timer" enabled="true">
          <stringProp name="ConstantTimer.delay">${esc(thinkTimeMs || 0)}</stringProp>
          <stringProp name="RandomTimer.range">${esc(thinkTimeRandomMs)}</stringProp>
        </UniformRandomTimer>
        <hashTree/>
`;
  }
  if (!thinkTimeMs) return "";
  return `        <ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="Think Time" enabled="true">
          <stringProp name="ConstantTimer.delay">${esc(thinkTimeMs)}</stringProp>
        </ConstantTimer>
        <hashTree/>
`;
}

function stepXml(
  step: BuildStep,
  index: number,
  thinkTimeMs?: number,
  thinkTimeRandomMs?: number,
  targetThroughputPerMinute?: number,
  config?: BuildConfig
): string {
  // Route to the right sampler based on protocol
  if (config?.protocol === "grpc") return grpcSamplerXml(step, config, index);
  if (config?.protocol === "jdbc") return jdbcSamplerXml(step, config, index);
  if (config?.protocol === "ws" || config?.protocol === "wss") return wsSamplerXml(step, config, index);

  const headerXml = headerManagerXml(step.headers);
  const assertXml = assertionsXml(step.assertions);
  const extractXml = extractorXml(step.extract);
  const timer = timerXml(thinkTimeMs, thinkTimeRandomMs, targetThroughputPerMinute);
  // GraphQL is just a POST request with a JSON body — no special sampler needed.
  const name = step.name?.trim() || `Step ${index + 1}: ${step.method}`;

  return `${timer}        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${esc(
    name
  )}" enabled="true">
          ${bodyArgumentsXml(step.body)}
          <stringProp name="HTTPSampler.domain"></stringProp>
          <stringProp name="HTTPSampler.port"></stringProp>
          <stringProp name="HTTPSampler.protocol"></stringProp>
          <stringProp name="HTTPSampler.contentEncoding"></stringProp>
          <stringProp name="HTTPSampler.path">${esc(step.path)}</stringProp>
          <stringProp name="HTTPSampler.method">${esc(step.method)}</stringProp>
          <boolProp name="HTTPSampler.follow_redirects">true</boolProp>
          <boolProp name="HTTPSampler.auto_redirects">false</boolProp>
          <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
          <boolProp name="HTTPSampler.DO_MULTIPART_POST">false</boolProp>
          <boolProp name="HTTPSampler.postBodyRaw">${step.body ? "true" : "false"}</boolProp>
        </HTTPSamplerProxy>
        <hashTree>
${headerXml}${assertXml}${extractXml}        </hashTree>
`;
}

/**
 * A second results listener, alongside the main `-l results.jtl` CSV output,
 * that captures full response bodies — but only for failed samples — into a
 * separate XML file. CSV output doesn't support embedding response bodies at
 * all (JMeter's own jmeter.properties says so explicitly); XML does. Element
 * name, error_logging property, and the responseDataOnError save-config field
 * are all verified against a real ResultCollector block in JMeter's own
 * bundled recording.jmx template. Keeping this as a SEPARATE listener (rather
 * than changing the main output format) means the primary stats pipeline is
 * completely unaffected if this one doesn't produce what's expected.
 */
function failureCaptureXml(): string {
  return `        <ResultCollector guiclass="SimpleDataWriter" testclass="ResultCollector" testname="Failure Response Capture" enabled="true">
          <boolProp name="ResultCollector.error_logging">true</boolProp>
          <objProp>
            <name>saveConfig</name>
            <value class="SampleSaveConfiguration">
              <time>true</time>
              <latency>false</latency>
              <timestamp>true</timestamp>
              <success>true</success>
              <label>true</label>
              <code>true</code>
              <message>true</message>
              <threadName>false</threadName>
              <dataType>false</dataType>
              <encoding>false</encoding>
              <assertions>false</assertions>
              <subresults>false</subresults>
              <responseData>false</responseData>
              <samplerData>false</samplerData>
              <xml>false</xml>
              <fieldNames>false</fieldNames>
              <responseHeaders>false</responseHeaders>
              <requestHeaders>false</requestHeaders>
              <responseDataOnError>true</responseDataOnError>
              <saveAssertionResultsFailureMessage>true</saveAssertionResultsFailureMessage>
              <assertionsResultsToSave>0</assertionsResultsToSave>
              <bytes>false</bytes>
            </value>
          </objProp>
          <stringProp name="filename">failures.xml</stringProp>
        </ResultCollector>
        <hashTree/>
`;
}

// Domain/port/protocol are set once at the HTTP Request Defaults level so
// every step only needs to specify its own path/method — keeps multi-step
// flows (which share one host) from repeating the same three fields per step.
/** gRPC sampler using BlazeMeter gRPC plugin (free, open source) */
function grpcSamplerXml(step: BuildStep, config: BuildConfig, idx: number): string {
  const label = step.name || `Step ${idx + 1}: gRPC`;
  const grpc = config.grpc || { service: "", method: "", tls: true };
  return `        <io.github.protocol.sampler.grpc.GrpcSampler guiclass="io.github.protocol.sampler.grpc.GrpcSamplerUi" testclass="io.github.protocol.sampler.grpc.GrpcSampler" testname="${esc(label)}" enabled="true">
          <stringProp name="GrpcSampler.host">${esc(config.domain)}</stringProp>
          <stringProp name="GrpcSampler.port">${config.port || (grpc.tls ? "443" : "50051")}</stringProp>
          <stringProp name="GrpcSampler.fullMethod">${esc(grpc.service)}.${esc(grpc.method)}</stringProp>
          <stringProp name="GrpcSampler.requestJson">${esc(step.body || "{}")}</stringProp>
          <boolProp name="GrpcSampler.tls">${grpc.tls ? "true" : "false"}</boolProp>
          <intProp name="GrpcSampler.deadlineMs">30000</intProp>
        </io.github.protocol.sampler.grpc.GrpcSampler>
        <hashTree>
          ${assertionsXml(step.assertions)}
        </hashTree>\n`;
}

/** JDBC sampler - tests database queries directly */
function jdbcSamplerXml(step: BuildStep, config: BuildConfig, idx: number): string {
  const label = step.name || `Step ${idx + 1}: JDBC`;
  const jdbc = config.jdbc!;
  const connId = "conn_" + idx;
  return `        <JDBCDataSource guiclass="TestBeanGUI" testclass="JDBCDataSource" testname="JDBC Connection ${esc(String(idx + 1))}" enabled="true">
          <boolProp name="autocommit">true</boolProp>
          <stringProp name="dbUrl">${esc(jdbc.url)}</stringProp>
          <stringProp name="driver">${esc(jdbc.driver)}</stringProp>
          <stringProp name="username">${esc(jdbc.username)}</stringProp>
          <stringProp name="password">${esc(jdbc.password)}</stringProp>
          <stringProp name="poolMax">10</stringProp>
          <stringProp name="connectionAge">5000</stringProp>
          <stringProp name="checkQuery">SELECT 1</stringProp>
          <stringProp name="transactionIsolation">DEFAULT</stringProp>
          <stringProp name="dataSource">${connId}</stringProp>
        </JDBCDataSource>
        <hashTree/>
        <JDBCSampler guiclass="TestBeanGUI" testclass="JDBCSampler" testname="${esc(label)}" enabled="true">
          <stringProp name="dataSource">${connId}</stringProp>
          <stringProp name="queryType">${esc(jdbc.queryType || "Select Statement")}</stringProp>
          <stringProp name="query">${esc(jdbc.query)}</stringProp>
          <stringProp name="resultVariable"></stringProp>
          <stringProp name="queryArguments"></stringProp>
          <stringProp name="queryArgumentsTypes"></stringProp>
        </JDBCSampler>
        <hashTree>
          ${assertionsXml(step.assertions)}
        </hashTree>\n`;
}

/** Generates a WebSocket sampler using JMeter WebSocket plugin (Gorilla). */
function wsSamplerXml(step: BuildStep, config: BuildConfig, idx: number): string {
  const isSecure = config.protocol === "wss" ? "true" : "false";
  const label = step.name || `Step ${idx + 1}: WS`;
  const msg = step.body || "";
  return `        <GenericSampler guiclass="GenericSamplerUI" testclass="GenericSampler" testname="${esc(label)}" enabled="true">
          <stringProp name="GenericSampler.domain">${esc(config.domain)}</stringProp>
          <intProp name="GenericSampler.port">${config.port || (isSecure === "true" ? 443 : 80)}</intProp>
          <stringProp name="GenericSampler.path">${esc(step.path || "/")}</stringProp>
          <boolProp name="GenericSampler.ssl">${isSecure}</boolProp>
          <stringProp name="GenericSampler.sendData">${esc(msg)}</stringProp>
          <stringProp name="GenericSampler.connectTimeout">5000</stringProp>
          <stringProp name="GenericSampler.responseTimeout">20000</stringProp>
        </GenericSampler>
        <hashTree>
          ${assertionsXml(step.assertions)}
        </hashTree>\n`;
}

function httpDefaultsXml(config: BuildConfig): string {
  // Map ws→http, wss→https for HTTP Defaults
  const httpProto = config.protocol === "wss" ? "https" : config.protocol === "ws" ? "http" : config.protocol;
  return `      <ConfigTestElement guiclass="HttpDefaultsGui" testclass="ConfigTestElement" testname="HTTP Request Defaults" enabled="true">
        <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
          <collectionProp name="Arguments.arguments"/>
        </elementProp>
        <stringProp name="HTTPSampler.domain">${esc(config.domain)}</stringProp>
        <stringProp name="HTTPSampler.port">${config.port ? esc(config.port) : ""}</stringProp>
        <stringProp name="HTTPSampler.connect_timeout"></stringProp>
        <stringProp name="HTTPSampler.response_timeout"></stringProp>
        <stringProp name="HTTPSampler.protocol">${esc(httpProto)}</stringProp>
        <stringProp name="HTTPSampler.contentEncoding"></stringProp>
        <stringProp name="HTTPSampler.path"></stringProp>
        <stringProp name="HTTPSampler.concurrentPool">4</stringProp>
      </ConfigTestElement>
      <hashTree/>
`;
}

export function buildJmx(config: BuildConfig): string {
  const steps = resolveSteps(config);
  const csvXml = csvDataSetXml(config.csv);
  const defaultsXml = httpDefaultsXml(config);
  const cookieXml = cookieManagerXml(config.cookieManager);
  const syncXml = syncTimerXml(config.load.syncTimer);

  // Group steps into Transaction Controllers when transactionName is set.
  // Steps without a transactionName are emitted directly (unchanged behavior).
  // Steps sharing a transactionName are wrapped in one TransactionController.
  // TransactionController properties verified via bytecode:
  // TransactionController.parent=false (don't count sub-samples as parent),
  // TransactionController.includeTimers=false.
  function buildStepsXml(): string {
    const seen = new Map<string, number>(); // transactionName -> index of the opening tag
    const parts: string[] = [];
    const groups = new Map<string, BuildStep[]>();

    // First pass: collect groups and their order
    const order: (string | null)[] = [];
    for (const step of steps) {
      const tx = step.transactionName?.trim() || null;
      if (tx) {
        if (!groups.has(tx)) { groups.set(tx, []); order.push(tx); }
        groups.get(tx)!.push(step);
      } else {
        order.push(null);
      }
    }

    const emittedTx = new Set<string>();
    let plainIdx = 0;
    for (const key of order) {
      if (key === null) {
        // find next plain step
        const plainSteps = steps.filter(s => !s.transactionName?.trim());
        const step = plainSteps[plainIdx++];
        const globalIdx = steps.indexOf(step);
        parts.push(stepXml(step, globalIdx, config.load.thinkTimeMs, config.load.thinkTimeRandomMs, config.load.targetThroughputPerMinute, config));
      } else if (!emittedTx.has(key)) {
        emittedTx.add(key);
        const txSteps = groups.get(key)!;
        const txBody = txSteps.map((step) => {
          const globalIdx = steps.indexOf(step);
          return stepXml(step, globalIdx, config.load.thinkTimeMs, config.load.thinkTimeRandomMs, config.load.targetThroughputPerMinute);
        }).join("\n");
        parts.push(`        <TransactionController guiclass="TransactionControllerGui" testclass="TransactionController" testname="${esc(key)}" enabled="true">
          <boolProp name="TransactionController.parent">false</boolProp>
          <boolProp name="TransactionController.includeTimers">false</boolProp>
        </TransactionController>
        <hashTree>
${txBody}        </hashTree>
`);
      }
    }
    return parts.join("\n");
  }

  const stepsXml = buildStepsXml();
  const stepContent = `${stickyCsvDataSetXml(config.csv)}${syncXml}${failureCaptureXml()}${stepsXml}`;
  const onError = esc(config.load.onError || "continue");

  /** Single standard ThreadGroup (load/soak/breakpoint) */
  function threadGroupXml(label: string, users: number, ramp: number, duration: number | null, loopCount: number | null, delay = 0): string {
    const useScheduler = loopCount == null;
    return `      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="${esc(label)}" enabled="true">
        <stringProp name="ThreadGroup.on_sample_error">${onError}</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
          <boolProp name="LoopController.continue_forever">${useScheduler ? "true" : "false"}</boolProp>
          <stringProp name="LoopController.loops">${loopCount ?? -1}</stringProp>
        </elementProp>
        <stringProp name="ThreadGroup.num_threads">${users}</stringProp>
        <stringProp name="ThreadGroup.ramp_time">${ramp}</stringProp>
        <boolProp name="ThreadGroup.scheduler">${useScheduler}</boolProp>
        <stringProp name="ThreadGroup.duration">${useScheduler && duration != null ? duration : ""}</stringProp>
        <stringProp name="ThreadGroup.delay">${delay || ""}</stringProp>
      </ThreadGroup>
      <hashTree>
${stepContent}      </hashTree>
`;
  }

  let threadGroupsXml: string;
  const t = config.testType || "load";

  if (t === "spike" && config.spikeConfig) {
    const sc = config.spikeConfig;
    const totalDuration = sc.spikeStartSeconds + sc.spikeDurationSeconds + 30;
    threadGroupsXml =
      threadGroupXml(`${config.testName} — Base load`, sc.baseUsers, config.load.rampUpSeconds, totalDuration, null, 0) +
      threadGroupXml(`${config.testName} — Spike (+${sc.spikeUsers} users)`, sc.spikeUsers, 0, sc.spikeDurationSeconds, null, sc.spikeStartSeconds);
  } else if (t === "stepup" && config.stepUpConfig) {
    const su = config.stepUpConfig;
    threadGroupsXml = Array.from({ length: su.stepsCount }, (_, i) => {
      const delay = i * su.stepDurationSeconds;
      const duration = (su.stepsCount - i) * su.stepDurationSeconds;
      return threadGroupXml(`${config.testName} — Step ${i + 1} (+${su.usersPerStep} users)`, su.usersPerStep, su.rampPerStep, duration, null, delay);
    }).join("");
  } else {
    // load, soak, breakpoint — single thread group (soak/breakpoint just use long duration)
    threadGroupsXml = threadGroupXml(
      `${config.testName} — ${t === "soak" ? "Soak" : t === "breakpoint" ? "Breakpoint" : "Load"}`,
      config.load.users,
      config.load.rampUpSeconds,
      config.load.loopCount ? null : config.load.durationSeconds,
      config.load.loopCount ?? null
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${esc(config.testName)}" enabled="true">
      <stringProp name="TestPlan.comments">Generated by LoadPilot — Test type: ${t}</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
        <collectionProp name="Arguments.arguments"/>
      </elementProp>
      <stringProp name="TestPlan.user_define_classpath"></stringProp>
    </TestPlan>
    <hashTree>
${csvXml}${cookieXml}${defaultsXml}${threadGroupsXml}    </hashTree>
  </hashTree>
</jmeterTestPlan>
`;
}

/**
 * A second listener variant for the auto-correlation probe below: captures
 * the FULL request and response for EVERY sample (not just failures), since
 * correlation analysis needs to see normal successful traffic to find what
 * one step's response hands to a later step's request. Same verified
 * element/property names as failureCaptureXml — only the save-config flags
 * differ (responseData/samplerData/requestHeaders on, errorsOnly off).
 */
function probeCaptureXml(): string {
  return `        <ResultCollector guiclass="SimpleDataWriter" testclass="ResultCollector" testname="Probe Capture" enabled="true">
          <boolProp name="ResultCollector.error_logging">false</boolProp>
          <objProp>
            <name>saveConfig</name>
            <value class="SampleSaveConfiguration">
              <time>false</time>
              <latency>false</latency>
              <timestamp>false</timestamp>
              <success>true</success>
              <label>true</label>
              <code>true</code>
              <message>false</message>
              <threadName>false</threadName>
              <dataType>false</dataType>
              <encoding>false</encoding>
              <assertions>false</assertions>
              <subresults>false</subresults>
              <responseData>true</responseData>
              <samplerData>true</samplerData>
              <xml>false</xml>
              <fieldNames>false</fieldNames>
              <responseHeaders>false</responseHeaders>
              <requestHeaders>true</requestHeaders>
              <responseDataOnError>false</responseDataOnError>
              <saveAssertionResultsFailureMessage>false</saveAssertionResultsFailureMessage>
              <assertionsResultsToSave>0</assertionsResultsToSave>
              <bytes>false</bytes>
            </value>
          </objProp>
          <stringProp name="filename">probe.xml</stringProp>
        </ResultCollector>
        <hashTree/>
`;
}

/**
 * Builds a one-pass "probe" version of the test plan for auto-correlation:
 * same steps/headers/body/CSV as the real config, but forced to exactly one
 * user running through the steps exactly once (no duration, no scheduler) —
 * just enough to see one real request/response cycle per step, which is all
 * correlation analysis needs. Captures full request+response via
 * probeCaptureXml() instead of the load-test listeners.
 */
export function buildProbeJmx(config: BuildConfig): string {
  const steps = resolveSteps(config);
  const csvXml = csvDataSetXml(config.csv);
  const defaultsXml = httpDefaultsXml(config);
  const stepsXml = steps.map((step, i) => stepXml(step, i, undefined)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${esc(config.testName)} (probe)" enabled="true">
      <stringProp name="TestPlan.comments">Generated by LoadPilot — one-pass probe for auto-correlation</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
        <collectionProp name="Arguments.arguments"/>
      </elementProp>
      <stringProp name="TestPlan.user_define_classpath"></stringProp>
    </TestPlan>
    <hashTree>
${csvXml}${defaultsXml}      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Probe" enabled="true">
        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
          <boolProp name="LoopController.continue_forever">false</boolProp>
          <stringProp name="LoopController.loops">1</stringProp>
        </elementProp>
        <stringProp name="ThreadGroup.num_threads">1</stringProp>
        <stringProp name="ThreadGroup.ramp_time">1</stringProp>
        <boolProp name="ThreadGroup.scheduler">false</boolProp>
        <stringProp name="ThreadGroup.duration"></stringProp>
        <stringProp name="ThreadGroup.delay"></stringProp>
      </ThreadGroup>
      <hashTree>
${probeCaptureXml()}${stepsXml}      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>
`;
}
