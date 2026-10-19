import { describe, expect, it } from "vitest";
import { developmentWebArguments, developmentWebEnvironment } from "./development-web-environment.mjs";

describe("local development launch environment", () => {
  it("binds the local app to loopback without changing other arguments", () => {
    expect(developmentWebArguments()).toEqual(["--hostname", "127.0.0.1"]);
    expect(developmentWebArguments(["--port", "3002"])).toEqual(["--hostname", "127.0.0.1", "--port", "3002"]);
  });
  it.each([["--hostname", "localhost"], ["--hostname=::1"], ["-H", "127.0.0.1"]])("preserves explicit hostname arguments %j", (...args) => {
    expect(developmentWebArguments(args)).toEqual(args);
  });
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
