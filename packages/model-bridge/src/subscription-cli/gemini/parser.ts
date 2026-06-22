import { extractBoundedJson } from "../../safe-json";
import type { SubscriptionCliParseResult } from "../types";

const MAX_BYTES = 4 * 1024 * 1024;
const byteLength = (value: string) => Buffer.byteLength(value, "utf8");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (!isRecord(error)) return undefined;
  return [error.message, error.type, error.code].filter((value): value is string => typeof value === "string").join(": ") || undefined;
}

/** Parse Gemini headless `--output-format json` envelopes. */
export function parseGeminiJsonOutput(stdout: string, stderr: string, maxBytes = MAX_BYTES): SubscriptionCliParseResult {
  if (byteLength(stdout) > maxBytes) throw new Error(`Gemini JSON output exceeds ${maxBytes} bytes.`);
  const trimmed = stdout.trim();
  if (!trimmed) return { output: undefined, error: stderr.trim() || "Gemini CLI produced no stdout." };

  let envelope: unknown;
  try {
    envelope = JSON.parse(trimmed) as unknown;
  } catch {
    try {
      return { output: extractBoundedJson(trimmed, maxBytes), rawText: trimmed };
    } catch {
      return { output: undefined, error: stderr.trim() || "Gemini CLI output was not valid JSON." };
    }
  }
  if (!isRecord(envelope)) return { output: undefined, error: "Gemini CLI JSON envelope was not an object." };
  const reportedError = errorText(envelope.error);
  if (reportedError) return { output: undefined, error: reportedError };
  if (typeof envelope.response !== "string" || !envelope.response.trim()) {
    return { output: undefined, error: "Gemini CLI JSON response did not include response text." };
  }
  try {
    return { output: extractBoundedJson(envelope.response, maxBytes), rawText: envelope.response };
  } catch {
    return { output: undefined, rawText: envelope.response, error: "Gemini response did not contain one bounded JSON document." };
  }
}
