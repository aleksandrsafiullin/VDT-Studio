/** Metrics-only serialization guard. Rejects prompt/payload/graph/event/secret
 * shaped keys. Qualification grant fields are intentionally *not* listed here:
 * benchmark records still carry them on `execution.*`. Sidecar records forbid
 * those keys in their own schema. */

export const FORBIDDEN_METRICS_KEYS = new Set([
  "prompt",
  "rawprompt",
  "systemprompt",
  "userprompt",
  "request",
  "requestbody",
  "response",
  "responsebody",
  "raw",
  "input",
  "output",
  "result",
  "payload",
  "body",
  "headers",
  "environment",
  "env",
  "secret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "password",
  "credential",
  "database",
  "dbpath",
  "snapshot",
  "events",
  "messages",
  "graph",
  "project",
  "content"
]);

const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}\b/giu,
  /\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9._-]{8,}\b/giu,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/giu
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function redactSensitiveText(value: unknown): string {
  let result = String(value);
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Fails if a metrics artifact accidentally serializes prompts, messages,
 * projects, credentials, or raw provider content.
 */
export function assertMetricsOnly(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertMetricsOnly(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && containsSecret(value)) {
      throw new Error(`Sensitive value is not allowed in metrics output at ${path}.`);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_METRICS_KEYS.has(normalizeKey(key))) {
      throw new Error(`Raw or sensitive field "${key}" is not allowed in metrics output at ${path}.`);
    }
    assertMetricsOnly(entry, `${path}.${key}`);
  }
}
