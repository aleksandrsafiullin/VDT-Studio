import { AgentToolError } from "../tool-registry";
import type { ResearchProvider, ResearchPurpose, ResearchSearchResult } from "./research-tools";

type ResearchFetch = typeof fetch;

export type ResearchProviderEnv = Record<string, string | undefined>;

export interface ResearchProviderResolverOptions {
  fetch?: ResearchFetch | undefined;
  now?: (() => string) | undefined;
}

interface ResearchProviderConfig {
  apiKey: string;
  fetch: ResearchFetch;
  timeoutMs: number;
  maxResults: number;
  now: () => string;
}

const BRAVE_WEB_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_TOOL_RESULTS = 10;

export function resolveResearchProviderFromEnv(
  env: ResearchProviderEnv = process.env,
  options: ResearchProviderResolverOptions = {}
): ResearchProvider {
  const providerId = normalizeProviderId(env.VDT_RESEARCH_PROVIDER) ?? inferProviderId(env);
  if (!providerId || providerId === "noop") {
    return noConfiguredProvider();
  }

  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) {
    return noConfiguredProvider(`Research provider "${providerId}" requires a server-side Fetch API.`);
  }

  const config = {
    fetch: fetcher,
    timeoutMs: readPositiveInteger(env.VDT_RESEARCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 30_000),
    maxResults: readPositiveInteger(env.VDT_RESEARCH_MAX_RESULTS, DEFAULT_MAX_RESULTS, 1, MAX_TOOL_RESULTS),
    now: options.now ?? (() => new Date().toISOString())
  };

  if (providerId === "brave") {
    const apiKey = trim(env.BRAVE_SEARCH_API_KEY) ?? trim(env.BRAVE_API_KEY);
    return apiKey
      ? new BraveSearchProvider({ ...config, apiKey })
      : noConfiguredProvider("Brave research provider is selected, but BRAVE_SEARCH_API_KEY is not configured.");
  }

  if (providerId === "tavily") {
    const apiKey = trim(env.TAVILY_API_KEY);
    return apiKey
      ? new TavilySearchProvider({ ...config, apiKey })
      : noConfiguredProvider("Tavily research provider is selected, but TAVILY_API_KEY is not configured.");
  }

  return noConfiguredProvider(`Unsupported research provider "${providerId}".`);
}

export class BraveSearchProvider implements ResearchProvider {
  readonly id = "brave";
  readonly #config: ResearchProviderConfig;

  constructor(config: ResearchProviderConfig) {
    this.#config = config;
  }

