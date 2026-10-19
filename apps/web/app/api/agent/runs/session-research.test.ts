import { afterEach, describe, expect, it, vi } from "vitest";
import { admitSessionWebResearch, resolveSessionAwareResearch } from "./session-research";

afterEach(() => { vi.advanceTimersByTime(60 * 60 * 1000); vi.useRealTimers(); });

describe("explicit trusted-local research session", () => {
  it("expires the ephemeral provider after one hour and respects explicit disable", () => {
    vi.useFakeTimers();
    const dynamic = resolveSessionAwareResearch({});
    expect(dynamic.id).toBe("noop");
    admitSessionWebResearch("test-credential-never-returned", "model-for-test");
    expect(dynamic.id).toBe("openai_web");
    expect(resolveSessionAwareResearch({ VDT_RESEARCH_PROVIDER: "noop" }).id).toBe("noop");
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(dynamic.id).toBe("noop");
  });
});
