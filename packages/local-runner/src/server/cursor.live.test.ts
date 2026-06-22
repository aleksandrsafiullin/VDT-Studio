import { describe, expect, it } from "vitest";
import { testCursorConnection } from "@vdt-studio/model-bridge";
import { detectSubscriptionCli } from "../../../model-bridge/src/detection";

const live = process.env.VDT_LIVE_CURSOR === "1";

describe.skipIf(!live)("cursor live integration", () => {
  it("runs a real connection test against agent on PATH", async () => {
    const install = await detectSubscriptionCli("cursor-agent");
    expect(install.installed).toBe(true);
    expect(install.executable).toBeTruthy();

    const probe = await testCursorConnection(install.executable!);
    expect(["ready", "authentication_required", "rate_limited"]).toContain(probe.status);
  }, 60_000);
});
