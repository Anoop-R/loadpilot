/**
 * Converts JMeter's raw assertion failure message into plain English.
 *
 * JMeter's ResponseAssertion (EQUALS mode) outputs a character-level diff:
 *   "Test failed: code expected to equal /
 *    ****** received  : [[[4]]]00
 *    ****** comparison: [[[2]]]00
 *    /"
 *
 * The [[[x]]] brackets mark characters that DIFFERED. Characters outside
 * brackets matched. So [[[4]]]00 means received "400" (4 was wrong, 00 matched).
 * This reconstructs the actual values and returns plain English.
 */

function stripBrackets(s: string): string {
  return s.replace(/\[\[\[/g, "").replace(/\]\]\]/g, "");
}

export function parseAssertionMessage(raw: string): string {
  if (!raw) return raw;

  const receivedMatch = raw.match(/\*+\s*received\s*:\s*(.+)/i);
  const comparisonMatch = raw.match(/\*+\s*comparison\s*:\s*(.+)/i);

  if (receivedMatch && comparisonMatch) {
    const received = stripBrackets(receivedMatch[1].trim());
    const expected = stripBrackets(comparisonMatch[1].trim());

    if (/^\d+$/.test(received) && /^\d+$/.test(expected)) {
      const code = Number(received);
      const hint =
        code === 400 ? " — server rejected the request (bad request body or headers)" :
        code === 401 ? " — authentication failed, check your API key or token" :
        code === 403 ? " — access denied, check permissions" :
        code === 404 ? " — endpoint not found, check the URL path" :
        code === 429 ? " — rate limited, too many requests sent too quickly" :
        code === 500 ? " — server crashed, check server-side logs" :
        code === 502 ? " — bad gateway, server is down or overloaded" :
        code === 503 ? " — service temporarily unavailable" :
        code === 504 ? " — gateway timeout, server took too long" :
        "";
      return `Status ${received}${hint} (expected ${expected})`;
    }

    if (raw.toLowerCase().includes("duration") || raw.toLowerCase().includes("elapsed")) {
      return `Response took ${received}ms — limit was ${expected}ms`;
    }

    return `Expected "${expected}" but got "${received}"`;
  }

  // Fallback: strip JMeter boilerplate and brackets, return cleaner text
  return raw
    .replace(/Test failed: code expected to equal \//gi, "")
    .replace(/\*+\s*(received|comparison)\s*:/gi, "")
    .replace(/\[\[\[/g, "").replace(/\]\]\]/g, "")
    .replace(/\/\s*$/, "")
    .replace(/\n+/g, " ")
    .trim() || raw;
}
