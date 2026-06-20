import {
  resolveProviderTarget,
  type ProxyProvider
} from "../../../../../lib/provider-target-security";
import { proxyRuntime } from "../../../../../lib/proxy-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS = new Set<ProxyProvider>([
  "anthropic",
  "openai",
  "azure",
  "google",
  "ollama",
  "senseaudio"
]);
const MAX_BODY_BYTES = 256 * 1024;
const MAX_ERROR_BYTES = 8 * 1024;
const MAX_MESSAGES = 100;
const MAX_MESSAGE_LENGTH = 32_000;
const MAX_TOTAL_MESSAGE_LENGTH = 128_000;
const MAX_STREAM_BYTES = 4 * 1024 * 1024;
const MAX_FRAME_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 8;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 60;
const RATE_WINDOW_MS = 60_000;

let activeRequests = 0;
let rateWindowStartedAt = Date.now();
let requestsInWindow = 0;

function acquireProxyCapacity(now = Date.now()) {
  if (now - rateWindowStartedAt >= RATE_WINDOW_MS) {
    rateWindowStartedAt = now;
    requestsInWindow = 0;
  }
  if (activeRequests >= DEFAULT_MAX_CONCURRENT_REQUESTS) {
    return { ok: false as const, retryAfterSeconds: 1 };
  }
  if (requestsInWindow >= DEFAULT_MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - rateWindowStartedAt)) / 1_000));
    return { ok: false as const, retryAfterSeconds };
  }

  activeRequests += 1;
  requestsInWindow += 1;
  let released = false;
  return {
    ok: true as const,
    release() {
      if (!released) {
        released = true;
        activeRequests -= 1;
      }
    }
  };
}

interface ProxyMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ProxyRequestBody {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ProxyMessage[];
}

interface UpstreamRequest {
  url: string;
  headers: Headers;
  body: string;
  format: "sse" | "ndjson";
}

function jsonError(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

function capacityError(retryAfterSeconds: number) {
  return Response.json(
    { ok: false, error: "Provider proxy capacity is temporarily exhausted." },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } }
  );
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

async function readBoundedBody(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    throw new Error("Request body is too large.");
  }
  if (!request.body) {
    throw new Error("Request body must be valid JSON.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function readString(
  record: Record<string, unknown>,
  key: "baseUrl" | "apiKey" | "model",
  maxLength: number,
  required = true
) {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }
  const normalized = key === "apiKey" ? value : value.trim();
  if (required && normalized.length === 0) {
    throw new Error(`${key} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${key} is too long.`);
  }
  return normalized;
}

function validateBody(value: unknown, provider: ProxyProvider): ProxyRequestBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const baseUrl = readString(body, "baseUrl", 2_048);
  const apiKey = readString(body, "apiKey", 16_384, provider !== "ollama");
  const model = readString(body, "model", 256);

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    throw new Error(`messages must contain between 1 and ${MAX_MESSAGES} items.`);
  }

  let totalLength = 0;
  const messages = body.messages.map((value, index): ProxyMessage => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`messages[${index}] must be an object.`);
    }
    const message = value as Record<string, unknown>;
    if (message.role !== "system" && message.role !== "user" && message.role !== "assistant") {
      throw new Error(`messages[${index}].role is invalid.`);
    }
    if (typeof message.content !== "string" || message.content.length === 0) {
      throw new Error(`messages[${index}].content must be a non-empty string.`);
    }
    if (message.content.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`messages[${index}].content is too long.`);
    }
    totalLength += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (totalLength > MAX_TOTAL_MESSAGE_LENGTH) {
    throw new Error("Combined message content is too long.");
  }

  return { baseUrl, apiKey, model, messages };
}

