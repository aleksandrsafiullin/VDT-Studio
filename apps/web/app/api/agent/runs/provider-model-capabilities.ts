import { readBoundedText, type ModelReasoningCapabilities, type ModelReasoningValue, isModelReasoningValue } from "@vdt-studio/ai-harness";
import { createLocalRuntimeContext } from "@vdt-studio/local-runner/server-runtime";
import { BYOK_GATEWAY_PRESETS } from "@/lib/execution-mode-catalog";
import { z } from "zod";

export const modelReasoningValueSchema = z.union([z.boolean(), z.string().regex(/^[a-z][a-z0-9_.-]{0,47}$/), z.number().int().min(0).max(32768)]);
const modelId = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const apiConfigSchema = z.object({
  model: modelId, apiKey: z.string().min(1).max(1024),
  baseUrl: z.string().max(2048).optional(), endpoint: z.string().max(2048).optional(),
  deployment: modelId.optional(), apiVersion: z.string().regex(/^[0-9A-Za-z-]{1,40}$/).optional(),
  anthropicVersion: z.string().regex(/^[0-9-]{1,40}$/).optional(),
  maxTokens: z.number().int().min(1).max(32768).optional(), modelReasoning: modelReasoningValueSchema.optional()
}).strict();
export const providerConnectionSchema = z.union([
  z.object({ providerId: z.enum(["openai_compatible", "anthropic", "gemini", "azure_openai"]), providerConfig: apiConfigSchema }).strict(),
  z.object({ providerId: z.literal("local_runner"), providerConfig: z.object({
    backendId: z.enum(["ollama", "lm_studio", "vllm"]), model: modelId,
    modelReasoning: modelReasoningValueSchema.optional()
  }).strict() }).strict()
]);
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;
export type ApiConnection = Extract<ProviderConnection, { providerId: "openai_compatible" | "anthropic" | "gemini" | "azure_openai" }>;

export class ProviderConnectionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** No ambient credential fallback: the key always travels with its selected endpoint. */
export function resolveApiConnection(input: ApiConnection, env: Readonly<Record<string, string | undefined>> = process.env) {
  const defaults = { openai_compatible: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com", gemini: "https://generativelanguage.googleapis.com", azure_openai: "" };
  const envNames = { openai_compatible: "OPENAI_COMPATIBLE_BASE_URL", anthropic: "ANTHROPIC_BASE_URL", gemini: "GEMINI_BASE_URL", azure_openai: "AZURE_OPENAI_ENDPOINT" };
  const config = input.providerConfig;
  const baseUrl = (input.providerId === "azure_openai" ? config.endpoint ?? config.baseUrl : config.baseUrl)?.replace(/\/+$/, "") ?? defaults[input.providerId];
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new ProviderConnectionError("Select a valid provider endpoint."); }
  if (url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol)) throw new ProviderConnectionError("Provider endpoint must not contain credentials, query parameters or fragments.");
  const configured = env[envNames[input.providerId]]?.replace(/\/+$/, "");
  const preset = BYOK_GATEWAY_PRESETS.some((entry) => entry.baseUrl?.replace(/\/+$/, "") === baseUrl);
  const azure = input.providerId === "azure_openai" && url.protocol === "https:" && /^[a-z0-9-]+\.openai\.azure\.com$/i.test(url.hostname) && url.pathname === "/" && !url.port;
  const explicitHostOverride = env.VDT_ALLOW_REQUEST_PROVIDER_URLS === "true" && env.VDT_ALLOW_PRIVATE_PROVIDER_URLS === "true";
  if (!(baseUrl === defaults[input.providerId] || preset || azure || configured === baseUrl || explicitHostOverride)) throw new ProviderConnectionError("This custom endpoint must be configured on the trusted host before API chat can use it.");
  if (url.protocol !== "https:" && configured !== baseUrl && !explicitHostOverride) throw new ProviderConnectionError("API chat requires HTTPS.");
  return { providerId: input.providerId, providerConfig: { ...config,
    ...(input.providerId === "azure_openai" ? { endpoint: baseUrl, deployment: config.deployment ?? config.model } : { baseUrl })
  } };
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const levels = (value: unknown): ModelReasoningValue[] => Array.isArray(value) ? [...new Set(value.filter(isModelReasoningValue))].slice(0, 16) : [];

