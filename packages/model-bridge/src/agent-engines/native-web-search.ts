/** Codex/Cursor native web search is allowed. Shell, file, collab, fetch and
 * foreign MCP remain a security-boundary breach. `--search` only forces search
 * on; it is not a disable switch. */

export { NATIVE_WEB_SEARCH_EVENT_CODE } from "@vdt-studio/vdt-agent-runtime";

export const NATIVE_WEB_SEARCH_SOURCE_TIER = "native_web_search" as const;

const MAX_QUERY_CHARS = 160;
const MAX_QUERIES = 8;
const NATIVE_WEB_SEARCH_TOOL_NAME = /^(web_search|web\.search|websearch)$/i;
const CURSOR_WEB_SEARCH_TOOL_KEY = /^(webSearchToolCall|web_search_tool_call|webSearch|web_search)$/i;
const CURSOR_FORBIDDEN_TOOL_KEY = /^(readToolCall|editToolCall|shellToolCall|bashToolCall|grepToolCall|deleteToolCall|webFetchToolCall|mcpToolCall|lsToolCall|writeToolCall|applyPatchToolCall|taskToolCall|terminalToolCall)$/i;
const FORBIDDEN_ACP_KINDS = new Set(["delete", "edit", "execute", "move", "read"]);

export const FORBIDDEN_CODEX_NATIVE_ITEM_TYPES = Object.freeze([
  "command_execution",
  "file_change",
  "collab_tool_call"
] as const);

export interface NativeWebSearchRecord {
  readonly count: number;
  readonly queries: readonly string[];
}

export class NativeWebSearchCollector {
  readonly #ids = new Set<string>();
  #anonymous = 0;
  readonly #queries: string[] = [];
  readonly #queryById = new Map<string, string>();

