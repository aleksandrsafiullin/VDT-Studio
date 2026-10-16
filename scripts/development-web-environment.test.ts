import { describe, expect, it } from "vitest";
import { developmentWebEnvironment } from "./development-web-environment.mjs";

describe("local development launch environment", () => {
  it("enables session bindings for pnpm dev while keeping legacy fallback off", () => {
    expect(developmentWebEnvironment({ PATH: "/test/bin" })).toEqual({
      PATH: "/test/bin",
      VDT_APP_MODE: "development_web",
      NEXT_PUBLIC_VDT_APP_MODE: "development_web",
      VDT_CLI_SESSION_CANARY_ENABLED: "true",
      VDT_AGENT_LEGACY_COMPATIBILITY_ENABLED: "false"
    });
  });

  it("preserves a server owner's explicit opt-out and model selection", () => {
    expect(developmentWebEnvironment({
      VDT_CLI_SESSION_CANARY_ENABLED: "false",
      VDT_CODEX_SESSION_MODEL: "host-pinned-model"
    })).toMatchObject({
      VDT_CLI_SESSION_CANARY_ENABLED: "false",
      VDT_CODEX_SESSION_MODEL: "host-pinned-model"
    });
    expect(developmentWebEnvironment({ VDT_CURSOR_SESSION_CANARY_ENABLED: "false" }))
      .toHaveProperty("VDT_CLI_SESSION_CANARY_ENABLED", "false");
  });
});
