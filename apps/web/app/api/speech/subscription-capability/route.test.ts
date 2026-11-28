import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";
import { probeInstalledCodexSpeechProtocol } from "./codex-schema-probe";

vi.mock("./codex-schema-probe", () => ({ probeInstalledCodexSpeechProtocol: vi.fn() }));

const probe = vi.mocked(probeInstalledCodexSpeechProtocol);
const protocol = { surface: "experimental", cliVersion: "0.171.0-alpha.13.2", buildFingerprint: "a".repeat(64) } as const;
const unknown = { surface: "unknown", cliVersion: null, buildFingerprint: null } as const;

function request(body: unknown = { scope: "installed_codex_cli" }, headers?: Record<string, string>, signal?: AbortSignal) {
  return new Request("http://localhost:37541/api/speech/subscription-capability", {
    method: "POST", headers: { host: "127.0.0.1:37541", origin: "http://127.0.0.1:37541", "content-type": "application/json", ...headers },
    body: JSON.stringify(body), signal: signal ?? null
  });
}

beforeEach(() => {
  vi.stubEnv("VDT_APP_MODE", "desktop");
  probe.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

it("reports only the exact installed experimental protocol and unknown account availability", async () => {
  probe.mockResolvedValue(protocol);
  const local = request();
  const response = await POST(local);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ scope: "installed_codex_cli", protocol, accountVoiceAvailability: "unknown" });
  expect(probe).toHaveBeenCalledWith(local.signal);
});

it("admits the trusted development host and leaves an unverified protocol unknown", async () => {
  vi.stubEnv("VDT_APP_MODE", "development_web");
  probe.mockResolvedValue(unknown);
  expect(await (await POST(request())).json()).toEqual({ scope: "installed_codex_cli", protocol: unknown, accountVoiceAvailability: "unknown" });
});

it("rejects forged scope, executable, account data, request origin, and untrusted host modes before probing", async () => {
  for (const body of [{ scope: "codex_account" }, { scope: "installed_codex_cli", executable: "/tmp/forged" },
    { scope: "installed_codex_cli", account: "forged" }, { scope: "installed_codex_cli", args: ["login"] }]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  expect((await POST(request(undefined, { origin: "http://example.test" }))).status).toBe(403);
  expect((await POST(request(undefined, { origin: "http://localhost:37541" }))).status).toBe(403);
  expect((await POST(request(undefined, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  vi.stubEnv("VDT_APP_MODE", "hosted_web");
  vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
  expect((await POST(request())).status).toBe(403);
  expect(probe).not.toHaveBeenCalled();
});

it("does not expose shell, file, stdout, stderr or credential diagnostics", async () => {
  const privateOutput = "test-only /tmp/private-path OPENAI_API_KEY=credential ; $(command)";
  probe.mockRejectedValue(new Error(privateOutput));
  const rejected = await POST(request());
  expect(await rejected.json()).toEqual({ scope: "installed_codex_cli", protocol: unknown, accountVoiceAvailability: "unknown" });
  probe.mockResolvedValue({ ...protocol, cliVersion: privateOutput });
  expect(await (await POST(request())).json()).toMatchObject({ protocol: unknown });
});

it("forwards cancellation and rejects a second check before the first owned probe settles", async () => {
  const controller = new AbortController();
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  let finish!: () => void;
  probe.mockImplementation(signal => new Promise(resolve => {
    finish = () => resolve(protocol);
    signal.addEventListener("abort", finish, { once: true });
    began();
  }));
  const checking = POST(request(undefined, undefined, controller.signal));
  await started;
  expect((await POST(request())).status).toBe(409);
  controller.abort();
  expect((await checking).status).toBe(408);
  expect(probe).toHaveBeenCalledTimes(1);
});
