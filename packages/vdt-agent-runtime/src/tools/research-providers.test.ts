import { describe, expect, it, vi } from "vitest";
import { resolveResearchProviderFromEnv,OpenAiWebResearchProvider } from "./research-providers";

describe("research providers", () => {
  it("uses an explicit OpenAI web tool and exposes only cited sources after completed search",async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>jsonResponse({output:[{type:"web_search_call",status:"completed"},{type:"message",content:[{type:"output_text",text:"Manufacturer specifies a 5.2 m3 SD bucket.",annotations:[{type:"url_citation",url:"https://www.cat.com/395",title:"Cat 395",start_index:40}]}]}]}));
    const provider=new OpenAiWebResearchProvider({apiKey:"session-test-secret",model:"gpt-6-luna",fetch:fetcher});
    const results=await provider.search("Cat 395 SD bucket",{purpose:"benchmarks",maxResults:3});
    expect(results[0]).toMatchObject({url:"https://www.cat.com/395",sourceName:"www.cat.com"});
    const [url,init]=fetcher.mock.calls[0]!;expect(String(url)).toBe("https://api.openai.com/v1/responses");
    const body=JSON.parse(String(init!.body));expect(body).toMatchObject({model:"gpt-6-luna",store:false,tools:[{type:"web_search"}],tool_choice:"required"});
    expect(JSON.stringify(body)).not.toContain("session-test-secret");expect(JSON.stringify(results)).not.toContain("session-test-secret");
  });
  it("rejects uncited memory and citations without an executed search",async()=>{
    for(const output of [[{type:"message",content:[{type:"output_text",text:"5.2 m3",annotations:[{type:"url_citation",url:"https://www.cat.com/395"}]}]}],[{type:"web_search_call",status:"completed"},{type:"message",content:[{type:"output_text",text:"5.2 m3",annotations:[]}]}]]){
      const provider=new OpenAiWebResearchProvider({apiKey:"secret",model:"gpt-6-luna",fetch:async()=>jsonResponse({output})});
      await expect(provider.search("bucket capacity",{purpose:"benchmarks",maxResults:3})).rejects.toMatchObject({code:"RESEARCH_PROVIDER_BAD_RESPONSE"});
    }
  });
  it("resolves to a controlled Noop provider when server-side research is not configured", async () => {
    const provider = resolveResearchProviderFromEnv({});

    const error = await provider.search("mine production process drivers", {
      purpose: "process_components",
      maxResults: 3
    }).catch((caught: unknown) => caught);

    expect(provider.id).toBe("noop");
    expect(error).toMatchObject({
      code: "RESEARCH_PROVIDER_NOT_CONFIGURED",
      details: { providerConfigured: false }
    });
  });

  it("calls Brave Search on the fixed server-side endpoint and normalizes web results", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({
      web: {
        results: [
          {
            title: "Mine production drivers",
            url: "https://example.com/mining",
            description: "Working time, productivity rate, and yield drive production.",
            profile: { name: "Example Mining" }
          }
        ]
      }
    }));
    const provider = resolveResearchProviderFromEnv({
      VDT_RESEARCH_PROVIDER: "brave",
      BRAVE_SEARCH_API_KEY: "brave-secret",
      VDT_RESEARCH_MAX_RESULTS: "7"
    }, { fetch: fetcher, now: () => "2026-07-01T00:00:00.000Z" });

    const results = await provider.search("mine production process drivers", {
      purpose: "process_components",
      maxResults: 3
    });

    const [url, init] = fetcher.mock.calls[0]!;
    const requestUrl = new URL(String(url));
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(requestUrl.searchParams.get("q")).toBe("mine production process drivers");
    expect(requestUrl.searchParams.get("count")).toBe("3");
    expect(init?.headers).toMatchObject({
      "x-subscription-token": "brave-secret"
    });
    expect(results).toEqual([
      {
        id: "brave_1_https_example_com_mining",
        title: "Mine production drivers",
        url: "https://example.com/mining",
        sourceName: "Example Mining",
        snippet: "Working time, productivity rate, and yield drive production.",
        retrievedAt: "2026-07-01T00:00:00.000Z"
      }
    ]);
    expect(JSON.stringify(results)).not.toContain("brave-secret");
  });

  it("calls Tavily Search with bearer auth and never puts the API key in the request body", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({
      results: [
        {
          title: "Processing plant throughput",
          url: "https://standards.example/throughput",
          content: "Throughput depends on working time, availability losses, and process rate."
        }
      ]
    }));
    const provider = resolveResearchProviderFromEnv({
      VDT_RESEARCH_PROVIDER: "tavily",
      TAVILY_API_KEY: "tavily-secret"
    }, { fetch: fetcher, now: () => "2026-07-01T00:00:00.000Z" });

    const results = await provider.search("processing plant throughput drivers", {
      purpose: "benchmarks",
      maxResults: 2
    });

    const [url, init] = fetcher.mock.calls[0]!;
    const requestUrl = new URL(String(url));
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe("https://api.tavily.com/search");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      authorization: "Bearer tavily-secret"
    });
    expect(body).toMatchObject({
      query: "processing plant throughput drivers",
      max_results: 2,
      include_answer: false,
      include_raw_content: false
    });
    expect(JSON.stringify(body)).not.toContain("tavily-secret");
    expect(results[0]).toMatchObject({
      id: "tavily_1_https_standards_example_throughput",
      sourceName: "standards.example",
      snippet: "Throughput depends on working time, availability losses, and process rate."
    });
  });

  it("returns provider failures as safe AgentToolError details without leaking keys", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ error: "unauthorized" }, 401));
    const provider = resolveResearchProviderFromEnv({
      VDT_RESEARCH_PROVIDER: "brave",
      BRAVE_SEARCH_API_KEY: "brave-secret"
    }, { fetch: fetcher });

    const error = await provider.search("mine production process drivers", {
      purpose: "process_components",
      maxResults: 3
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "RESEARCH_PROVIDER_AUTH_FAILED",
      message: "Research provider \"brave\" request failed with status 401.",
      details: { providerId: "brave", status: 401 }
    });
    expect(`${error instanceof Error ? error.message : ""}${JSON.stringify((error as { details?: unknown }).details)}`)
      .not.toContain("brave-secret");
  });

  it("maps a connection reset to unavailable so research stays retryable", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      const error = new TypeError("fetch failed");
      error.cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
      throw error;
    });
    const provider = resolveResearchProviderFromEnv({
      VDT_RESEARCH_PROVIDER: "brave",
      BRAVE_SEARCH_API_KEY: "brave-secret"
    }, { fetch: fetcher });

    const error = await provider.search("mine production process drivers", {
      purpose: "process_components",
      maxResults: 3
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "RESEARCH_PROVIDER_UNAVAILABLE",
      details: { providerId: "brave" }
    });
  });

  it("keeps a stable 4xx as RESEARCH_PROVIDER_FAILED", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ error: "not found" }, 404));
    const provider = resolveResearchProviderFromEnv({
      VDT_RESEARCH_PROVIDER: "brave",
      BRAVE_SEARCH_API_KEY: "brave-secret"
    }, { fetch: fetcher });

    const error = await provider.search("mine production process drivers", {
      purpose: "process_components",
      maxResults: 3
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "RESEARCH_PROVIDER_FAILED",
      details: { providerId: "brave", status: 404 }
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
