import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SidecarHostError, SidecarProcessHost } from "./host";

const fixture = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));
const TEST_HANDSHAKE_TIMEOUT_MS = 5000;
const hosts: SidecarProcessHost[] = [];

function createHost(env: NodeJS.ProcessEnv = {}) {
  const host = new SidecarProcessHost({
    command: process.execPath,
    args: [fixture],
    env: { ...process.env, ...env },
    handshakeTimeoutMs: TEST_HANDSHAKE_TIMEOUT_MS
  });
  hosts.push(host);
  return host;
}

function createCrashLimitedHost() {
  const host = new SidecarProcessHost({
    command: process.execPath,
    args: [fixture],
    env: { ...process.env },
    handshakeTimeoutMs: TEST_HANDSHAKE_TIMEOUT_MS,
    maxCrashRestarts: 2,
    crashWindowMs: 60_000
  });
  hosts.push(host);
  return host;
}

function expectHostCode(error: unknown, code: SidecarHostError["code"]) {
  expect(error).toBeInstanceOf(SidecarHostError);
  expect((error as SidecarHostError).code).toBe(code);
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
});

describe("sidecar process host", () => {
  it("performs the private startup handshake and sends requests", async () => {
    const host = createHost();
    await host.start();
    expect(host.ready).toBe(true);
    expect(await host.request("list_backends")).toEqual({ backends: [{ id: "mock" }] });
  });

  it("fails closed when stdout contains non-protocol logs", async () => {
    const host = createHost({ VDT_FAKE_SIDECAR_STDOUT_LOG: "1" });
    await expect(host.start()).rejects.toMatchObject({ code: "SIDECAR_PROTOCOL_ERROR" });
    expect(host.ready).toBe(false);
  });

  it("fails closed when the sidecar does not complete the startup handshake", async () => {
    const host = new SidecarProcessHost({
      command: process.execPath,
      args: [fixture],
      env: { ...process.env, VDT_FAKE_SIDECAR_NO_HELLO: "1" },
      handshakeTimeoutMs: 50
    });
    hosts.push(host);

    await expect(host.start()).rejects.toMatchObject({ code: "SIDECAR_START_TIMEOUT" });
    expect(host.ready).toBe(false);
    expect(host.pid).toBeUndefined();
  });

  it("propagates cancellation through the framed protocol", async () => {
    const host = createHost();
    await host.start();
    const request = await host.beginRequest("complete", {
      backendId: "mock",
      taskType: "generate_tree",
      schemaId: "generate-tree-v1",
      input: { delayMs: 1000 }
    });
    host.cancel(request.requestId);
    await expect(request.response).rejects.toMatchObject({
      code: "SIDECAR_REQUEST_FAILED",
      message: "CANCELLED: Cancelled by host."
    });
  });

  it("rejects pending work on crash and can start a fresh sidecar", async () => {
    const host = createHost();
    await host.start();
    try {
      await host.request("test_backend", { backendId: "crash" });
      throw new Error("Expected sidecar crash request to reject.");
    } catch (error) {
      expectHostCode(error, "SIDECAR_EXITED");
    }
    expect(host.ready).toBe(false);

    await host.start();
    expect(await host.request("list_backends")).toEqual({ backends: [{ id: "mock" }] });
  });

  it("fails closed after repeated sidecar crashes", async () => {
    const host = createCrashLimitedHost();
    for (let index = 0; index < 2; index += 1) {
      await host.start();
      try {
        await host.request("test_backend", { backendId: "crash" });
        throw new Error("Expected sidecar crash request to reject.");
      } catch (error) {
        expectHostCode(error, "SIDECAR_EXITED");
      }
    }

    await expect(host.start()).rejects.toMatchObject({
      code: "SIDECAR_CRASH_LOOP"
    });
  });

  it("cleans up the process on shutdown", async () => {
    const host = createHost();
    await host.start();
    const pid = host.pid;
    expect(pid).toBeGreaterThan(0);
    await host.stop();
    expect(host.ready).toBe(false);
    expect(host.pid).toBeUndefined();
  });
});
