// Walks a .jmx file's actual element order (using fast-xml-parser's
// preserveOrder mode) to extract facts JMeter itself would agree with:
// thread group settings, which samplers have assertions/extractors,
// active listeners, timers, CSV Data Sets, and suspicious hardcoded
// JWT/UUID-looking values. The LLM only ever interprets these facts —
// it never has to read raw XML itself, so it can't hallucinate elements
// that aren't really there.

import { XMLParser } from "fast-xml-parser";

type OrderedNode = Record<string, any>;

const SAMPLER_TAGS = new Set(["HTTPSamplerProxy", "HTTPSampler", "HTTPSampler2"]);
const ASSERTION_TAGS = new Set([
  "ResponseAssertion",
  "JSONPathAssertion",
  "DurationAssertion",
  "SizeAssertion",
  "XPathAssertion",
]);
const EXTRACTOR_TAGS = new Set([
  "RegexExtractor",
  "JSONPostProcessor",
  "XPathExtractor",
  "BoundaryExtractor",
]);
const TIMER_TAGS = new Set([
  "ConstantTimer",
  "UniformRandomTimer",
  "GaussianRandomTimer",
  "PoissonRandomTimer",
  "ConstantThroughputTimer",
]);
const LISTENER_TAGS = new Set(["ResultCollector"]);
const THREADGROUP_TAGS = new Set(["ThreadGroup", "SetupThreadGroup", "PostThreadGroup"]);

const JWT_LIKE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ThreadGroupInfo {
  name: string;
  numThreads: number;
  rampTime: number;
  loops: string;
}

export interface SamplerInfo {
  name: string;
  hasAssertion: boolean;
  hasExtractor: boolean;
}

export interface ListenerInfo {
  name: string;
  enabled: boolean;
}

export interface SuspiciousValue {
  samplerName: string;
  value: string;
}

export interface JmxFacts {
  threadGroups: ThreadGroupInfo[];
  samplers: SamplerInfo[];
  timers: number;
  listeners: ListenerInfo[];
  csvDataSets: number;
  suspiciousValues: SuspiciousValue[];
}

function getAttr(node: OrderedNode, name: string): string | undefined {
  return node[":@"] ? node[":@"][`@_${name}`] : undefined;
}

/**
 * Recursively searches a subtree for a stringProp/boolProp/intProp with the
 * given name. JMeter sometimes nests these inside an elementProp wrapper
 * (e.g. ThreadGroup.main_controller -> LoopController.loops) rather than as
 * a direct sibling, so this descends the whole subtree, not just one level.
 */
function getTextProp(elementChildren: OrderedNode[] | undefined, propName: string): string | undefined {
  for (const child of elementChildren || []) {
    const tag = Object.keys(child).find((k) => k !== ":@");
    if (!tag) continue;
    if ((tag === "stringProp" || tag === "boolProp" || tag === "intProp") && getAttr(child, "name") === propName) {
      const textNode = child[tag]?.[0];
      return textNode ? textNode["#text"] : "";
    }
    if (Array.isArray(child[tag])) {
      const found = getTextProp(child[tag], propName);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function collectText(nodes: OrderedNode[] | undefined, out: string[]) {
  for (const n of nodes || []) {
    for (const key of Object.keys(n)) {
      if (key === ":@") continue;
      if (key === "#text") {
        out.push(String(n["#text"]));
        continue;
      }
      if (Array.isArray(n[key])) collectText(n[key], out);
    }
  }
}

function scanForHardcodedValues(
  elementChildren: OrderedNode[] | undefined,
  samplerName: string,
  ctx: JmxFacts
) {
  const texts: string[] = [];
  collectText(elementChildren, texts);
  for (const t of texts) {
    if (JWT_LIKE.test(t) || UUID_LIKE.test(t)) {
      ctx.suspiciousValues.push({ samplerName, value: t });
    }
  }
}

export function lintJmx(xml: string): JmxFacts {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
  });

  let ordered: OrderedNode[];
  try {
    ordered = parser.parse(xml);
  } catch (e) {
    throw new Error(`Could not parse this file as XML: ${(e as Error).message}`);
  }

  const ctx: JmxFacts = {
    threadGroups: [],
    samplers: [],
    timers: 0,
    listeners: [],
    csvDataSets: 0,
    suspiciousValues: [],
  };

  function walk(siblings: OrderedNode[], currentSamplerName: string | null) {
    for (let i = 0; i < siblings.length; i++) {
      const node = siblings[i];
      const tag = Object.keys(node).find((k) => k !== ":@");
      if (!tag || tag === "hashTree") continue;

      const elementChildren: OrderedNode[] = node[tag];
      const name = getAttr(node, "testname") || tag;

      const next = siblings[i + 1];
      const nextTag = next ? Object.keys(next).find((k) => k !== ":@") : undefined;
      const childSiblings: OrderedNode[] = nextTag === "hashTree" ? next.hashTree || [] : [];

      let scopeSamplerName = currentSamplerName;

      if (THREADGROUP_TAGS.has(tag)) {
        ctx.threadGroups.push({
          name,
          numThreads: Number(getTextProp(elementChildren, "ThreadGroup.num_threads") || 0),
          rampTime: Number(getTextProp(elementChildren, "ThreadGroup.ramp_time") || 0),
          loops: getTextProp(elementChildren, "LoopController.loops") || "1",
        });
      } else if (SAMPLER_TAGS.has(tag)) {
        ctx.samplers.push({ name, hasAssertion: false, hasExtractor: false });
        scopeSamplerName = name;
        scanForHardcodedValues(elementChildren, name, ctx);
      } else if (ASSERTION_TAGS.has(tag) && scopeSamplerName) {
        const s = ctx.samplers.find((s) => s.name === scopeSamplerName);
        if (s) s.hasAssertion = true;
      } else if (EXTRACTOR_TAGS.has(tag) && scopeSamplerName) {
        const s = ctx.samplers.find((s) => s.name === scopeSamplerName);
        if (s) s.hasExtractor = true;
      } else if (TIMER_TAGS.has(tag)) {
        ctx.timers++;
      } else if (LISTENER_TAGS.has(tag)) {
        ctx.listeners.push({ name, enabled: getAttr(node, "enabled") !== "false" });
      } else if (tag === "CSVDataSet") {
        ctx.csvDataSets++;
      }

      if (childSiblings.length) walk(childSiblings, scopeSamplerName);
    }
  }

  const root = ordered.find((n) => Object.keys(n).find((k) => k !== ":@") === "jmeterTestPlan");
  const rootChildren: OrderedNode[] = root ? root.jmeterTestPlan : [];
  const rootHashTree = rootChildren.find(
    (n) => Object.keys(n).find((k) => k !== ":@") === "hashTree"
  );
  if (rootHashTree) walk(rootHashTree.hashTree, null);

  if (ctx.threadGroups.length === 0 && ctx.samplers.length === 0) {
    throw new Error(
      "No Thread Groups or HTTP Samplers found. Make sure this is a valid JMeter .jmx test plan."
    );
  }

  return ctx;
}