export function parseProviderReasoning(metadata: unknown, providerId: string): ModelReasoningCapabilities | undefined {
  const meta = record(metadata), caps = record(meta.capabilities);
  if (providerId === "ollama") {
    const thinking = record(meta.thinking), values = levels(thinking.values).filter((value) => typeof value !== "number");
    if (!values.length || (values.length === 1 && values[0] === false)) return undefined;
    return { parameter: "think", values, source: "provider", ...(values.some((value) => value === thinking.default) ? { defaultValue: thinking.default as ModelReasoningValue } : {}) };
  }
  if (providerId === "anthropic") {
    const effort = record(caps.effort);
    if (effort.supported !== true) return undefined;
    const values = ["low", "medium", "high", "xhigh", "max"].filter((value) => record(effort[value]).supported === true);
    if (!values.length) return undefined;
    return { parameter: "output_config.effort", values, source: "provider", adaptiveThinking: record(record(record(caps.thinking).types).adaptive).supported === true };
  }
  const reasoning = record(meta.reasoning ?? caps.reasoning);
  const values = levels(meta.supported_reasoning_efforts ?? reasoning.values ?? reasoning.supported_efforts);
  if (values.length) return { parameter: "reasoning_effort", values: values.filter((v) => typeof v === "string"), source: "provider" };
  if (providerId === "gemini") {
    const thinking = record(meta.thinkingConfig ?? caps.thinking);
    const values = levels(thinking.supportedLevels ?? thinking.values).filter((v) => typeof v === "string");
    if (values.length) return { parameter: "thinkingConfig.thinkingLevel", values, source: "provider" };
  }
  return undefined;
}

/** Public Generate Content documentation table; no undocumented model-name guesses. */
export function parseGeminiThinkingGuide(html: string, model: string): ModelReasoningCapabilities | undefined {
  const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const table of html.matchAll(/<table\b[\s\S]*?<\/table>/g)) {
    const rows = [...table[0].matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((match) => [...match[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)]
      .map((cell) => cell[1]!.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim()));
    const column = rows[0]?.findIndex((cell) => normalized(cell) === normalized(model)) ?? -1;
    if (column > 0) {
      const supported = rows.slice(1).filter((cells) => /^(minimal|low|medium|high)$/i.test(cells[0] ?? "") && /^Supported\b/i.test(cells[column] ?? ""));
      if (supported.length) return { parameter: "thinkingConfig.thinkingLevel", values: supported.map((cells) => cells[0]!.toLowerCase()), source: "documentation" };
    }
    const row = rows.find((cells) => normalized(cells[0] ?? "") === normalized(model));
    const values = row ? ["minimal", "low", "medium", "high"].filter((level) => new RegExp(`\\b${level}\\b`, "i").test(row[row.length - 1] ?? "")) : [];
    if (values.length) return { parameter: "thinkingConfig.thinkingLevel", values, source: "documentation" };
  }
  return undefined;
}

export function openAiCardSupportsTextChat(markdown: string): boolean | undefined {
  const chat = markdown.split("\n").find((line) => /^\| Chat Completions \|/.test(line));
  if (chat && /\| Not supported \|\s*$/.test(chat)) return false;
  const modalities = markdown.split("\n").filter((line) => /^- (Input|Output) modalities:/.test(line));
  if (modalities.some((line) => !/\btext\b/i.test(line))) return false;
  return chat && /\| Supported \|\s*$/.test(chat) ? true : undefined;
}

