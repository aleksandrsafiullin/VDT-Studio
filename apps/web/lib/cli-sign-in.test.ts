import { describe, expect, it, vi } from "vitest";
import { getCliCatalogEntry } from "./execution-mode-catalog";
import type { CliAgentDetectionSnapshot } from "./ai-execution-client";
import { runCliSignIn, type CliSignInStatus } from "./cli-sign-in";

function fixture(verification: { agents?: CliAgentDetectionSnapshot[]; error?: string; scanning?: boolean } = {}) {
  const statuses: CliSignInStatus[] = [];
  return {
    statuses,
    options: {
      entry: getCliCatalogEntry("cursor-agent"),
      openGuidance: vi.fn(),
      authenticate: vi.fn(async () => ({ ok: true, action: "authenticated" as const })),
      rescan: vi.fn(async () => undefined),
      getVerification: () => verification,
      onStatus: (status: CliSignInStatus) => { statuses.push(status); }
    }
  };
}

const ready: CliAgentDetectionSnapshot = {
  id: "cursor-agent", installed: true, executable: "/usr/local/bin/agent", alias: "agent", version: "0.46.0", status: "ready"
};

describe("CLI sign-in actions", () => {
  it("opens instruction-only help synchronously before calling asynchronous auth", async () => {
    const calls: string[] = [];
    const statuses: CliSignInStatus[] = [];
    await runCliSignIn({
      entry: getCliCatalogEntry("claude"),
      openGuidance: () => { calls.push("open"); },
      authenticate: async () => { calls.push("authenticate"); return { ok: true, action: "instructions", instructions: "Run claude login, then Test." }; },
      rescan: async () => { throw new Error("Instructions are not a verified login."); },
      getVerification: () => ({ agents: [] }),
      onStatus: (status) => { statuses.push(status); }
    });
    expect(calls).toEqual(["open", "authenticate"]);
    expect(statuses.at(-1)).toEqual({ kind: "info", message: "Run claude login, then Test." });
    expect(statuses.some((status) => status.kind === "success")).toBe(false);
  });

  it("keeps instruction help useful when the browser rejects a popup", async () => {
    const { options, statuses } = fixture();
    await runCliSignIn({ ...options, entry: getCliCatalogEntry("claude"), openGuidance: () => { throw new Error("Popup blocked"); }, authenticate: async () => ({ ok: true, action: "instructions" }) });
    expect(statuses.at(-1)?.kind).toBe("info");
    expect(statuses.at(-1)?.message).toContain("sign-in guide");
  });

  it("reports success only after a ready live detection and does not open a blank tab for managed auth", async () => {
    const { options, statuses } = fixture({ agents: [ready] });
    await runCliSignIn(options);
    expect(options.openGuidance).not.toHaveBeenCalled();
    expect(options.rescan).toHaveBeenCalledOnce();
    expect(statuses.at(-1)?.kind).toBe("success");
  });

  it.each([
    { agents: [ready], error: "Runtime unavailable" },
    { agents: [{ ...ready, status: "authentication_required" as const }] },
    { agents: [] },
    { agents: [ready], scanning: true }
  ])("does not claim authentication from an auth response when verification is blocked: %j", async (verification) => {
    const { options, statuses } = fixture(verification);
    await runCliSignIn(options);
    expect(statuses.some((status) => status.kind === "success")).toBe(false);
    expect(statuses.at(-1)?.message).toMatch(/not.*verified|not confirmed/);
  });

  it("surfaces auth failures and allows a clean retry", async () => {
    const { options, statuses } = fixture({ agents: [ready] });
    options.authenticate.mockRejectedValueOnce(new Error("Provider login timed out. Retry Sign in."));
    await runCliSignIn(options);
    expect(statuses.at(-1)).toEqual({ kind: "error", message: "Provider login timed out. Retry Sign in." });
    await runCliSignIn(options);
    expect(statuses.at(-1)?.kind).toBe("success");
  });
});
