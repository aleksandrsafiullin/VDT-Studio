import { extractBoundedJson } from "../../safe-json";
import type { SubscriptionCliParseResult } from "../types";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_LINES = 100_000;
const byteLength = (value: string) => Buffer.byteLength(value, "utf8");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findText(value: Record<string, unknown>): string | undefined {
  for (const candidate of [value.content, value.text, value.message, value.response, value.result]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (isRecord(candidate)) {
      const nested = findText(candidate);
      if (nested) return nested;
    }
  }
  if (isRecord(value.data)) return findText(value.data);
  return undefined;
}

/** Parse Copilot `--output-format=json` JSONL, preferring the terminal assistant message. */
export function parseCopilotJsonlOutput(stdout: string, stderr: string, maxBytes = MAX_BYTES): SubscriptionCliParseResult {
  if (byteLength(stdout) > maxBytes) throw new Error(`Copilot JSONL output exceeds ${maxBytes} bytes.`);
  const trimmed = stdout.trim();
  if (!trimmed) return { output: undefined, error: stderr.trim() || "Copilot CLI produced no stdout." };

  let lastAssistantText: string | undefined;
  let lastDirectObject: unknown;
  let terminalError: string | undefined;
  let lineCount = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineCount += 1;
    if (lineCount > MAX_LINES) throw new Error(`Copilot JSONL output exceeds ${MAX_LINES} lines.`);
    let event: unknown;
    try { event = JSON.parse(line) as unknown; } catch { continue; }
    if (!isRecord(event)) continue;
    const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
    if (type.includes("error") || type.endsWith("failed")) terminalError = findText(event) ?? "Copilot CLI reported an error.";
    if (type.includes("assistant") || type === "message") lastAssistantText = findText(event) ?? lastAssistantText;
    if ("ok" in event || "projectTitle" in event || "rootNodeId" in event) lastDirectObject = event;
  }
  if (terminalError) return { output: undefined, error: terminalError };
  if (lastDirectObject !== undefined) return { output: lastDirectObject, rawText: JSON.stringify(lastDirectObject) };
  if (lastAssistantText) {
    try { return { output: extractBoundedJson(lastAssistantText, maxBytes), rawText: lastAssistantText }; }
    catch { return { output: undefined, rawText: lastAssistantText, error: "Copilot response did not contain one bounded JSON document." }; }
  }
  try { return { output: extractBoundedJson(trimmed, maxBytes), rawText: trimmed }; }
  catch { return { output: undefined, error: stderr.trim() || "Copilot JSONL did not contain an assistant response." }; }
}