let geminiGuide: { until: number; html: string } | undefined;
async function geminiDocumentedReasoning(metadata: Record<string, unknown>, model: string, fetcher: typeof fetch): Promise<ModelReasoningCapabilities | undefined> {
  if (metadata.thinking !== true) return undefined;
  // Every documented 2.5 text-thinking budget range includes these explicit
  // budgets. They are token counts, not invented Low/High presets. Default
  // remains omitted; do not offer Off to a model that cannot disable thinking.
  if (/^gemini-2\.5-(?:pro|flash)(?:-|$)/.test(model)) return { parameter: "thinkingConfig.thinkingBudget", values: [...(/^gemini-2\.5-flash(?:-|$)/.test(model) ? [0] : []), 1024, 4096, 8192, 16384], source: "documentation" };
  try {
    if (!geminiGuide || geminiGuide.until < Date.now()) {
      const signal = AbortSignal.timeout(5000);
      const response = await fetcher("https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en", { redirect: "error", signal });
      if (!response.ok) { await response.body?.cancel(); return undefined; }
      geminiGuide = { until: Date.now() + 3_600_000, html: await readBoundedText(response, 1024 * 1024, "Thinking documentation", signal) };
    }
    return parseGeminiThinkingGuide(geminiGuide.html, typeof metadata.baseModelId === "string" ? metadata.baseModelId : model);
  } catch { return undefined; }
}

/** A model card is capability data only. No model IDs or instructions enter the catalog. */
export function parseOpenAiReasoningCard(markdown: string, model: string): ModelReasoningCapabilities | undefined {
  if (!markdown.split("\n").some((line) => line.match(/^(?:- )?Model ID:\s*`?([^`\s]+)`?\s*$/)?.[1] === model)) return undefined;
  const line = markdown.split("\n").find((line) => /^`reasoning\.effort` supports /.test(line));
  if (!line || line.length > 600) return undefined;
  const allowed = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const values = [...line.matchAll(/`([a-z]+)`/g)].map((match) => match[1]!).filter((value) => allowed.includes(value));
  return values.length ? { parameter: "reasoning_effort", values: [...new Set(values)], source: "documentation" } : undefined;
}

export async function boundedProviderMetadata(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch, timeoutMs = 10_000): Promise<unknown> {
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: "error", cache: "no-store", signal }); }
  catch { throw new ProviderConnectionError("Could not reach the selected provider. Check the connection and retry.", 502); }
  if (!response.ok) { await response.body?.cancel(); throw new ProviderConnectionError(`Provider model access failed (HTTP ${response.status}). Check the selected model and credentials.`, response.status === 401 || response.status === 403 ? response.status : 502); }
  try { return JSON.parse(await readBoundedText(response, 256 * 1024, "Provider metadata", signal)); }
  catch { throw new ProviderConnectionError("Provider model metadata was invalid or too large.", 502); }
}

const docsCache = new Map<string, { until: number; value: ModelReasoningCapabilities | undefined }>();
async function openAiCard(model: string, fetcher: typeof fetch): Promise<ModelReasoningCapabilities | undefined> {
  if (!/^[a-z0-9][a-z0-9.-]{0,119}$/.test(model)) return undefined;
  const cached = docsCache.get(model);
  if (cached && cached.until > Date.now()) return cached.value;
  try {
    const signal = AbortSignal.timeout(5000);
    const response = await fetcher(`https://developers.openai.com/api/docs/models/${encodeURIComponent(model)}.md`, { redirect: "error", signal });
    if (!response.ok) { await response.body?.cancel(); return undefined; }
    const markdown = await readBoundedText(response, 128 * 1024, "Model card", signal);
    if (openAiCardSupportsTextChat(markdown) === false) throw new ProviderConnectionError("This model does not support text chat through the configured API. Choose a chat model.");
    const value = parseOpenAiReasoningCard(markdown, model);
    if (docsCache.size >= 128) docsCache.delete(docsCache.keys().next().value!);
    docsCache.set(model, { until: Date.now() + (value ? 3_600_000 : 60_000), value });
    return value;
  } catch (error) { if (error instanceof ProviderConnectionError) throw error; return undefined; }
}

