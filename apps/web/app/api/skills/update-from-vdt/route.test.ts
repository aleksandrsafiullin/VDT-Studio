import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalSkillRepository } from "@vdt-studio/storage";
import { loadAvailableSkillLibrary, publishManagedSkill, UNIVERSAL_SKILL_ID } from "@vdt-studio/vdt-agent";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { openVdtStorageDatabase } from "../../vdt/storage-database";
import { selectedProvider } from "@/lib/smart-kpi-service";
import { createManagedAwareAiProvider } from "../../agent/runs/managed-ai-provider";
import { POST, maxDuration as updateMaxDuration } from "./route";
import { POST as fromVdt, maxDuration as createMaxDuration } from "../from-vdt/route";
import { SKILL_AUTHOR_LOCAL_TIMEOUT_MS, SKILL_AUTHOR_REMOTE_TIMEOUT_MS, skillAuthorTimeoutMs } from "@/lib/skill-author-deadline";

const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@/lib/smart-kpi-service", () => ({ selectedProvider: vi.fn(async () => ({ id: "test", name: "Test", type: "mock", completeStructured: mocks.complete })) }));
vi.mock("../../agent/runs/managed-ai-provider", () => ({ createManagedAwareAiProvider: vi.fn(() => ({ id: "local_runner", name: "Test local", type: "local_runner", completeStructured: mocks.complete })) }));

let root: string;
const raw = "---\nname: revenue-method\ndescription: Reusable revenue method.\n---\n\n# Revenue\n\nUse a common period.\n";
const result = () => ({ type: "call_tool", toolName: "skill.author_update", args: { summary: "Clarify period checks.", changes: [{
  id: "period", title: "Validate input periods", reason: "Both inputs belong to the same period.", nodeIds: ["units"],
  before: "Use a common period.", after: "Use and validate a common reporting period.", kind: "replace"
}] }, statusMessage: "Ready for review." });

