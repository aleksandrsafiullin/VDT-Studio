import { extractBoundedJson } from "../../safe-json";
import type { SubscriptionCliParseResult } from "../types";

export interface ClaudeJsonParseLimits {
  maxBytes: number;
}

export const DEFAULT_CLAUDE_JSON_PARSE_LIMITS: ClaudeJsonParseLimits = Object.freeze({
  maxBytes: 4 * 1024 * 1024
});

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse Claude Code `--output-format json` responses.
 * Prefer `structured_output` when `--json-schema` is used; fall back to JSON in `result`.
 */
export function parseClaudeJsonOutput(
  stdout: string,
  stderr: string,
  limits: ClaudeJsonParseLimits = DEFAULT_CLAUDE_JSON_PARSE_LIMITS
): SubscriptionCliParseResult {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer.");
  }
  if (byteLength(stdout) > limits.maxBytes) {
    throw new Error(`Claude JSON output exceeds ${limits.maxBytes} bytes.`);
  }

  const combinedError = `${stdout}\n${stderr}`.trim();
  if (/auth|login|sign[\s-]?in|not logged in/i.test(combinedError)) {
    return { output: undefined, error: stderr.trim() || "Claude Code authentication required." };
  }
  if (/quota|usage limit|rate.?limit|billing/i.test(combinedError)) {
    return { output: undefined, error: stderr.trim() || "Claude Code usage limit reached." };
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return { output: undefined, error: stderr.trim() || "Claude Code produced no stdout." };
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(trimmed) as unknown;
  } catch {
    try {
      return { output: extractBoundedJson(trimmed, limits.maxBytes), rawText: trimmed };
    } catch {
      return { output: undefined, error: stderr.trim() || "Claude Code output was not valid JSON." };
    }
  }

  if (!isRecord(envelope)) {
    return { output: undefined, error: "Claude Code JSON envelope was not an object." };
  }

  if (envelope.is_error === true || envelope.subtype === "error") {
    const message =
      typeof envelope.result === "string" && envelope.result.trim()
        ? envelope.result
        : typeof envelope.error === "string"
          ? envelope.error
          : "Claude Code completed with an error result.";
    return { output: undefined, error: message };
  }

  if (envelope.structured_output !== undefined) {
    return { output: envelope.structured_output, rawText: trimmed };
  }

  if (typeof envelope.result === "string" && envelope.result.trim()) {
    try {
      return { output: extractBoundedJson(envelope.result, limits.maxBytes), rawText: envelope.result };
    } catch {
      return { output: envelope.result, rawText: envelope.result };
    }
  }

  return { output: undefined, error: "Claude Code JSON response did not include structured output." };
}