  observe(input: {
    readonly id?: string | undefined;
    readonly query?: string | undefined;
    readonly eventType?: string | undefined;
  }): void {
    const query = sanitizeSearchQuery(input.query);
    const id = typeof input.id === "string" && input.id.trim() ? input.id.trim().slice(0, 160) : undefined;
    if (id) {
      if (!this.#ids.has(id)) this.#ids.add(id);
      if (query && !this.#queryById.has(id)) {
        this.#queryById.set(id, query);
        this.#queries.push(query);
      }
      return;
    }
    if (input.eventType === "item.updated") return;
    this.#anonymous += 1;
    if (query) this.#queries.push(query);
  }

  snapshot(): NativeWebSearchRecord | undefined {
    const count = this.#ids.size + this.#anonymous;
    if (count === 0) return undefined;
    return Object.freeze({
      count,
      queries: Object.freeze([...this.#queries])
    });
  }
}

export function isForbiddenCodexNativeItemType(type: string | undefined): boolean {
  return (FORBIDDEN_CODEX_NATIVE_ITEM_TYPES as readonly string[]).some((forbidden) => forbidden === type);
}

export function extractSearchQuery(value: unknown): string | undefined {
  return sanitizeSearchQuery(rawSearchQuery(value));
}

export function inspectCursorStreamToolCall(event: Record<string, unknown>):
  | { kind: "native_web_search"; id?: string; query?: string }
  | { kind: "forbidden" } {
  const id = cursorToolCallId(event);
  const named = [event.name, event.tool, event.tool_name, event.subtype, event.toolName]
    .filter((candidate): candidate is string => typeof candidate === "string");
  if (named.some((name) => NATIVE_WEB_SEARCH_TOOL_NAME.test(name))) {
    return { kind: "native_web_search", ...(id ? { id } : {}), ...(queryFrom(event)) };
  }
  const payload = isRecord(event.tool_call) ? event.tool_call : undefined;
  if (!payload) return { kind: "forbidden" };
  const keys = Object.keys(payload);
  const hasWebSearch = keys.some((key) => CURSOR_WEB_SEARCH_TOOL_KEY.test(key));
  const hasForbidden = keys.some((key) => CURSOR_FORBIDDEN_TOOL_KEY.test(key));
  if (hasWebSearch && !hasForbidden) {
    const webKey = keys.find((key) => CURSOR_WEB_SEARCH_TOOL_KEY.test(key));
    return {
      kind: "native_web_search",
      ...(id ? { id } : {}),
      ...(queryFrom(webKey ? payload[webKey] : payload))
    };
  }
  return { kind: "forbidden" };
}

export function isNativeWebSearchTool(toolName: string | undefined, kind: string | undefined): boolean {
  if (kind && FORBIDDEN_ACP_KINDS.has(kind)) return false;
  if (toolName && NATIVE_WEB_SEARCH_TOOL_NAME.test(toolName)) return true;
  return kind === "web_search";
}

export function researchModeForcesNativeWebSearch(context: unknown): boolean {
  if (!isRecord(context)) return false;
  const brief = isRecord(context.brief) ? context.brief : context;
  const options = isRecord(brief.options)
    ? brief.options
    : isRecord(context.options) ? context.options : undefined;
  return options?.researchMode === "on";
}

export function withForcedCodexSearchFlag(args: readonly string[], force: boolean): string[] {
  if (!force || args.includes("--search")) return [...args];
  const jsonIndex = args.indexOf("--json");
  if (jsonIndex >= 0) {
    return [...args.slice(0, jsonIndex + 1), "--search", ...args.slice(jsonIndex + 1)];
  }
  const execIndex = args.indexOf("exec");
  if (execIndex >= 0) {
    return [...args.slice(0, execIndex + 1), "--search", ...args.slice(execIndex + 1)];
  }
  return ["--search", ...args];
}

export function attachNativeWebSearchToError(
  error: unknown,
  record: NativeWebSearchRecord | undefined
): never {
  if (record && typeof error === "object" && error !== null && !Array.isArray(error)) {
    const target = error as { nativeWebSearch?: NativeWebSearchRecord };
    if (target.nativeWebSearch === undefined) target.nativeWebSearch = record;
  }
  throw error;
}

export function nativeWebSearchFromError(error: unknown): NativeWebSearchRecord | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as { nativeWebSearch?: unknown }).nativeWebSearch;
  if (!isRecord(value)) return undefined;
  const count = value.count;
  const queries = value.queries;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 1 || !Array.isArray(queries)) {
    return undefined;
  }
  return {
    count,
    queries: queries.filter((query): query is string => typeof query === "string")
  };
}

export function formatNativeWebSearchNotice(record: NativeWebSearchRecord): string {
  const times = record.count === 1 ? "once" : `${record.count} times`;
  const shown = record.queries.slice(0, MAX_QUERIES);
  const queryPart = shown.length > 0
    ? ` Queries: ${shown.map((query) => `"${query}"`).join("; ")}${record.queries.length > MAX_QUERIES ? "…" : ""}.`
    : " Query text was not present in the stream.";
  return `Native web search used ${times}.${queryPart} Results were not captured through research.search_web.`;
}

function queryFrom(value: unknown): { query: string } | Record<string, never> {
  const query = extractSearchQuery(value);
  return query ? { query } : {};
}

function cursorToolCallId(event: Record<string, unknown>): string | undefined {
  const candidates = [event.call_id, event.toolCallId, event.id];
  const id = candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
  return id?.trim().slice(0, 160);
}

function rawSearchQuery(value: unknown, depth = 0): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value) || depth > 2) return undefined;
  const direct = [value.query, value.search_query, value.searchQuery, value.searchTerm, value.q];
  for (const candidate of direct) {
    if (typeof candidate === "string") return candidate;
  }
  if (isRecord(value.action)) {
    const nested = rawSearchQuery(value.action, depth + 1);
    if (nested) return nested;
  }
  if (isRecord(value.args)) {
    const nested = rawSearchQuery(value.args, depth + 1);
    if (nested) return nested;
  }
  if (isRecord(value.tool_call)) {
    const nested = rawSearchQuery(value.tool_call, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

function sanitizeSearchQuery(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[\0\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, MAX_QUERY_CHARS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