export async function providerModelCapabilities(input: ProviderConnection, fetcher: typeof fetch = fetch): Promise<ModelReasoningCapabilities | undefined> {
  if (input.providerId === "local_runner") {
    const { backendId, model } = input.providerConfig;
    const manifest = createLocalRuntimeContext().manifests.get(backendId);
    const baseUrl = manifest?.localHttp?.baseUrl.replace(/\/$/, "");
    if (!baseUrl) throw new ProviderConnectionError("Local model endpoint is unavailable.");
    const metadata = backendId === "ollama"
      ? await boundedProviderMetadata(`${baseUrl.replace(/\/v1$/, "")}/api/show`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) }, fetcher)
      : await boundedProviderMetadata(`${baseUrl}/models/${encodeURIComponent(model)}`, {}, fetcher);
    if (backendId === "ollama" && Array.isArray(record(metadata).capabilities) && !(record(metadata).capabilities as unknown[]).includes("completion"))
      throw new ProviderConnectionError("This installed model does not support chat completion. Choose a chat model.");
    return parseProviderReasoning(metadata, backendId);
  }
  const { providerId, providerConfig: config } = resolveApiConnection(input);
  if (providerId === "azure_openai") throw new ProviderConnectionError("Azure deployment access is checked when chat starts; this endpoint does not expose model reasoning metadata.");
  const base = String(config.baseUrl).replace(/\/$/, "");
  const url = providerId === "anthropic" ? `${base}${base.endsWith("/v1") ? "" : "/v1"}/models/${encodeURIComponent(config.model)}`
    : providerId === "gemini" ? `${base}/v1beta/models/${encodeURIComponent(config.model.replace(/^models\//, ""))}`
    : `${base}/models/${encodeURIComponent(config.model)}`;
  const headers = providerId === "anthropic" ? { "x-api-key": config.apiKey, "anthropic-version": config.anthropicVersion ?? "2023-06-01" }
    : providerId === "gemini" ? { "x-goog-api-key": config.apiKey } : { authorization: `Bearer ${config.apiKey}` };
  const metadata = await boundedProviderMetadata(url, { headers }, fetcher);
  const capabilities = parseProviderReasoning(metadata, providerId);
  if (capabilities) return capabilities;
  if (providerId === "gemini" && base === "https://generativelanguage.googleapis.com") return geminiDocumentedReasoning(record(metadata), config.model.replace(/^models\//, ""), fetcher);
  // Only OpenAI's direct endpoint may consult OpenAI's public model card.
  // Private/gateway model identifiers and all credentials stay with that provider.
  return providerId === "openai_compatible" && base === "https://api.openai.com/v1" ? openAiCard(config.model, fetcher) : undefined;
}

export function validatedReasoningConfig(capabilities: ModelReasoningCapabilities | undefined, value: ModelReasoningValue | undefined): Record<string, unknown> {
  if (value === undefined) return {};
  if (!capabilities?.values.includes(value)) throw new ProviderConnectionError("The selected reasoning level is not supported by this model. Refresh its options or choose Default.");
  if (capabilities.parameter === "think") {
    if (typeof value === "number") throw new ProviderConnectionError("Ollama thinking does not accept a token count.");
    return { think: value };
  }
  if (capabilities.parameter === "thinkingConfig.thinkingBudget" && typeof value === "number") return { thinkingBudget: value };
  if (typeof value !== "string") throw new ProviderConnectionError("This API requires a named reasoning level.");
  if (capabilities.parameter === "thinkingConfig.thinkingLevel") return { thinkingLevel: value };
  return { reasoningEffort: value, ...(capabilities.adaptiveThinking ? { adaptiveThinking: true } : {}) };
}
