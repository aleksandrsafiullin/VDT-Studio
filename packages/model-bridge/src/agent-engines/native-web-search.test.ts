import { describe, expect, it } from "vitest";
import {
  formatNativeWebSearchNotice,
  inspectCursorStreamToolCall,
  isForbiddenCodexNativeItemType,
  isNativeWebSearchTool,
  NativeWebSearchCollector,
  NATIVE_WEB_SEARCH_SOURCE_TIER,
  attachNativeWebSearchToError,
  nativeWebSearchFromError,
  researchModeForcesNativeWebSearch,
  withForcedCodexSearchFlag
} from "./native-web-search";

describe("native web search helpers", () => {
  it("does not treat web_search as a forbidden Codex native item", () => {
    expect(isForbiddenCodexNativeItemType("web_search")).toBe(false);
    expect(isForbiddenCodexNativeItemType("command_execution")).toBe(true);
    expect(isForbiddenCodexNativeItemType("file_change")).toBe(true);
    expect(isForbiddenCodexNativeItemType("collab_tool_call")).toBe(true);
    expect(NATIVE_WEB_SEARCH_SOURCE_TIER).toBe("native_web_search");
  });

  it("counts unique web_search items and keeps query text", () => {
    const collector = new NativeWebSearchCollector();
    collector.observe({ id: "search-1", query: "haulage cycle time", eventType: "item.started" });
    collector.observe({
      id: "search-1",
      query: "haulage cycle time",
      eventType: "item.completed"
    });
    collector.observe({ id: "search-2", query: "truck payload tonnes", eventType: "item.completed" });
    expect(collector.snapshot()).toEqual({
      count: 2,
      queries: ["haulage cycle time", "truck payload tonnes"]
    });
  });

  it("identifies Cursor webSearchToolCall and rejects shell/file/fetch", () => {
    expect(inspectCursorStreamToolCall({
      type: "tool_call",
      call_id: "search-1",
      tool_call: { webSearchToolCall: { args: { searchTerm: "ore hauled drivers" } } }
    })).toEqual({
      kind: "native_web_search",
      id: "search-1",
      query: "ore hauled drivers"
    });
    expect(inspectCursorStreamToolCall({
      type: "tool_call",
      tool_call: { readToolCall: { args: { path: "/etc/passwd" } } }
    })).toEqual({ kind: "forbidden" });
    expect(inspectCursorStreamToolCall({
      type: "tool_call",
      tool_call: { webFetchToolCall: { args: { url: "https://example.com" } } }
    })).toEqual({ kind: "forbidden" });
  });

  it("allows ACP web_search names without treating codebase search or fetch as native search", () => {
    expect(isNativeWebSearchTool("web_search", undefined)).toBe(true);
    expect(isNativeWebSearchTool("web.search", "web_search")).toBe(true);
    expect(isNativeWebSearchTool(undefined, "web_search")).toBe(true);
    expect(isNativeWebSearchTool("web_search", "execute")).toBe(false);
    expect(isNativeWebSearchTool("grep", "search")).toBe(false);
    expect(isNativeWebSearchTool("web.fetch", "fetch")).toBe(false);
  });

  it("forces --search only when researchMode is on", () => {
    expect(researchModeForcesNativeWebSearch({
      brief: { options: { researchMode: "on" } }
    })).toBe(true);
    expect(researchModeForcesNativeWebSearch({
      brief: { options: { researchMode: "auto" } }
    })).toBe(false);
    expect(researchModeForcesNativeWebSearch({
      brief: { options: { researchMode: "off" } }
    })).toBe(false);
    expect(withForcedCodexSearchFlag(["exec", "--json", "-"], true)).toEqual([
      "exec",
      "--json",
      "--search",
      "-"
    ]);
    expect(withForcedCodexSearchFlag(["exec", "--json", "-"], false)).toEqual([
      "exec",
      "--json",
      "-"
    ]);
  });

  it("formats an operator-facing notice with count and queries", () => {
    expect(formatNativeWebSearchNotice({ count: 1, queries: ["haulage cycle"] })).toContain(
      "Native web search used once"
    );
    expect(formatNativeWebSearchNotice({ count: 2, queries: [] })).toContain(
      "Query text was not present in the stream"
    );
  });

  it("attaches a native web search record onto thrown errors", () => {
    expect(nativeWebSearchFromError(new Error("plain"))).toBeUndefined();
    try {
      attachNativeWebSearchToError(Object.assign(new Error("later protocol fail"), {
        code: "CODEX_CHECKPOINT_PROTOCOL_INVALID"
      }), { count: 1, queries: ["haulage cycle time"] });
    } catch (error) {
      expect(nativeWebSearchFromError(error)).toEqual({
        count: 1,
        queries: ["haulage cycle time"]
      });
    }
  });
});