function project() {
  const builder = new VdtBuilderSession();
  builder.createDraft({ rootKpi: "Revenue", projectTitle: "Private project", unit: "USD" });
  const root = builder.getProject().rootNodeId;
  builder.addDriver({ nodeId: "units", parentNodeId: root, name: "Units", unit: "unit", baselineValue: 123456 });
  builder.addDriver({ nodeId: "price", parentNodeId: root, name: "Price", unit: "USD/unit", baselineValue: 789 });
  builder.setFormula({ nodeId: root, formula: "units * price" });
  return builder.getProject();
}
const request = (body: unknown, origin = "http://localhost:3000", signal?: AbortSignal) => new Request("http://localhost:3000/api/skills/update-from-vdt", {
  method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body), ...(signal ? { signal } : {})
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-skill-update-author-"));
  vi.stubEnv("VDT_DATA_DIR", root); vi.stubEnv("VDT_APP_MODE", "development_web"); vi.clearAllMocks();
  mocks.complete.mockReset(); mocks.complete.mockResolvedValue(result());
  const database = openVdtStorageDatabase(process.cwd());
  try { database.createProject({ id: "p", name: "Project" }); database.createVdt({ id: "v", projectId: "p", name: "Revenue", rootKpi: "Revenue" }); }
  finally { database.close(); }
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

async function fixture() {
  const repository = new LocalSkillRepository();
  await loadAvailableSkillLibrary(repository);
  const skill = publishManagedSkill({ raw }, repository);
  const selection = repository.select("p", "v", { skillId: skill.id, version: skill.version, contentHash: skill.contentHash, source: "user", reason: "Used for this tree.", rootKpi: "Revenue" }, 0);
  return { repository, skill, selection, input: { projectId: "p", vdtId: "v", project: project(),
    providerId: "openai_compatible", providerConfig: {}, base: { id: skill.id, version: skill.version, contentHash: skill.contentHash }, selectionRevision: selection.revision } };
}

describe("read-only skill drafting routes", () => {
  it("returns a reviewable update anchored in exact portable working bytes, without publishing or changing the pin", async () => {
    const { repository, skill, selection, input } = await fixture(), response = await POST(request(input)), body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.proposal.raw).toBe(raw);
    expect(body.proposal.raw).not.toContain("id:");
    expect(body.proposal.target).toMatchObject({ id: skill.id, version: 1, baseVersion: 1, selectionRevision: selection.revision, contentHash: skill.contentHash });
    expect(body.proposal.changes[0].after).toContain("validate");
    expect(repository.get(skill.id)?.version).toBe(1);
    expect(repository.getSelection("p", "v")).toEqual(selection);
    expect(repository.files.read(skill.filePath!)).toBe(raw);
    expect(JSON.stringify(mocks.complete.mock.calls[0]![0].input)).not.toMatch(/123456|789|baselineValue|Private project/);
  });
  it("compares an older pinned base with newer external edits and preserves the latest working version", async () => {
    const { repository, skill, input } = await fixture();
    const latest = raw + "\nKeep the newer exception.\n";
    fs.writeFileSync(path.join(repository.files.rootPath, skill.filePath!), latest);
    const response = await POST(request(input)), body = await response.json();
    expect(response.status).toBe(200);
    expect(body.proposal.raw).toBe(latest);
    expect(body.proposal.target).toMatchObject({ version: 2, baseVersion: 1 });
    expect(body.proposal.warnings).toEqual([expect.stringContaining("changed since")]);
    const authorInput = mocks.complete.mock.calls[0]![0].input;
    expect(authorInput.baseSkill.raw).not.toContain("newer exception");
    expect(authorInput.latestSkill.raw).toContain("newer exception");
  });
  it("rejects mismatched owners, stale selections, and universal updates before contacting the provider", async () => {
    const { repository, input } = await fixture();
    expect((await POST(request({ ...input, projectId: "another" }))).status).toBe(404);
    expect((await POST(request({ ...input, selectionRevision: 999 }))).status).toBe(409);
    const universal = repository.get(UNIVERSAL_SKILL_ID)!;
    const selection = repository.select("p", "v", { skillId: universal.id, version: universal.version, contentHash: universal.contentHash,
      source: "auto", reason: "Fallback", rootKpi: "Revenue" }, input.selectionRevision);
    const response = await POST(request({ ...input, base: { id: universal.id, version: universal.version, contentHash: universal.contentHash }, selectionRevision: selection.revision }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("UNIVERSAL_SKILL_UPDATE");
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("does not prepare against deleted or invalid externally edited working files", async () => {
    const { repository, skill, input } = await fixture(), filename = path.join(repository.files.rootPath, skill.filePath!);
    fs.writeFileSync(filename, "---\nname: revenue-method\n---\nInvalid working file.");
    expect((await POST(request(input))).status).toBe(409);
    fs.unlinkSync(filename);
    expect((await POST(request(input))).status).toBe(409);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(fs.existsSync(filename)).toBe(false);
  });
  it("rejects a file or pin changed during generation instead of returning a stale proposal", async () => {
    const { repository, skill, selection, input } = await fixture();
    mocks.complete.mockImplementationOnce(async () => {
      repository.select("p", "v", { skillId: skill.id, version: skill.version, contentHash: skill.contentHash, source: "user", reason: "Reselected", rootKpi: "Revenue" }, selection.revision);
      return result();
    });
    expect((await POST(request(input))).status).toBe(409);
    const refreshed = { ...input, selectionRevision: repository.getSelection("p", "v")!.revision };
    mocks.complete.mockImplementationOnce(async () => { fs.unlinkSync(path.join(repository.files.rootPath, skill.filePath!)); return result(); });
    expect((await POST(request(refreshed))).status).toBe(409);
  });
  it("keeps same-origin and local-only guards for AI preparation", async () => {
    const { input } = await fixture();
    expect((await POST(request(input, "https://attacker.example"))).status).toBe(403);
    vi.stubEnv("VDT_APP_MODE", "hosted_web");
    expect((await POST(request(input))).status).toBe(403);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("uses only the explicitly selected managed local transport and includes bounded feedback", async () => {
    const { input } = await fixture();
    expect((await POST(request({ ...input, providerId: "local_runner", providerConfig: { backendId: "codex_subscription" }, feedback: "Clarify periods." }))).status).toBe(200);
    expect(createManagedAwareAiProvider).toHaveBeenCalledOnce();
    expect(selectedProvider).not.toHaveBeenCalled();
    expect(mocks.complete.mock.calls[0]![0].input.feedback).toBe("Clarify periods.");
    expect((await POST(request({ ...input, feedback: "x".repeat(4001) }))).status).toBe(400);
  });
  it("sanitizes provider failures and rejects unsupported tool responses", async () => {
    const { input } = await fixture();
    mocks.complete.mockRejectedValueOnce(new Error("provider secret sk-sensitive and /Users/private/file"));
    const response = await POST(request(input)), text = await response.text();
    expect(response.status).toBe(422);
    expect(text).not.toMatch(/sk-sensitive|Users\/private/);
    mocks.complete.mockResolvedValueOnce({ type: "call_tool", toolName: "vdt.delete_node", args: {}, statusMessage: "Delete" });
    expect((await POST(request(input))).status).toBe(422);
  });
  it("drops a result after cancellation", async () => {
    const { input } = await fixture(), controller = new AbortController();
    mocks.complete.mockImplementationOnce(async () => { controller.abort(); return result(); });
    const response = await POST(request(input, "http://localhost:3000", controller.signal));
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("proposal");
  });
  it("extends new-skill drafting with feedback while retaining its unsaved, values-free contract", async () => {
    const { input } = await fixture();
    const createInput = { projectId: input.projectId, vdtId: input.vdtId, project: input.project,
      providerId: input.providerId, providerConfig: input.providerConfig };
    mocks.complete.mockResolvedValueOnce({ type: "call_tool", toolName: "skill.author_draft", args: { title: "Revenue method", description: "Build a consistent revenue model.", domain: "finance", patterns: ["Revenue"],
      instructions: "## Method\n\nMultiply fulfilled sales units by realized unit price. Validate units and reporting periods." }, statusMessage: "Draft ready" });
    const response = await fromVdt(request({ ...createInput, feedback: "Keep units explicit." })), body = await response.json();
    expect(response.status).toBe(200);
    expect(body.raw).toContain("Revenue method");
    expect(body.raw).not.toMatch(/123456|789/);
    expect(mocks.complete.mock.calls[0]![0].input.feedback).toBe("Keep units explicit.");
  });
});

type DraftMode = "create" | "update";
type FixtureInput = Awaited<ReturnType<typeof fixture>>["input"];
const handler = (mode: DraftMode) => mode === "create" ? fromVdt : POST;
const draftingInput = (input: FixtureInput, mode: DraftMode, providerId = "local_runner", providerConfig: Record<string, unknown> = { backendId: "ollama", model: "qwen3.6:27b", modelReasoning: false }) => {
  const common = { projectId: input.projectId, vdtId: input.vdtId, project: input.project, providerId, providerConfig };
  return mode === "update" ? { ...common, base: input.base, selectionRevision: input.selectionRevision } : common;
};
const draftResult = (mode: DraftMode) => mode === "update" ? result() : { type: "call_tool", toolName: "skill.author_draft", args: {
  title: "Revenue method", description: "Build a consistent revenue model.", domain: "finance", patterns: ["Revenue"],
  instructions: "## Method\n\nMultiply fulfilled sales units by realized unit price. Validate units and reporting periods."
}, statusMessage: "Draft ready" };

function holdCompletion() {
  let finish: (value: unknown) => void = () => {}, fail: (error: unknown) => void = () => {}, entered = () => {}, signal: AbortSignal | undefined;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const output = new Promise<unknown>((resolve, reject) => { finish = resolve; fail = reject; });
  mocks.complete.mockImplementation((params: { signal: AbortSignal }) => { signal = params.signal; entered(); return output; });
  return { started, finish, fail, signal: () => signal! };
}

function observeRequestListeners(input: Request) {
  const added = vi.spyOn(input.signal, "addEventListener"), removed = vi.spyOn(input.signal, "removeEventListener");
  return () => {
    const listeners = added.mock.calls.filter(call => call[0] === "abort");
    expect(listeners.length).toBeGreaterThan(0);
    for (const call of listeners) expect(removed).toHaveBeenCalledWith("abort", call[1]);
  };
}

describe("Skill Author provider-specific waiting budgets", () => {
  it.each(["create", "update"] as const)("allows a local %s completion after 90 seconds without changing execution selection", async mode => {
    const { input } = await fixture();
    vi.useFakeTimers();
    const held = holdCompletion(), providerConfig = { backendId: "ollama", model: "qwen3.6:27b", modelReasoning: false, timeoutMs: 90_000 };
    const req = request(draftingInput(input, mode, "local_runner", providerConfig)), expectListenersRemoved = observeRequestListeners(req);
    let completed = false;
    const pending = handler(mode)(req).then(response => { completed = true; return response; });
    await held.started;
    await vi.advanceTimersByTimeAsync(110_000);
    expect(completed).toBe(false);
    expect(held.signal().aborted).toBe(false);
    expect(createManagedAwareAiProvider).toHaveBeenCalledWith({ providerId: "local_runner", providerConfig: { ...providerConfig, timeoutMs: SKILL_AUTHOR_LOCAL_TIMEOUT_MS } }, req.url);
    held.finish(draftResult(mode));
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty(mode === "create" ? "raw" : "proposal");
    expectListenersRemoved();
    expect(vi.getTimerCount()).toBe(0);
    expect(createMaxDuration * 1000).toBeGreaterThan(SKILL_AUTHOR_LOCAL_TIMEOUT_MS);
    expect(updateMaxDuration * 1000).toBeGreaterThan(SKILL_AUTHOR_LOCAL_TIMEOUT_MS);
  });

  it.each(["create", "update"] as const)("returns a safe 504 at the full local %s deadline and rejects an ignored-abort late result", async mode => {
    const { repository, skill, selection, input } = await fixture();
    vi.useFakeTimers();
    const held = holdCompletion(), req = request(draftingInput(input, mode)), expectListenersRemoved = observeRequestListeners(req);
    const pending = handler(mode)(req);
    await held.started;
    const cancelled = vi.fn(); held.signal().addEventListener("abort", cancelled, { once: true });
    await vi.advanceTimersByTimeAsync(SKILL_AUTHOR_LOCAL_TIMEOUT_MS - 1);
    expect(held.signal().aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending, body = await response.json();
    expect(response.status).toBe(504);
    expect(body).toMatchObject({ ok: false, error: { code: "SKILL_AUTHOR_TIMEOUT", message: expect.stringContaining("300 seconds") } });
    expect(body.error.message).toContain("Try again");
    expect(body).not.toHaveProperty(mode === "create" ? "raw" : "proposal");
    expect(cancelled).toHaveBeenCalledOnce();
    expectListenersRemoved();
    expect(vi.getTimerCount()).toBe(0);
    held.finish(draftResult(mode));
    await vi.advanceTimersByTimeAsync(1);
    expect(repository.get(skill.id)?.version).toBe(skill.version);
    expect(repository.getSelection("p", "v")).toEqual(selection);
    expect(await pending).toBe(response);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["create", "update"] as const)("retains the 90-second remote %s deadline", async mode => {
    const { input } = await fixture();
    vi.useFakeTimers();
    const held = holdCompletion(), req = request(draftingInput(input, mode, "openai_compatible", { model: "selected-remote", modelReasoning: false }));
    const pending = handler(mode)(req);
    await held.started;
    expect(selectedProvider).toHaveBeenCalledWith(expect.objectContaining({ providerId: "openai_compatible", timeoutMs: SKILL_AUTHOR_REMOTE_TIMEOUT_MS,
      providerConfig: { model: "selected-remote", modelReasoning: false } }), expect.any(AbortSignal), req.url, 256 * 1024);
    await vi.advanceTimersByTimeAsync(SKILL_AUTHOR_REMOTE_TIMEOUT_MS - 1);
    expect(held.signal().aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending, body = await response.json();
    expect(response.status).toBe(504);
    expect(body.error).toMatchObject({ code: "SKILL_AUTHOR_TIMEOUT", message: expect.stringContaining("90 seconds") });
    expect(held.signal().aborted).toBe(true);
    held.finish(draftResult(mode)); await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["create", "update"] as const)("accepts a remote %s response within its existing budget and clears its timer", async mode => {
    const { input } = await fixture();
    vi.useFakeTimers();
    const held = holdCompletion(), req = request(draftingInput(input, mode, "openai_compatible")), expectListenersRemoved = observeRequestListeners(req);
    const pending = handler(mode)(req);
    await held.started; await vi.advanceTimersByTimeAsync(89_000);
    held.finish(draftResult(mode));
    expect((await pending).status).toBe(200);
    expect(held.signal().aborted).toBe(false);
    expectListenersRemoved(); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SKILL_AUTHOR_LOCAL_TIMEOUT_MS);
    expect(held.signal().aborted).toBe(false);
  });

  it.each(["create", "update"] as const)("classifies a known early provider TIMEOUT for %s without exposing its upstream message", async mode => {
    const { input } = await fixture();
    vi.useFakeTimers();
    mocks.complete.mockRejectedValueOnce(Object.assign(new Error("secret sk-sensitive /Users/private upstream diagnostics"), { code: "TIMEOUT" }));
    const req = request(draftingInput(input, mode)), expectListenersRemoved = observeRequestListeners(req);
    const response = await handler(mode)(req), body = await response.json();
    expect(response.status).toBe(504);
    expect(body.error.code).toBe("SKILL_AUTHOR_TIMEOUT");
    expect(body.error.message).toContain("300 seconds");
    expect(body.error.message).toContain("selected provider timed out");
    expect(JSON.stringify(body)).not.toMatch(/sk-sensitive|Users\/private|upstream diagnostics/);
    expectListenersRemoved(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["create", "update"] as const)("preserves safe native budget diagnostics for %s without exposing upstream details", async mode => {
    const { input } = await fixture();
    for (const code of ["SKILL_AUTHOR_CONTEXT_LIMIT", "SKILL_AUTHOR_OUTPUT_LIMIT"]) {
      mocks.complete.mockRejectedValueOnce(Object.assign(new Error("private upstream text and /Users/private/source"), { code }));
      const response = await handler(mode)(request(draftingInput(input, mode))), body = await response.json();
      expect(response.status).toBe(422);
      expect(body.error.code).toBe(code);
      expect(body.error.message).toMatch(/bounded/);
      expect(JSON.stringify(body)).not.toMatch(/private upstream|Users\/private/);
    }
  });

  it.each(["create", "update"] as const)("keeps manual %s cancellation distinct from a timeout, even with a late TIMEOUT rejection", async mode => {
    const { input } = await fixture();
    vi.useFakeTimers();
    const caller = new AbortController(), held = holdCompletion(), req = request(draftingInput(input, mode), "http://localhost:3000", caller.signal);
    const expectListenersRemoved = observeRequestListeners(req), pending = handler(mode)(req);
    await held.started; await vi.advanceTimersByTimeAsync(100_000);
    caller.abort();
    held.fail(Object.assign(new Error("Upstream timed out after cancel."), { code: "TIMEOUT" }));
    const response = await pending, body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error.code).toBe("SKILL_AUTHOR_CANCELLED");
    expect(body.error.message).not.toMatch(/timed out|waiting limit/);
    expect(held.signal().aborted).toBe(true);
    expectListenersRemoved(); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SKILL_AUTHOR_LOCAL_TIMEOUT_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the longer budget only for local_runner", () => {
    expect(skillAuthorTimeoutMs("local_runner")).toBe(300_000);
    for (const providerId of ["openai_compatible", "anthropic", "gemini", "azure_openai", "unknown"]) expect(skillAuthorTimeoutMs(providerId)).toBe(90_000);
  });
});