function appendPath(baseUrl: URL, suffix: string) {
  const target = new URL(baseUrl.toString());
  target.pathname = `${target.pathname.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
  return target;
}

function jsonHeaders() {
  return new Headers({ "content-type": "application/json", accept: "text/event-stream, application/x-ndjson" });
}

function buildUpstreamRequest(provider: ProxyProvider, baseUrl: URL, input: ProxyRequestBody): UpstreamRequest {
  const headers = jsonHeaders();
  let target: URL;
  let payload: Record<string, unknown>;
  let format: UpstreamRequest["format"] = "sse";

  if (provider === "anthropic") {
    target = appendPath(baseUrl, "messages");
    headers.set("x-api-key", input.apiKey);
    headers.set("anthropic-version", "2023-06-01");
    const system = input.messages.filter(({ role }) => role === "system").map(({ content }) => content).join("\n\n");
    payload = {
      model: input.model,
      max_tokens: 4_096,
      stream: true,
      messages: input.messages.filter(({ role }) => role !== "system")
    };
    if (system) {
      payload.system = system;
    }
  } else if (provider === "azure") {
    target = appendPath(baseUrl, `openai/deployments/${encodeURIComponent(input.model)}/chat/completions`);
    if (!target.searchParams.has("api-version")) {
      target.searchParams.set("api-version", "2024-10-21");
    }
    headers.set("api-key", input.apiKey);
    payload = { messages: input.messages, stream: true };
  } else if (provider === "google") {
    target = appendPath(baseUrl, `v1beta/models/${encodeURIComponent(input.model)}:streamGenerateContent`);
    target.searchParams.set("alt", "sse");
    headers.set("x-goog-api-key", input.apiKey);
    const systemText = input.messages.filter(({ role }) => role === "system").map(({ content }) => content).join("\n\n");
    payload = {
      contents: input.messages
        .filter(({ role }) => role !== "system")
        .map(({ role, content }) => ({ role: role === "assistant" ? "model" : "user", parts: [{ text: content }] }))
    };
    if (systemText) {
      payload.systemInstruction = { parts: [{ text: systemText }] };
    }
  } else if (provider === "ollama") {
    target = appendPath(baseUrl, "api/chat");
    if (input.apiKey) {
      headers.set("authorization", `Bearer ${input.apiKey}`);
    }
    payload = { model: input.model, messages: input.messages, stream: true };
    format = "ndjson";
  } else {
    target = appendPath(baseUrl, "chat/completions");
    headers.set("authorization", `Bearer ${input.apiKey}`);
    payload = { model: input.model, messages: input.messages, stream: true };
  }

  return { url: target.toString(), headers, body: JSON.stringify(payload), format };
}

function extractText(provider: ProxyProvider, value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (provider === "anthropic") {
    const delta = record.delta as Record<string, unknown> | undefined;
    return typeof delta?.text === "string" ? delta.text : undefined;
  }
  if (provider === "google") {
    const candidates = record.candidates as Array<Record<string, unknown>> | undefined;
    const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<Record<string, unknown>> | undefined;
    return parts?.map((part) => part.text).filter((text): text is string => typeof text === "string").join("") || undefined;
  }
  if (provider === "ollama") {
    const message = record.message as Record<string, unknown> | undefined;
    return typeof message?.content === "string" ? message.content : undefined;
  }
  const choices = record.choices as Array<Record<string, unknown>> | undefined;
  const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
  return typeof delta?.content === "string" ? delta.content : undefined;
}

function isDone(provider: ProxyProvider, value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (provider === "anthropic") {
    return record.type === "message_stop";
  }
  if (provider === "ollama") {
    return record.done === true;
  }
  return false;
}

function isUpstreamError(value: unknown) {
  return Boolean(value && typeof value === "object" && "error" in value);
}

function encodeEvent(event: "delta" | "done" | "error", data: Record<string, unknown> = {}) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseEventData(block: string) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

function normalizedStream(
  upstream: Response,
  provider: ProxyProvider,
  format: UpstreamRequest["format"],
  abort: AbortController,
  cleanup: () => void,
  clientAborted: () => boolean
) {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let totalBytes = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const separator = format === "sse" ? buffer.match(/\r?\n\r?\n/) : buffer.match(/\r?\n/);
          if (separator?.index !== undefined) {
            const block = buffer.slice(0, separator.index);
            buffer = buffer.slice(separator.index + separator[0].length);
            const data = format === "sse" ? parseEventData(block) : block.trim();
            if (!data || data === "[DONE]") {
              if (data === "[DONE]" && !completed) {
                completed = true;
                controller.enqueue(encodeEvent("done"));
                cleanup();
                controller.close();
                await reader.cancel();
                return;
              }
              continue;
            }
            let value: unknown;
            try {
              value = JSON.parse(data);
            } catch {
              continue;
            }
            if (isUpstreamError(value)) {
              completed = true;
              controller.enqueue(encodeEvent("error", { error: "Upstream stream failed." }));
              cleanup();
              controller.close();
              await reader.cancel();
              return;
            }
            const text = extractText(provider, value);
            if (text) {
              controller.enqueue(encodeEvent("delta", { text }));
              return;
            }
            if (isDone(provider, value) && !completed) {
              completed = true;
              controller.enqueue(encodeEvent("done"));
              cleanup();
              controller.close();
              await reader.cancel();
              return;
            }
            continue;
          }

          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (buffer.trim()) {
              const data = format === "sse" ? parseEventData(buffer) : buffer.trim();
              try {
                const parsed = JSON.parse(data);
                const text = extractText(provider, parsed);
                if (text) {
                  controller.enqueue(encodeEvent("delta", { text }));
                }
              } catch {
                // Ignore an incomplete final upstream frame.
              }
            }
            if (!completed) {
              completed = true;
              controller.enqueue(encodeEvent("done"));
            }
            cleanup();
            controller.close();
            return;
          }
          totalBytes += value.byteLength;
          if (totalBytes > MAX_STREAM_BYTES) {
            throw new Error("Upstream stream exceeded the maximum allowed size.");
          }
          buffer += decoder.decode(value, { stream: true });
          if (new TextEncoder().encode(buffer).byteLength > MAX_FRAME_BYTES) {
            throw new Error("Upstream stream frame exceeded the maximum allowed size.");
          }
        }
      } catch {
        if (!clientAborted()) {
          controller.enqueue(encodeEvent("error", { error: "Upstream stream failed." }));
        }
        cleanup();
        controller.close();
      }
    },
    async cancel() {
      abort.abort();
      cleanup();
      await reader.cancel();
    }
  });
}

async function consumeBoundedError(response: Response) {
  if (!response.body) {
    return;
  }
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (size <= MAX_ERROR_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      size += value.byteLength;
    }
    await reader.cancel();
  } finally {
    reader.releaseLock();
  }
}

type RouteContext = { params: Promise<{ provider: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { provider: rawProvider } = await context.params;
  if (!PROVIDERS.has(rawProvider as ProxyProvider)) {
    return jsonError("Unsupported provider.", 404);
  }
  const provider = rawProvider as ProxyProvider;

  let input: ProxyRequestBody;
  try {
    const rawBody = await readBoundedBody(request);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error("Request body must be valid JSON.");
    }
    input = validateBody(parsed, provider);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid request body.", 400);
  }

  const capacity = acquireProxyCapacity();
  if (!capacity.ok) {
    return capacityError(capacity.retryAfterSeconds);
  }

  const abort = new AbortController();
  let wasClientAborted = request.signal.aborted;
  let timedOut = false;
  const abortUpstream = () => {
    wasClientAborted = true;
    abort.abort(request.signal.reason);
  };
  if (request.signal.aborted) {
    abortUpstream();
  } else {
    request.signal.addEventListener("abort", abortUpstream, { once: true });
  }
  const upstreamTimeout = setTimeout(() => {
    timedOut = true;
    abort.abort(new DOMException("timeout", "TimeoutError"));
  }, UPSTREAM_TIMEOUT_MS);
  const cleanupUpstream = () => {
    clearTimeout(upstreamTimeout);
    request.signal.removeEventListener("abort", abortUpstream);
    capacity.release();
  };

  let resolvedTarget;
  try {
    resolvedTarget = await withAbort(resolveProviderTarget(input.baseUrl, provider), abort.signal);
  } catch (error) {
    cleanupUpstream();
    if (timedOut) {
      return jsonError("Upstream provider request timed out.", 504);
    }
    if (wasClientAborted) {
      return jsonError("Provider request was aborted.", 499);
    }
    return jsonError(error instanceof Error ? error.message : "Provider target is not allowed.", 400);
  }

  const upstreamRequest = buildUpstreamRequest(provider, resolvedTarget.url, input);
  resolvedTarget = { ...resolvedTarget, url: new URL(upstreamRequest.url) };

  let upstream: Response;
  try {
    upstream = await proxyRuntime.request(resolvedTarget, {
      method: "POST",
      headers: upstreamRequest.headers,
      body: upstreamRequest.body,
      signal: abort.signal
    });
  } catch {
    cleanupUpstream();
    if (timedOut) {
      return jsonError("Upstream provider request timed out.", 504);
    }
    return jsonError(wasClientAborted ? "Provider request was aborted." : "Upstream provider request failed.", wasClientAborted ? 499 : 502);
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    try {
      await consumeBoundedError(upstream);
    } finally {
      cleanupUpstream();
    }
    return jsonError("Upstream provider redirects are not allowed.", 502);
  }
  if (!upstream.ok || !upstream.body) {
    try {
      await consumeBoundedError(upstream);
    } finally {
      cleanupUpstream();
    }
    return jsonError(`Upstream provider request failed with status ${upstream.status}.`, 502);
  }

  return new Response(
    normalizedStream(upstream, provider, upstreamRequest.format, abort, cleanupUpstream, () => wasClientAborted),
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      }
    }
  );
}
