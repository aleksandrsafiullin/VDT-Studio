import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftSkillMarkdown } from "@vdt-studio/vdt-agent";
import { AppleTransportError, type AppleCompletionRequest, type AppleModelCapability } from "@vdt-studio/local-runner/apple-foundation-models";
import { expect, it, vi } from "vitest";
import type { AppleNativePort } from "./apple-native-host";

const rootKpi = "Accepted captions";
const prompt = "Build an editable weekly model for accepted captions at the review desk. The desk reviewed 180 items and sent back 30 items. Let me approve the Skill method before you build.";
const selectedProse = "Count desk acceptances by subtracting returned captions from reviewed captions.";
const alternateProse = "Count at publication using successful publication receipts.";
const capability: AppleModelCapability = {
  identity: { model: "SystemLanguageModel.default", profile: "vdt-native-guided-v1", osBuild: "fixture", modelRevision: null },
  locale: "en-US", contextSize: 8192, tokenBudgetVerified: true
};

function post(path: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

it("carries only the confirmed authored method into full measured construction after approval", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "vdt-apple-measured-method-"));
  const fullTurns: AppleCompletionRequest[] = [];
  const ambient = vi.fn();
  let runId: string | undefined;
  let selectedId: string;
  let alternateId: string;
  vi.stubEnv("VDT_APP_MODE", "development_web");
  vi.stubEnv("VDT_DATA_DIR", dataDir);
  vi.stubGlobal("fetch", ambient);
  const port: AppleNativePort = {
    discover: async () => capability,
    async complete(request, validate) {
      const turn = JSON.parse(request.prompt);
      const readIds: string[] = turn.observation?.skillResolution?.reads?.map(({ skillId }: { skillId: string }) => skillId) ?? [];
      const action = (tool: string, fields = {}) => ({ sessionState: "Continue from the current workspace.", action: { tool, ...fields } });
      let proposal: unknown;
      if (turn.outcomeAdmissionPolicy) {
        proposal = action("run.propose_outcome", { outcomeProposal: { outcome: "structural_model", evidenceQuote: prompt, confirmSkillMethod: true } });
      } else if (request.schema.fields[0]?.name === "conclusion") {
        expect(turn.readMethods).toEqual([{ skillId: selectedId, excerpt: expect.stringContaining(selectedProse) }]);
        proposal = { conclusion: "The desk reports reviewed captions less returns.", readiness: "method_ready" };
      } else if (turn.observation.skillResolution.outcome === "selected") {
        fullTurns.push(request);
        if (fullTurns.length > 1) {
          return new Promise<never>((_resolve, reject) => {
            const abort = () => reject(new AppleTransportError("cancelled"));
            if (request.signal?.aborted) abort();
            else request.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        proposal = { sessionState: "Create the requested draft.", tool: "vdt.create_draft",
          argumentsJson: JSON.stringify({ projectTitle: `${rootKpi} Driver Model`, rootKpi }) };
      } else if (!turn.observation.skillResolution.catalogComplete) {
        proposal = action("skill.list");
      } else if (!readIds.includes(selectedId)) {
        proposal = action("skill.read", { skillRead: { skillId: selectedId } });
      } else if (!readIds.includes(alternateId)) {
        proposal = action("skill.read", { skillRead: { skillId: alternateId } });
      } else {
        proposal = action("skill.select", { skillSelection: { skillId: selectedId, reason: "It calculates acceptances at the review desk." } });
      }
      return { value: validate(proposal), context: { contextSize: 8192, inputTokens: 840, reservedOutputTokens: request.maxOutputTokens } };
    }
  };

  const host = await import("./apple-native-host");
  const nativePort = vi.spyOn(host, "packagedAppleNativePort").mockReturnValue(port);
  const supervisor = await import("./supervisor-runtime");
  try {
    const [skills, bindings, runs, runtime, messages] = await Promise.all([
      import("../../skills/route"), import("../bindings/apple/route"), import("./route"), import("./runtime"), import("./[runId]/messages/route")
    ]);
    const publish = async (title: string, instructions: string) => {
      const response = await skills.POST(post("/api/skills", { raw: draftSkillMarkdown({
        title, description: "Weekly caption accounting", instructions, domain: "custom", patterns: [rootKpi]
      }) }));
      expect(response.status).toBe(201);
      return (await response.json()).skill.id as string;
    };
    selectedId = await publish("Review desk caption method", selectedProse);
    alternateId = await publish("Publication caption method", alternateProse);
    const bindingResponse = await bindings.POST(post("/api/agent/bindings/apple", { locale: "en-US" }));
    expect(bindingResponse.status).toBe(200);
    const { binding } = await bindingResponse.json();
    const response = await runs.POST(post("/api/agent/runs", {
      mode: "generate_vdt", outcomeSelection: "automatic", executionBindingId: binding.bindingId,
      expectedExecution: { mode: "local", profileVersion: 1, providerId: "apple_foundation_models", modelId: "SystemLanguageModel.default", modelRevision: null },
      input: { prompt, rootKpi, unit: "items", timePeriod: "week" }, options: { researchMode: "off" }
    }));
    expect(response.status).toBe(200);
    const created = await response.json() as { runId: string };
    runId = created.runId;
    const state = () => runtime.agentRuntime.store.getState(created.runId);
    await vi.waitFor(() => expect(state().status, JSON.stringify(state().events.at(-1))).toBe("needs_user_input"));
    const pending = state().request.skillResolution?.pendingMethod;
    expect(pending).toMatchObject({ skillId: selectedId, readReceiptId: expect.any(String) });
    expect(state().selectedSkills).toEqual([]);
    expect(state().builder?.getRevision()).toBe(0);
    expect(state().events.filter(({ type }) => type === "skill_read").map(({ metadata }) => metadata?.id)).toEqual([selectedId, alternateId]);
    expect(fullTurns).toHaveLength(0);

    const approved = await messages.POST(post(`/api/agent/runs/${created.runId}/messages`, {
      type: "user_answer", structuredAnswers: [{ questionId: pending!.questionId, selectedOptionIds: ["accept_method"] }],
      expectedExecutionMode: "local"
    }), { params: Promise.resolve({ runId: created.runId }) });
    expect(approved.status).toBe(200);
    await vi.waitFor(() => expect(fullTurns).toHaveLength(2));
    const read = state().events.find(({ type, metadata }) => type === "skill_read" && metadata?.id === selectedId)?.metadata;
    expect(state().events.find(({ type }) => type === "skill_selected")?.metadata).toMatchObject({
      id: selectedId, version: read?.version, contentHash: read?.contentHash, readReceiptId: read?.readReceiptId
    });
    for (const request of fullTurns) {
      expect(request.schema.fields.map(({ name }) => name)).toEqual(["sessionState", "tool", "argumentsJson"]);
      expect(request.maxOutputTokens).toBe(900);
      expect(request.prompt).not.toContain(alternateProse);
      const turn = JSON.parse(request.prompt);
      expect(turn.originalBrief).toMatchObject({ prompt, rootKpi });
      expect(turn.observation.selectedMethod).toMatchObject({
        id: selectedId, title: "Review desk caption method", version: read?.version,
        contentHash: read?.contentHash, readReceiptId: pending!.readReceiptId, excerpt: expect.stringContaining(selectedProse),
        executableTopology: false
      });
      expect(turn.observation).not.toHaveProperty("readSkillMethods");
      expect(turn.observation).not.toHaveProperty("missingPlannedInputIds");
    }
    expect(JSON.parse(fullTurns[1]!.prompt).checkpoint.results).toContainEqual(expect.objectContaining({
      toolName: "vdt.create_draft", status: "succeeded"
    }));
    expect(state().builder?.getProject().graph.nodes).toMatchObject([{ name: rootKpi, unit: "items" }]);
    expect(ambient).not.toHaveBeenCalled();
  } finally {
    if (runId && supervisor.isStructuredModelAgentRunActive(runId)) {
      await supervisor.cancelStructuredModelAgentRun(runId, true);
      await vi.waitFor(() => expect(supervisor.isStructuredModelAgentRunActive(runId!)).toBe(false));
    }
    nativePort.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
