import { z } from "zod";
import type { AiProviderFetch } from "../types";

export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

/** Raw local APIs have no continuation cursor. Keep the immutable initial
 * brief/catalog plus the last confirmed response; the caller's bounded semantic
 * checkpoint supplies the remaining progress. Never accumulate a full history. */
export class LocalModelConversationContext {
  private initialPrompt: string | undefined;
  private lastOutput: string | undefined;

  messages(systemPrompt: string, userPrompt: string): Array<{ role: "system" | "user" | "assistant"; content: string }> {
    return [
      { role: "system", content: systemPrompt },
      ...(this.initialPrompt && this.lastOutput && this.initialPrompt !== userPrompt ? [
        { role: "user" as const, content: this.initialPrompt },
        { role: "assistant" as const, content: this.lastOutput }
      ] : []),
      { role: "user", content: userPrompt }
    ];
  }

  confirm(userPrompt: string, output: string): void {
    this.initialPrompt ??= userPrompt;
    this.lastOutput = output;
  }
}

interface ProviderRequestOptions {
  providerName: string;
  fetch: AiProviderFetch;
  url: string;
  init: RequestInit;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  maxResponseBytes?: number | undefined;
}

function positiveInteger(value: number | undefined, fallback: number, name: string) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return resolved;
}

async function readBoundedText(response: Response, limit: number, providerName: string) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new Error(`${providerName} response exceeded the maximum allowed size.`);
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > limit) {
      throw new Error(`${providerName} response exceeded the maximum allowed size.`);
    }
    return new TextDecoder().decode(buffer);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error(`${providerName} response exceeded the maximum allowed size.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function requestProviderJson(options: ProviderRequestOptions): Promise<unknown> {
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_PROVIDER_TIMEOUT_MS, "timeoutMs");
  const maxResponseBytes = positiveInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    "maxResponseBytes"
  );
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(options.signal?.reason);

  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await options.fetch(options.url, {
      ...options.init,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`${options.providerName} request failed with status ${response.status}.`);
    }

    const raw = await readBoundedText(response, maxResponseBytes, options.providerName);
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`${options.providerName} returned an invalid JSON response envelope.`);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        timedOut
          ? `${options.providerName} request timed out after ${timeoutMs}ms.`
          : `${options.providerName} request was aborted.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

/** A live local generation can outlast a fixed wall-clock deadline while
 * continuing to make progress. Bound cold prefill, idle time, total time and
 * bytes independently; caller cancellation still closes the same request. */
export async function requestProviderNdjson(options: ProviderRequestOptions & {
  firstChunkTimeoutMs?: number;
  idleTimeoutMs?: number;
  onChunk: (chunk: Record<string, unknown>) => void;
}): Promise<void> {
  const hardMs = positiveInteger(options.timeoutMs, 480_000, "timeoutMs");
  const firstMs = positiveInteger(options.firstChunkTimeoutMs, 300_000, "firstChunkTimeoutMs");
  const idleMs = positiveInteger(options.idleTimeoutMs, 60_000, "idleTimeoutMs");
  const limit = positiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, "maxResponseBytes");
  const controller = new AbortController();
  let timeoutReason: string | undefined;
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const expire = (reason: string) => { timeoutReason = reason; controller.abort(); };
  const hard = setTimeout(() => expire(`exceeded the ${hardMs}ms turn limit`), hardMs);
  let idle = setTimeout(() => expire(`produced no response within ${firstMs}ms`), firstMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await options.fetch(options.url, { ...options.init, signal: controller.signal });
    if (!response.ok) throw new Error(`${options.providerName} request failed with status ${response.status}.`);
    if (!response.body) throw new Error(`${options.providerName} returned no response stream.`);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let pending = "";
    const parse = (line: string) => {
      if (!line.trim()) return;
      let chunk: unknown;
      try { chunk = JSON.parse(line); } catch { throw new Error(`${options.providerName} returned an invalid JSON stream frame.`); }
      if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) throw new Error(`${options.providerName} returned an invalid stream envelope.`);
      options.onChunk(chunk as Record<string, unknown>);
      clearTimeout(idle);
      idle = setTimeout(() => expire(`stalled for ${idleMs}ms`), idleMs);
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error(`${options.providerName} response exceeded the maximum allowed size.`);
      pending += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
    }
    parse(pending + decoder.decode());
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timeoutReason ? `${options.providerName} ${timeoutReason}.` : `${options.providerName} request was aborted.`);
    }
    throw error;
  } finally {
    clearTimeout(hard);
    clearTimeout(idle);
    options.signal?.removeEventListener("abort", abort);
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}

function extractJsonValue(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const direct = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(direct) as unknown;
  } catch {
    // Some providers still wrap JSON in prose despite JSON mode.
  }

  for (let start = 0; start < direct.length; start += 1) {
    const opening = direct[start];
    if (opening !== "{" && opening !== "[") continue;

    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < direct.length; index += 1) {
      const character = direct[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{" || character === "[") {
        stack.push(character);
      } else if (character === "}" || character === "]") {
        const expected = character === "}" ? "{" : "[";
        if (stack.pop() !== expected) break;
        if (stack.length === 0) {
          try {
            return JSON.parse(direct.slice(start, index + 1)) as unknown;
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error("AI response did not contain valid JSON.");
}

export function parseStructuredOutput<TOutput>(raw: string, schema: unknown): TOutput {
  const output = extractJsonValue(raw);
  try {
    return (schema instanceof z.ZodType ? schema.parse(output) : output) as TOutput;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `AI response failed schema validation: ${error.message}`
        : "AI response failed schema validation."
    );
  }
}

export function asJsonSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== "object" || schema instanceof z.ZodType || Array.isArray(schema)) {
    return undefined;
  }
  return schema as Record<string, unknown>;
}

export function requireNonEmptyText(value: unknown, providerName: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${providerName} returned no structured content.`);
  }
  return value;
}

export function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
