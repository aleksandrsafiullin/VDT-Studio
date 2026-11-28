import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppleFoundationModelsTransport, type AppleCompletionRequest, type AppleGuidedShape, type AppleModelIdentity } from "./transport";

const identity: AppleModelIdentity = {
  model: "SystemLanguageModel.default", osBuild: "Version 27.0.1 (Build Fixture)",
  profile: "vdt-native-guided-v1", modelRevision: null
};
const request: AppleCompletionRequest = {
  locale: "en-US", expectedIdentity: identity,
  prompt: "Compute the fixed fixture.", maxOutputTokens: 100, timeoutMs: 5_000,
  schema: { kind: "object", fields: [{ name: "value", shape: { kind: "integer" } }] }
};
const workspaces: string[] = [];

async function fixture(body: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vdt-afm-transport-test-")));
  workspaces.push(root);
  const helperPath = join(root, "helper");
  const pidPath = join(root, "pid");
  const script = [
    `#!${process.execPath}`,
    'const fs = require("node:fs");',
    `fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
    'const packet = JSON.parse(fs.readFileSync(0, "utf8"));',
    `const identity = ${JSON.stringify(identity)};`,
    'const reply = payload => process.stdout.write(JSON.stringify({ version: 1, id: packet.id, ...payload }) + "\\n");',
    body
  ].join("\n");
  await writeFile(helperPath, script, { mode: 0o700 });
  const helperSha256 = createHash("sha256").update(script).digest("hex");
  return { helperPath, helperSha256, pidPath, transport: new AppleFoundationModelsTransport({ helperPath, helperSha256 }) };
}

const resultScript = 'reply({result:{identity, contextSize:8192, inputTokens:200, proposal:{value:2000}}});';

function validateRevenue(value: unknown): number {
  if (typeof value !== "object" || value === null || Object.keys(value).length !== 1
    || !("value" in value) || value.value !== 2000) throw new Error("fixture mismatch");
  return value.value;
}

async function fixturePID(path: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const pid = Number(await readFile(path, "utf8"));
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch {
      // Child startup may precede the PID write.
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Fixture never started.");
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(workspace => rm(workspace, { recursive: true, force: true })));
});

describe("private Apple Foundation Models helper", () => {
  it("discovers request-scoped capability and validates a correlated guided completion", async () => {
    const { transport } = await fixture(
      'if (packet.op === "capabilities") reply({result:{identity, contextSize:8192, locale:packet.locale, tokenBudgetVerified:true}});'
      + `else { ${resultScript} }`
    );
    await expect(transport.discover("en-US")).resolves.toEqual({
      identity, locale: "en-US", contextSize: 8192, tokenBudgetVerified: true
    });
    await expect(transport.complete(request, validateRevenue)).resolves.toEqual({
      value: 2000, context: { contextSize: 8192, inputTokens: 200, reservedOutputTokens: 100 }
    });
    await expect(transport.complete(request, () => { throw new Error("unsafe parser detail"); }))
      .rejects.toMatchObject({ code: "invalid_output", invalidOutputOrigin: "canonical_validation",
        message: "The native Apple model returned invalid output." });
  });

  it("distinguishes native output rejection before invoking the canonical validator", async () => {
    const { transport } = await fixture('reply({error:"invalid_output"});');
    const validate = vi.fn(validateRevenue);
    await expect(transport.complete(request, validate)).rejects.toMatchObject({
      code: "invalid_output", invalidOutputOrigin: "native_output", message: "The native Apple model returned invalid output."
    });
    expect(validate).not.toHaveBeenCalled();
    await expect(transport.discover("en-US")).rejects.toMatchObject({ code: "invalid_output", invalidOutputOrigin: undefined });
  });

  it("sends mutually exclusive object variants inside the ordinary object guide", async () => {
    const schema = {
      kind: "object",
      fields: [{ name: "action", shape: {
        kind: "union",
        variants: [
          { kind: "object", fields: [{ name: "tool", shape: { kind: "choice", choices: ["skill.list"] } }] },
          { kind: "object", fields: [
            { name: "tool", shape: { kind: "choice", choices: ["user.ask"] } },
            { name: "question", shape: { kind: "string" } }
          ] }
        ]
      } }]
    } as const satisfies AppleCompletionRequest["schema"];
    const { transport } = await fixture(
      `require("node:assert/strict").deepEqual(packet.schema, ${JSON.stringify(schema)}); ${resultScript}`
    );
    await expect(transport.complete({ ...request, schema }, validateRevenue)).resolves.toMatchObject({ value: 2000 });
  });

  it("rejects invalid union branches and applies the shared guide limits before invoking the helper", async () => {
    const { transport, pidPath } = await fixture(resultScript);
    const text = { kind: "string" } as const;
    const variant = { kind: "object", fields: [{ name: "value", shape: text }] } as const;
    const manyFields = { kind: "object", fields: Array.from({ length: 13 }, (_, index) => ({ name: `v${index}`, shape: text })) };
    let deep: AppleGuidedShape = text;
    for (let depth = 0; depth < 5; depth++) deep = { kind: "array", maxItems: 2, element: deep };
    const invalid = [
      { kind: "union", variants: [variant] },
      { kind: "union", variants: Array(9).fill(variant) },
      { kind: "union", variants: [variant, text] },
      { kind: "union", variants: [variant, { kind: "object", fields: [] }] },
      { kind: "union", variants: [variant, { kind: "object", fields: [...variant.fields, ...variant.fields] }] },
      { kind: "union", variants: [variant, variant], optional: true },
      { kind: "union", variants: Array(8).fill(manyFields) },
      { kind: "union", variants: [variant, { kind: "object", fields: [{ name: "deep", shape: deep }] }] }
    ];
    for (const shape of invalid) {
      const schema = { kind: "object", fields: [{ name: "action", shape }] } as AppleCompletionRequest["schema"];
      await expect(transport.complete({ ...request, schema }, validateRevenue)).rejects.toMatchObject({ code: "invalid_guide" });
    }

    const union = { kind: "union", variants: [variant, variant] } as const;
    await expect(transport.complete({
      ...request, schema: union as unknown as AppleCompletionRequest["schema"]
    }, validateRevenue)).rejects.toMatchObject({ code: "invalid_request" });

    const largeVariant = {
      kind: "object",
      fields: Array.from({ length: 10 }, (_, index) => ({ name: `v${index}`, description: "a".repeat(240), shape: text }))
    } as const;
    await expect(transport.complete({
      ...request, prompt: "p".repeat(48 * 1024),
      schema: { kind: "object", fields: [{ name: "action", shape: { kind: "union", variants: Array(8).fill(largeVariant) } }] }
    }, validateRevenue)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(readFile(pidPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ['reply({error:"unsupported_locale"});', "unsupported_locale"],
    ['reply({error:"stale_identity"});', "stale_identity"],
    ['reply({error:"context_exceeded"});', "context_exceeded"],
    ['reply({error:"refused"});', "refused"],
    ['reply({error:"private internal details"});', "helper_protocol"],
    ['reply({id:"wrong",result:{}});', "helper_protocol"],
    ['reply({result:{}}); reply({result:{}});', "helper_protocol"],
    ['process.stdout.write("x".repeat(33 * 1024));', "helper_protocol"],
    ['process.exit(2);', "helper_exit"],
    ['reply({result:{identity,contextSize:256,inputTokens:200,proposal:{value:2000}}});', "helper_protocol"]
  ])("sanitizes and rejects a native failure, drift or malformed response", async (body, code) => {
    const { transport } = await fixture(body);
    await expect(transport.complete(request, validateRevenue)).rejects.toMatchObject({ code });
  });

  it("refuses a changed binary and browser-style guide fields", async () => {
    const { helperPath, transport } = await fixture(resultScript);
    await expect(transport.complete({
      ...request, schema: { ...request.schema, endpoint: "untrusted" } as AppleCompletionRequest["schema"]
    }, validateRevenue)).rejects.toMatchObject({ code: "invalid_guide" });
    await writeFile(helperPath, "changed");
    await expect(transport.discover("en-US")).rejects.toMatchObject({ code: "helper_identity" });
  });

  it("holds the slot through cancel, discards even a complete-looking late reply and reaps the owned child", async () => {
    const { pidPath, transport } = await fixture(
      'process.on("SIGTERM", () => { ' + resultScript + ' }); setInterval(() => {}, 25);'
    );
    const controller = new AbortController();
    const pending = transport.complete({ ...request, signal: controller.signal }, validateRevenue);
    const rejected = expect(pending).rejects.toMatchObject({ code: "cancelled" });
    const pid = await fixturePID(pidPath);
    await expect(transport.discover("en-US")).rejects.toMatchObject({ code: "busy" });
    controller.abort();
    await expect(transport.discover("en-US")).rejects.toMatchObject({ code: "busy" });
    await rejected;
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("reports an expired request budget before spawning the helper", async () => {
    const { pidPath, transport } = await fixture(resultScript);
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(request.timeoutMs + 1);
    try {
      await expect(transport.complete(request, validateRevenue)).rejects.toMatchObject({
        code: "timeout", timeoutOrigin: "PRE_SPAWN_BUDGET"
      });
      await expect(readFile(pidPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      now.mockRestore();
    }
  });

  it("preserves the origin of a correlated native timeout reply", async () => {
    const { transport } = await fixture('reply({error:"timeout"});');
    const validate = vi.fn(validateRevenue);
    await expect(transport.complete(request, validate)).rejects.toMatchObject({
      code: "timeout", timeoutOrigin: "HELPER_REPLY", message: "The Apple model request timed out."
    });
    expect(validate).not.toHaveBeenCalled();
  });

  it("does not publish a reply from a helper that fails to exit before the host deadline", async () => {
    const { pidPath, transport } = await fixture(resultScript + "setInterval(() => {}, 25);");
    await expect(transport.complete({ ...request, timeoutMs: 2_000 }, validateRevenue))
      .rejects.toMatchObject({ code: "timeout", timeoutOrigin: "PARENT_DEADLINE" });
    const pid = await fixturePID(pidPath);
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
