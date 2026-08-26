import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Supervisor persistence factory pairing", () => {
  it("keeps an actually in-memory run store on the in-memory compatibility projection", async () => {
    vi.stubEnv("VDT_APP_MODE", "hosted_web");
    vi.resetModules();
    const runtime = await import("./runtime");
    const store = runtime.createAgentRunStore({ VDT_APP_MODE: "hosted_web" });

    expect(runtime.hasSqliteAgentRunPersistence(store)).toBe(false);
    const persistence = runtime.createAgentSupervisorPersistence(store);
    expect(persistence.constructor.name).toBe("AgentRunStateSupervisorPersistence");
  });
});
