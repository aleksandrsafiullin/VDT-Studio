import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalRunnerProvider } from "./local-runner-provider";

afterEach(() => vi.unstubAllGlobals());

const provider = () => new LocalRunnerProvider({ runnerUrl: "http://127.0.0.1:8765", origin: "http://localhost:3000", pairingToken: "synthetic-pairing",
  backendId: "ollama", model: "qwen3.6:27b", modelReasoning: false, timeoutMs: 300_000 });
const params = { taskType: "agent_decision" as const, input: { role: "vdt_skill_author" }, schema: {}, systemPrompt: "Create a reviewed modelling method.", userPrompt: "Use the supplied tree." };

describe("paired runner structured completion timeout contract", () => {
  it("forwards the full 300-second budget and keeps the selected model and reasoning unchanged", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, output: { result: "draft" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await provider().completeStructured(params)).toEqual({ result: "draft" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8765/v1/completions", expect.objectContaining({
      method: "POST", body: expect.any(String)
    }));
    const init = (fetcher.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]![1];
    expect(JSON.parse(String(init.body))).toMatchObject({ taskType: "agent_decision", backendId: "ollama", model: "qwen3.6:27b", modelReasoning: false, timeoutMs: 300_000 });
  });
  it("retains only the known TIMEOUT code so the author route can classify an early runner deadline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: { code: "TIMEOUT", message: "Backend execution timed out." } }, { status: 502 })));
    await expect(provider().completeStructured(params)).rejects.toMatchObject({ code: "TIMEOUT", message: "Local runner request failed: Backend execution timed out." });
  });
  it.each(["SKILL_AUTHOR_CONTEXT_LIMIT", "SKILL_AUTHOR_OUTPUT_LIMIT"])("retains the exact safe author budget code %s", async code => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: { code, message: "Skill Author reached a bounded limit." } }, { status: 502 })));
    await expect(provider().completeStructured(params)).rejects.toMatchObject({ code });
  });
  it("keeps other runner errors compatible without forwarding arbitrary error codes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: { code: "UPSTREAM_PRIVATE_CODE", message: "Provider failed." } }, { status: 502 })));
    try { await provider().completeStructured(params); throw new Error("Expected runner rejection."); }
    catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toHaveProperty("message", "Local runner request failed: Provider failed.");
      expect(error).not.toHaveProperty("code");
    }
  });
});
