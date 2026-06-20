import { z } from "zod";
import type { AiProviderFetch } from "../types";

export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

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
