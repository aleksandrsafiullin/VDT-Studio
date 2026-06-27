import { describe, expect, it } from "vitest";
import { hasLocalAiUi, hasStandaloneRunnerUi, isLocalWebHostname, resolveVdtAppMode } from "./app-mode";

describe("app mode policy", () => {
  it("accepts explicit desktop, hosted, and development modes", () => {
    expect(resolveVdtAppMode("desktop")).toBe("desktop");
    expect(resolveVdtAppMode("hosted_web")).toBe("hosted_web");
    expect(resolveVdtAppMode("development_web")).toBe("development_web");
  });

  it("infers desktop mode from the Tauri bridge when no explicit mode is set", () => {
    const tauriCoreRuntime = { __TAURI__: { core: { invoke: () => undefined } } } as unknown as typeof globalThis;
    const legacyTauriRuntime = { __TAURI__: { invoke: () => undefined } } as unknown as typeof globalThis;

    expect(resolveVdtAppMode(undefined, tauriCoreRuntime)).toBe("desktop");
    expect(resolveVdtAppMode(undefined, legacyTauriRuntime)).toBe("desktop");
  });

  it("keeps explicit hosted mode authoritative even when a desktop bridge exists", () => {
    const tauriRuntime = { __TAURI__: { core: { invoke: () => undefined } } } as unknown as typeof globalThis;

    expect(resolveVdtAppMode("hosted_web", tauriRuntime)).toBe("hosted_web");
  });

  it("keeps local browser hosts in development web mode even for production builds", () => {
    const localhostRuntime = { location: { hostname: "127.0.0.1" } } as unknown as typeof globalThis;

    expect(resolveVdtAppMode(undefined, localhostRuntime, { nodeEnv: "production" })).toBe("development_web");
    expect(resolveVdtAppMode(undefined, undefined, { hostname: "localhost", nodeEnv: "production" })).toBe("development_web");
    expect(resolveVdtAppMode(undefined, undefined, { hostname: "::1", nodeEnv: "production" })).toBe("development_web");
  });

  it("uses hosted web only for non-local production web without an explicit mode", () => {
    expect(resolveVdtAppMode(undefined, undefined, {
      hostname: "vdt.example.com",
      nodeEnv: "production"
    })).toBe("hosted_web");
  });

  it("recognizes loopback hostnames", () => {
    expect(isLocalWebHostname("localhost")).toBe(true);
    expect(isLocalWebHostname("127.0.0.1")).toBe(true);
    expect(isLocalWebHostname("127.10.20.30")).toBe(true);
    expect(isLocalWebHostname("[::1]")).toBe(true);
    expect(isLocalWebHostname("vdt.example.com")).toBe(false);
  });

  it("hides local AI UI in hosted web mode", () => {
    expect(hasLocalAiUi("hosted_web")).toBe(false);
    expect(hasLocalAiUi("desktop")).toBe(true);
    expect(hasLocalAiUi("development_web")).toBe(true);
  });

  it("shows standalone runner controls only behind an explicit non-hosted flag", () => {
    expect(hasStandaloneRunnerUi("hosted_web", "true")).toBe(false);
    expect(hasStandaloneRunnerUi("desktop", undefined)).toBe(false);
    expect(hasStandaloneRunnerUi("development_web", "false")).toBe(false);
    expect(hasStandaloneRunnerUi("development_web", "true")).toBe(true);
  });
});