  async search(
    query: string,
    options: { purpose: ResearchPurpose; maxResults: number; signal?: AbortSignal | undefined }
  ): Promise<ResearchSearchResult[]> {
    const maxResults = clampResults(options.maxResults, this.#config.maxResults);
    const url = new URL(BRAVE_WEB_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(maxResults));
    url.searchParams.set("result_filter", "web");
    url.searchParams.set("safesearch", "moderate");

    const payload = await fetchResearchJson(this.id, this.#config.fetch, url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-subscription-token": this.#config.apiKey
      }
    }, this.#config.timeoutMs, options.signal);

    const web = isRecord(payload) && isRecord(payload.web) ? payload.web : undefined;
    const rawResults = Array.isArray(web?.results) ? web.results : [];
    return rawResults
      .map((entry, index) => normalizeBraveResult(entry, index, this.#config.now()))
      .filter((entry): entry is ResearchSearchResult => Boolean(entry))
      .slice(0, maxResults);
  }
}

export class TavilySearchProvider implements ResearchProvider {
  readonly id = "tavily";
  readonly #config: ResearchProviderConfig;

  constructor(config: ResearchProviderConfig) {
    this.#config = config;
  }

  async search(
    query: string,
    options: { purpose: ResearchPurpose; maxResults: number; signal?: AbortSignal | undefined }
  ): Promise<ResearchSearchResult[]> {
    const maxResults = clampResults(options.maxResults, this.#config.maxResults);
    const payload = await fetchResearchJson(this.id, this.#config.fetch, new URL(TAVILY_SEARCH_URL), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.#config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: maxResults,
        topic: "general",
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        include_favicon: false
      })
    }, this.#config.timeoutMs, options.signal);

    const rawResults = isRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
    return rawResults
      .map((entry, index) => normalizeTavilyResult(entry, index, this.#config.now()))
      .filter((entry): entry is ResearchSearchResult => Boolean(entry))
      .slice(0, maxResults);
  }
}

async function fetchResearchJson(
  providerId: string,
  fetcher: ResearchFetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal | undefined
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(signal?.reason);
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const response = await fetcher(url, {
      ...init,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new AgentToolError(
        researchErrorCode(response.status),
        `Research provider "${providerId}" request failed with status ${response.status}.`,
        { providerId, status: response.status }
      );
    }
    try {
      return await response.json();
    } catch {
      throw new AgentToolError(
        "RESEARCH_PROVIDER_BAD_RESPONSE",
        `Research provider "${providerId}" returned invalid JSON.`,
        { providerId }
      );
    }
  } catch (error) {
    if (error instanceof AgentToolError) throw error;
    if (controller.signal.aborted) {
      throw new AgentToolError(
        timedOut ? "RESEARCH_PROVIDER_TIMEOUT" : "RESEARCH_PROVIDER_ABORTED",
        timedOut
          ? `Research provider "${providerId}" request timed out.`
          : `Research provider "${providerId}" request was aborted.`,
        { providerId }
      );
    }
    throw new AgentToolError(
      "RESEARCH_PROVIDER_FAILED",
      error instanceof Error
        ? `Research provider "${providerId}" request failed: ${error.message}`
        : `Research provider "${providerId}" request failed.`,
      { providerId }
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

function normalizeBraveResult(entry: unknown, index: number, retrievedAt: string): ResearchSearchResult | undefined {
  if (!isRecord(entry)) return undefined;
  const title = trim(entry.title);
  const url = trim(entry.url);
  const snippet = trim(entry.description) ?? trim(entry.snippet);
  if (!title || !snippet) return undefined;
  const sourceName = sourceNameFromProfile(entry.profile) ?? sourceNameFromUrl(url);
  return normalizedResult({
    providerId: "brave",
    index,
    title,
    url,
    snippet,
    sourceName,
    retrievedAt
  });
}

function normalizeTavilyResult(entry: unknown, index: number, retrievedAt: string): ResearchSearchResult | undefined {
  if (!isRecord(entry)) return undefined;
  const title = trim(entry.title);
  const url = trim(entry.url);
  const snippet = trim(entry.content) ?? trim(entry.snippet);
  if (!title || !snippet) return undefined;
  return normalizedResult({
    providerId: "tavily",
    index,
    title,
    url,
    snippet,
    sourceName: sourceNameFromUrl(url),
    retrievedAt
  });
}

function normalizedResult(input: {
  providerId: string;
  index: number;
  title: string;
  url?: string | undefined;
  snippet: string;
  sourceName?: string | undefined;
  retrievedAt: string;
}): ResearchSearchResult {
  return {
    id: `${input.providerId}_${input.index + 1}_${stableId(input.url ?? input.title)}`,
    title: input.title.slice(0, 300),
    ...(input.url ? { url: input.url } : {}),
    ...(input.sourceName ? { sourceName: input.sourceName.slice(0, 160) } : {}),
    snippet: input.snippet.slice(0, 1_500),
    retrievedAt: input.retrievedAt
  };
}

function sourceNameFromProfile(value: unknown): string | undefined {
  return isRecord(value) ? trim(value.name) : undefined;
}

function sourceNameFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function noConfiguredProvider(reason?: string): ResearchProvider {
  return {
    id: "noop",
    async search() {
      throw new AgentToolError(
        "RESEARCH_PROVIDER_NOT_CONFIGURED",
        reason ?? "Research provider is not configured. Ask the user for process details or continue with explicit assumptions.",
        { providerConfigured: false }
      );
    }
  };
}

function normalizeProviderId(value: string | undefined): "brave" | "tavily" | "noop" | string | undefined {
  const normalized = trim(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "none" || normalized === "disabled" || normalized === "noop") return "noop";
  if (normalized === "brave" || normalized === "brave_search") return "brave";
  if (normalized === "tavily") return "tavily";
  return normalized;
}

function inferProviderId(env: ResearchProviderEnv): "brave" | "tavily" | undefined {
  if (trim(env.BRAVE_SEARCH_API_KEY) || trim(env.BRAVE_API_KEY)) return "brave";
  if (trim(env.TAVILY_API_KEY)) return "tavily";
  return undefined;
}

function researchErrorCode(status: number): string {
  if (status === 401 || status === 403) return "RESEARCH_PROVIDER_AUTH_FAILED";
  if (status === 429) return "RESEARCH_PROVIDER_RATE_LIMITED";
  if (status >= 500) return "RESEARCH_PROVIDER_UNAVAILABLE";
  return "RESEARCH_PROVIDER_FAILED";
}

function readPositiveInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function clampResults(requested: number, providerMax: number): number {
  if (!Number.isSafeInteger(requested)) return providerMax;
  return Math.min(Math.max(requested, 1), providerMax, MAX_TOOL_RESULTS);
}

function stableId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "source";
}

function trim(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
