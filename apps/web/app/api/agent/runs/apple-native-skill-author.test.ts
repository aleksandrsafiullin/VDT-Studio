import { expect, it, vi } from "vitest";
import type { AppleCompletionRequest, AppleModelCapability } from "@vdt-studio/local-runner/apple-foundation-models";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { readExecutableSkillTopology } from "@vdt-studio/vdt-agent";
import { authorSkillFromVdt, authorSkillUpdateFromVdt } from "@/lib/skill-author";
import { applySkillChanges } from "@/lib/skill-workflow";
import { createAppleNativeSkillAuthorProvider } from "./apple-native-skill-author";

const fixture = vi.hoisted(() => ({
  output: undefined as unknown,
  repair: undefined as unknown,
  review: "preserved",
  workingRelation: "matches",
  requests: [] as AppleCompletionRequest[]
}));
vi.mock("@/app/api/agent/runs/runtime", () => ({ agentExecutionBindingRegistry: {} }));
vi.mock("@/app/api/agent/runs/apple-native-binding", () => ({
  resolveAppleNativeTaskExecution() {
    const pinned: AppleModelCapability = {
      identity: { model: "SystemLanguageModel.default", profile: "vdt-native-guided-v1", osBuild: "fixture", modelRevision: null },
      locale: "en-US", contextSize: 8_192, tokenBudgetVerified: true
    };
    return {
      pinned, port: {
        discover: async () => pinned,
        async complete<T>(request: AppleCompletionRequest, validate: (proposal: unknown) => T) {
          fixture.requests.push(request);
          const review = request.schema.fields[0]?.name === "businessMeaning";
          const payload = review ? {
            businessMeaning: fixture.review, rootNodeId: JSON.parse(request.prompt).formulaEvidence.result.id
          } : request.schema.fields[0]?.name === "workingRelation" ? {
            workingRelation: fixture.workingRelation, rootNodeId: JSON.parse(request.prompt).formulaEvidence.result.id
          } : request.schema.fields[0]?.name === "instructions" ? fixture.repair : fixture.output;
          return { value: validate(payload), context: { inputTokens: 500, contextSize: 8_192, reservedOutputTokens: request.maxOutputTokens } };
        }
      }
    };
  }
}));

const builder = new VdtBuilderSession();
builder.createDraft({ rootKpi: "Sales Revenue", projectTitle: "Synthetic title", unit: "USD", timePeriod: "monthly" });
const root = builder.getProject().rootNodeId;
builder.addDriver({ nodeId: "units", parentNodeId: root, name: "Fulfilled Sales Units", unit: "unit", baselineValue: 684291 });
builder.addDriver({ nodeId: "price", parentNodeId: root, name: "Realized Unit Price", unit: "USD/unit", baselineValue: 937521 });
builder.setFormula({ nodeId: root, formula: "units * price" });
const project = builder.getProject();
const signal = new AbortController().signal;

const oldText = "Use a common reporting period.";
const raw = `---\nname: synthetic-sales-revenue\ndescription: Reusable sales revenue method.\n---\n\n# Revenue\n\n${oldText}\n`;
const method = "Multiply Fulfilled Sales Units (unit) by Realized Unit Price (USD/unit) for Sales Revenue (USD). Use a common reporting period and check for missing inputs.";
const target = { id: "user.synthetic", version: 1, contentHash: "test-content", fileHash: "test-file",
  baseVersion: 1, baseContentHash: "test-content", selectionRevision: 1 };
const patch = { id: "method", title: "Make the sales method explicit", reason: "The saved VDT shows inputs and dimensions.",
  nodeIds: ["units", "price"], before: oldText, after: method, kind: "replace" };
const create = () => authorSkillFromVdt(createAppleNativeSkillAuthorProvider({}, "draft"), project, signal);
const update = (working = raw) => authorSkillUpdateFromVdt(createAppleNativeSkillAuthorProvider({}, "update"), project,
  { raw: working, baseRaw: working, target }, signal);

it("guides exact selling-price terminology and preserves the preview and host formula", async () => {
  fixture.output = { title: "Sales Revenue", description: "Compute sales revenue from fulfilled transactions.", domain: "finance",
    patterns: ["Sales Revenue"], instructions: method };
  const draft = await create();
  expect(draft.raw).toContain(method);
  expect(readExecutableSkillTopology({ body: draft.raw })).toMatchObject({ rootUnit: "USD", rootFormula: "units * price", timePeriod: "monthly" });
  const createRequest = fixture.requests.slice().reverse().find(item => item.schema.fields[0]?.name === "title")!;
  expect(createRequest.prompt).toContain("Return only the directly guided object");
  expect(createRequest.prompt).not.toMatch(/flat agent-decision-v2|argsJson|684291|937521|Synthetic title/);
  expect(createRequest.prompt).toContain("Preserve the source formula and unit relationships");
  const createSource = JSON.parse(createRequest.prompt.split("\n").at(-1)!);
  expect(createSource.formulaEvidence).toEqual({
    result: { id: root, name: "Sales Revenue", formula: "units * price", unit: "USD" },
    operands: [
      { id: "units", name: "Fulfilled Sales Units", unit: "unit" },
      { id: "price", name: "Realized Unit Price", unit: "USD/unit" }
    ]
  });
  const audit = JSON.parse(fixture.requests.at(-1)!.prompt);
  expect(audit.formulaEvidence).toEqual(createSource.formulaEvidence);
  expect(audit.proposal.instructions).toBe(method);
  expect(JSON.stringify(audit)).not.toMatch(/684291|937521|Synthetic title/);
  expect(createSource.source.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: root, formula: "units * price", unit: "USD" }),
    expect.objectContaining({ id: "units", name: "Fulfilled Sales Units", unit: "unit" }),
    expect.objectContaining({ id: "price", name: "Realized Unit Price", unit: "USD/unit" })
  ]));

  fixture.output = { summary: "Add the method and dimensions.", changes: [patch] };
  const result = await update();
  expect(result.target).toEqual(target);
  expect(result.raw).toBe(raw);
  expect(result.changes).toEqual([patch, expect.objectContaining({ id: "host.topology" })]);
  expect(applySkillChanges(result.raw, result.changes)).toContain(method);
  const updateRequest = fixture.requests.slice().reverse().find(item => item.schema.fields[0]?.name === "summary")!;
  expect(updateRequest.prompt).toContain("copy the exact unique before passage");
  expect(updateRequest.prompt).toContain("return changes: [] and explain why in summary");
  expect(updateRequest.prompt).not.toMatch(/flat agent-decision-v2|argsJson/);
  const updateSource = JSON.parse(updateRequest.prompt.split("\n").at(-1)!);
  expect(updateSource.baseSkill).toEqual({ raw, version: 1 });
  expect(updateSource.latestSkill).toEqual({ raw, version: 1 });

  fixture.output = { summary: "The guidance already matches.", changes: [] };
  expect(await update(draft.raw)).toMatchObject({ changes: [], target });
  fixture.output = { summary: "An emitted unchanged patch.", changes: [{ ...patch, after: oldText }] };
  await expect(update()).rejects.toThrow("A skill change is empty or too large.");
});
it("rejects a metric substitution even if exact names and currency dimensions are present", async () => {
  const text = "Sales Revenue is the product of Fulfilled Sales Units and Realized Unit Price. Realized Unit Price is the cost incurred per item, in USD/unit.";
  fixture.output = { title: "Sales Revenue", description: "Measure the outcome over a shared period.", domain: "finance",
    patterns: ["Sales Revenue"], instructions: text };
  fixture.review = "changed_or_unverified";
  try {
    await expect(create()).rejects.toMatchObject({ code: "invalid_output" });
    const review = fixture.requests.at(-1)!;
    expect(review).toMatchObject({ locale: "en-US", timeoutMs: 10_000 });
    expect(JSON.parse(review.prompt).proposal.instructions).toBe(text);

    fixture.output = { summary: "Add a different measure.", changes: [{ ...patch, after: text }] };
    await expect(update()).rejects.toMatchObject({ code: "invalid_output" });
    expect(JSON.parse(fixture.requests.at(-1)!.prompt).proposal.changes[0].after).toBe(text);
  } finally { fixture.review = "preserved"; }
});

it("repairs missing exact names once and audits the exact model-authored Markdown", async () => {
  const instructions = "Multiply **Fulfilled Sales Units** (unit) by `Realized Unit Price` (USD/unit) for Sales Revenue (USD).\n\nUse a common reporting period.";
  fixture.output = { title: "Sales Revenue", description: "Compute the source KPI.", domain: "finance",
    patterns: ["Sales Revenue"], instructions: "Multiply the output quantity by the price per item to calculate sales." };
  fixture.repair = { instructions };
  const start = fixture.requests.length;
  const repaired = await create();
  const [generator, repair, audit] = fixture.requests.slice(start);
  expect(repaired.raw).toContain(instructions);
  expect(readExecutableSkillTopology({ body: repaired.raw })).toMatchObject({ rootFormula: "units * price", rootUnit: "USD" });
  expect(repair).toMatchObject({ timeoutMs: 8_000, expectedIdentity: generator?.expectedIdentity, signal: generator?.signal });
  expect(audit).toMatchObject({ timeoutMs: 10_000, expectedIdentity: generator?.expectedIdentity, signal: generator?.signal });
  const repairPrompt = JSON.parse(repair!.prompt);
  expect(repairPrompt.missingLabels.map(({ name }: { name: string }) => name)).toEqual(["Sales Revenue", "Fulfilled Sales Units", "Realized Unit Price"]);
  expect(repairPrompt.instructions).toBe((fixture.output as { instructions: string }).instructions);
  expect(repair!.prompt).not.toMatch(/684291|937521|Synthetic title/);
  expect(JSON.parse(audit!.prompt).proposal).toEqual({ ...(fixture.output as object), instructions });

  fixture.review = "changed_or_unverified";
  try { await expect(create()).rejects.toMatchObject({ code: "invalid_output" }); }
  finally { fixture.review = "preserved"; }
});

it("rejects a failed single anchor repair before asking for a meaning audit", async () => {
  fixture.output = { title: "Sales Revenue", description: "Estimate total value.", domain: "finance",
    patterns: ["Sales Revenue"], instructions: "Multiply the output quantity by the cost per item to get financial output." };
  fixture.repair = { instructions: "Sales Revenue equals sold items times an unspecified rate." };
  const start = fixture.requests.length;
  await expect(create()).rejects.toMatchObject({ code: "invalid_output" });
  expect(fixture.requests.slice(start).map(request => request.schema.fields[0]?.name)).toEqual(["title", "instructions"]);
});

it("retains a truthful empty update as independent host topology only", async () => {
  fixture.output = { summary: "No reusable guidance edits proposed.", changes: [] };
  const start = fixture.requests.length;
  const result = await update();
  expect(result.changes.map(change => change.id)).toEqual(["host.topology"]);
  const [generator] = fixture.requests.slice(start);
  expect(fixture.requests).toHaveLength(start + 1);
  expect(generator!.prompt).toContain("If a reusable calculation step is missing");
  expect(generator!.prompt).toContain("If no reusable guidance needs changing");
});
