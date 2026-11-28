import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVersionSnapshot, exportProjectExcel, buildChatStarterInput, buildKpiSuggestionContext, buildKpiSuggestionTaskInput, productionVolumeProject, VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AppleTransportError, type AppleCompletionRequest, type AppleModelCapability } from "@vdt-studio/local-runner/apple-foundation-models";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppleNativePort } from "./apple-native-host";

const capability: AppleModelCapability = {
  identity: { model: "SystemLanguageModel.default", profile: "vdt-native-guided-v1", osBuild: "fixture build", modelRevision: null },
  locale: "en-US", contextSize: 8192, tokenBudgetVerified: true
};
const dataDir = mkdtempSync(join(tmpdir(), "vdt-apple-route-"));
const expectation = {
  mode: "local", profileVersion: 1, providerId: "apple_foundation_models",
  modelId: "SystemLanguageModel.default", modelRevision: null
} as const;
let currentCapability = capability;
let smartOutput: unknown = { proposal: { kind: "empty", reason: "The target needs scope clarification." } };
let runId: string | undefined;
let holdFirstGapProposal: (() => Promise<void>) | undefined;
let holdSkillFit: (() => Promise<void>) | undefined;
const requests: AppleCompletionRequest[] = [];
const workbookCases = [false, "answer", "structural_model", "structural_direct", "explicit_id", "explicit_missing",
  "explicit_head_before", "explicit_instruction_before", "explicit_head_after", "explicit_instruction_after",
  "named_scope_corrected", "direct_workbook_and_summary", "named_scope_finish_head_after", "named_scope_missing_export_proof", "named_scope_wrong_export_proof", "named_scope_ambiguous", "named_scope_unknown", "named_scope_descriptive", "named_scope_head_before", "named_scope_head_after"] as const;
let omitWorkbookBeforeAssessment: typeof workbookCases[number] = false;
let afterWorkbookAssessment: (() => Promise<void>) | undefined;
let afterWorkbookCorrection: (() => Promise<void>) | undefined;
let afterWorkbookFinishOffer: (() => Promise<void>) | undefined;
const testingExplicitWorkbook = () => typeof omitWorkbookBeforeAssessment === "string" && omitWorkbookBeforeAssessment.startsWith("explicit_");
const testingNamedScopeRecovery = () => typeof omitWorkbookBeforeAssessment === "string" && omitWorkbookBeforeAssessment.startsWith("named_scope_");
let namedScopeCorrections = 0;
let workbookFinishOffer = 0;
const missingExportProof = () => omitWorkbookBeforeAssessment === "named_scope_missing_export_proof" || omitWorkbookBeforeAssessment === "named_scope_wrong_export_proof";
let ordinaryWorkbookProposals = 0;
const workbookSummary = "The current model tracks production volume.";
const namedWorkbookPrompt = "Export an Excel workbook for Recovery from the saved version “LINE CHECK”.";
let workbookPrompt = namedWorkbookPrompt;
let explicitWorkbookRevision: string | undefined;
const lateGapReason = "The candidate methods do not cover the desk result.";
const lateGapQuestion = { question: "How does overlap affect the count?", reason: "Overlap changes the calculation." };
const lateGapGroundedQuestion = "Is it possible that any caption occurs in both queues?";
let lateGapFixture: { prompt: string; deskId: string; publishingId: string; complete: boolean; direct?: boolean; answered?: boolean; joint?: boolean; wrongBoundary?: boolean; distinctQuestion?: boolean; rejectedQuestion?: boolean; wrongRule?: boolean } | undefined;

type ScopeSpan = { id: string; text: string; source?: string };
type ScopeProof = { condition: ScopeSpan; rule: ScopeSpan };
interface LateGapTurn {
  tools?: { name: string }[];
  reads: { skillId: string }[];
  userSources: { originalRequest: string };
  scopeSpans?: ScopeSpan[];
  draft?: { question: string; reason: string };
  method: { skillId: string; spans: ScopeSpan[] };
  excerpt?: string;
  completeRuleChoices?: ScopeSpan[];
  user?: string;
  methodA?: string;
  methodB?: string;
  clauses?: { key: string; text: string; source: string }[];
  candidateRule?: { rule: ScopeSpan; event: string };
  candidateExcerpt?: string;
  proposedRule?: { rule: ScopeSpan; event: string };
  competingRule?: { rule: ScopeSpan; event: string };
  proposedExcerpt?: string;
  competingExcerpt?: string;
  witness?: { key: string; span: ScopeSpan };
  witnessSpans: ScopeSpan[];
  ruleSpans: ScopeSpan[];
  prerequisiteToCheck?: ScopeProof;
  missingConditionToCheck?: ScopeProof;
  questionCandidates?: { id: string; question: string }[];
  currentWitness?: ScopeSpan & { answeredQuestion?: string };
  polarity?: string;
  question?: string;
  condition?: ScopeSpan;
  governingRule?: ScopeSpan;
  methodExcerpt?: string;
  outcomeAdmissionPolicy?: unknown;
  observation: { skillResolution?: { outcome?: string; reads: { skillId: string }[] } };
}

async function lateGapResponse(request: AppleCompletionRequest, turn: LateGapTurn, fixture: NonNullable<typeof lateGapFixture>) {
  const { prompt, deskId, publishingId, complete } = fixture;
  const addressed = { sessionState: "Review the counting boundary." };
  const choices = (tool: string, data = {}) => ({ ...addressed, action: { tool, ...data } });
  const available = (turn.tools ?? []).map(({ name }) => name);
  const field = request.schema.fields[0]?.name;
  if (field === "scopeQuestionFit") {
    expect(fixture.distinctQuestion).toBe(true);
    expect(turn.userSources.originalRequest).toBe(prompt);
    expect(turn.draft).toEqual({
      question: "Should the count follow the original caption date or the date checked?",
      reason: "The reporting date changes the week."
    });
    return confirmCatalogQuestion(request, turn.scopeSpans ?? [], "One desk checks 180 live captions");
  }
  if (field === "gapFit") {
    expect(turn.reads.map(({ skillId }) => skillId).sort()).toEqual([deskId, publishingId].sort());
    return { gapFit: "ask_scope" };
  }
  if (field === "countingRuleFirst" || field === "countingRuleSecond") {
    expect(turn.userSources).toBeUndefined();
    expect(turn.excerpt).toMatch(/Count a caption when the desk accepts it|use its successful acceptance receipts/);
    const rule = turn.completeRuleChoices?.[0];
    if (!rule) throw new Error("The method omitted the authenticated rule choices.");
    expect(turn.excerpt).toContain(rule.text);
    return { [field]: rule.id };
  }
  if (field === "boundaryMatch") {
    expect(turn.user).toBe(prompt);
    const firstIsDesk = turn.methodA?.includes("desk accepts");
    expect([turn.methodA, turn.methodB].filter(excerpt => excerpt?.includes("desk accepts"))).toHaveLength(1);
    const chooseFirst = Boolean(fixture.wrongBoundary) === !firstIsDesk;
    return { boundaryMatch: chooseFirst ? "A" : "B" };
  }
  if (field === "boundaryWitness") {
    const witness = turn.clauses?.find(clause => clause.text.startsWith("One desk checks"));
    if (!witness) throw new Error("The comparison omitted the current operation.");
    return { boundaryWitness: witness.key };
  }
  if (field === "proposedBoundaryAudit") {
    expect(turn.candidateExcerpt).toContain(turn.candidateRule?.rule.text);
    expect(turn.witness?.span.text).toBe("One desk checks 180 live captions; 30 are sent back.");
    return { proposedBoundaryAudit: turn.candidateExcerpt?.includes("desk accepts") ? "matches" : "outside" };
  }
  if (field === "boundaryAudit") {
    expect(turn.proposedExcerpt).toContain(turn.proposedRule?.rule.text);
    expect(turn.competingExcerpt).toContain(turn.competingRule?.rule.text);
    expect(turn.witness?.span.text).toBe("One desk checks 180 live captions; 30 are sent back.");
    expect(turn.clauses).toContainEqual(expect.objectContaining({ key: turn.witness?.key, text: turn.witness?.span.text }));
    return { boundaryAudit: "verified" };
  }
  if (field === "prerequisiteRule") {
    expect(turn.userSources).toBeUndefined();
    expect(turn.method.skillId).toBe(deskId);
    const rule = fixture.wrongRule ? turn.ruleSpans[0] : turn.ruleSpans.find(span => span.text.includes("nonoverlapping queues"));
    if (!rule) throw new Error("The authenticated rules omitted the operative prerequisite.");
    return { prerequisiteRule: rule.id };
  }
  if (field === "conditionEvidence" || field === "conditionWitness") {
    expect(turn.methodExcerpt).toContain("Ask for identity and overlap rules if a caption can occur twice.");
    if (fixture.wrongRule) {
      expect(turn.governingRule?.text).toBe("Count a caption when the desk accepts it.");
      return { conditionEvidence: "unsupported" };
    }
    expect(turn.governingRule?.text).toContain("nonoverlapping queues");
    const user = turn.witnessSpans.find(span => fixture.answered
      ? span.source === "submitted_answer_1" && span.text === "No caption occurs in both queues."
      : complete ? span.text === "No caption occurs in both queues." : span.text.startsWith("We have not checked whether any caption occurs"));
    if (!user) throw new Error("The condition review omitted the expected evidence.");
    if (field === "conditionEvidence") return { conditionEvidence: complete ? "established" : "occurrence_unverified" };
    return { conditionWitness: user.id };
  }
  if (field === "reasonLanguage") return { reasonLanguage: "en" };
  if (field === "conditionQuestion") {
    expect(turn.question).toBe(fixture.distinctQuestion
      ? "Should the count follow the original caption date or the date checked?" : lateGapQuestion.question);
    expect(turn.condition?.text).toBe("No caption occurs in both queues.");
    return { conditionQuestion: fixture.distinctQuestion ? "other_or_uncertain" : "same_established_condition" };
  }
  if (field === "occurrenceQuestionProof") {
    expect(turn.currentWitness?.text).toContain("have not checked whether");
    expect(turn.questionCandidates).toEqual([{ id: "q1", question: lateGapGroundedQuestion }]);
    return { occurrenceQuestionProof: fixture.rejectedQuestion ? "hold" : "q1" };
  }
  if (field === "occurrenceAnswerProof") {
    expect(turn.currentWitness).toMatchObject({ text: "No caption occurs in both queues.", answeredQuestion: lateGapGroundedQuestion });
    expect(turn.question).toBe(lateGapGroundedQuestion);
    expect(turn.polarity).toBe("absent");
    expect(turn.methodExcerpt).toContain("Ask for identity and overlap rules if a caption can occur twice.");
    expect(turn.governingRule?.text).toContain("nonoverlapping queues");
    return { occurrenceAnswerProof: "verified" };
  }
  if (field === "questionEffect") {
    const evidence = turn.prerequisiteToCheck;
    if (!evidence) throw new Error("The clarification review omitted the expected evidence.");
    expect(turn.question).toBe(lateGapQuestion.question);
    return { questionEffect: "determined_by_current_scope", conditionSpanId: evidence.condition.id, ruleSpanId: evidence.rule.id, reasonLanguage: "en" };
  }
  if (turn.outcomeAdmissionPolicy) {
    return choices("run.propose_outcome", { outcomeProposal: { outcome: "structural_model", evidenceQuote: prompt } });
  }
  if (turn.observation.skillResolution?.outcome === "selected") {
    // This fixture checks selection and clarification before any tree edit.
    await new Promise<never>((_resolve, reject) => {
      const abort = () => reject(new AppleTransportError("cancelled"));
      if (request.signal?.aborted) abort();
      else request.signal?.addEventListener("abort", abort, { once: true });
    });
  }
  if (available.includes("skill.list")) return choices("skill.list");
  if (available.includes("skill.search")) return choices("skill.search", { skillSearch: { rootKpi: "accepted captions" } });
  if (fixture.direct && available.includes("skill.select")) {
    return choices("skill.select", { skillSelection: { skillId: publishingId, reason: "Provisional publication fit despite unsettled overlap." } });
  }
  if (available.includes("skill.read")) {
    const read = turn.observation.skillResolution?.reads.map(({ skillId }) => skillId) ?? [];
    const first = fixture.direct ? publishingId : deskId;
    return choices("skill.read", { skillRead: { skillId: read.includes(first) ? (first === deskId ? publishingId : deskId) : first } });
  }
  if (available.includes("skill.report_gap")) return choices("skill.report_gap", { skillGap: { reason: lateGapReason } });
  expect(available).toEqual(["user.ask"]);
  return choices("user.ask", { focusedQuestion: fixture.distinctQuestion
    ? { question: "Should the count follow the original caption date or the date checked?", reason: "The reporting date changes the week." }
    : lateGapQuestion });
}



const oreDiscoveryBrief = "Build structure for monthly ore output. Measurements will come later.";
const conveyorFollowUp = "Does that conveyor carry only ore, or does it also carry waste?";
const compactBrief = "Build an editable structural VDT for mining production volume. Use effective working time and average productivity. Measurements will come later.";
const compactSkill = "mining.production_volume";
const compactFormula = "operating_hours * tonnes_per_hour";
const compactQuestion = "Should production volume count ore at loading or at the plant feed?";
const compactAnswer = "Count ore at loading. Use effective working time and average productivity at the loading boundary.";
const compactRepeatedQuestion = { question: "At which operation is ore counted?", reason: "The boundary determines the productivity input." };
const approvalRequest = "Build structure for monthly ore output. Approve the Skill method with me first.";
const gapScopeFacts = "Report monthly ore output at the stated counting boundary. Each qualifying delivery contributes once to the monthly output.";
const gapBoundaryAnswer = "Use the screening boundary. Report screened ore as the monthly output.";
const gapSteering = "Use the revised screening scope. Report screened ore only; each qualifying delivery contributes once at screening.";
const gapFollowUp = { question: "Does the model include material handled for rework?", reason: "Rework changes which operations belong in the calculation." };
const compactMethodExcerpt = "production_volume = effective_working_time * average_productivity";

function confirmCatalogQuestion(request: AppleCompletionRequest, spans: readonly ScopeSpan[], witnessText: string) {
  const witness = spans.find(({ text }) => text.includes(witnessText));
  expect(witness).toBeDefined();
  expect(request.schema.fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "scopeQuestionFit", shape: {
      kind: "choice", choices: expect.arrayContaining(["material_question", "hold"])
    } }),
    expect.objectContaining({ name: "scopeSpanId", shape: {
      kind: "choice", choices: expect.arrayContaining([witness!.id])
    } })
  ]));
  return { scopeQuestionFit: "material_question", scopeSpanId: witness!.id };
}

function compactConstructionResponse(turn: {
  originalBrief: { mode: string };
  revisionInstruction?: string;
  scopeAnalysis?: string;
  checkpoint?: { results?: { toolName?: string; status?: string; resultCode?: string; payload?: unknown }[] };
  observation: { skillResolution: { outcome?: string; reads?: { skillId: string }[]; catalogBrowsed?: boolean };
    selectedMethod?: { id: string; excerpt: string }; missingPlannedInputIds?: string[] };
  verifiedFinish?: { receiptId?: string };
  submittedUserAnswers?: { question: string; answer: string[] }[];
}, available: string[], guided: boolean): Record<string, unknown> {
  const { observation, verifiedFinish } = turn;
  if (verifiedFinish) {
    expect(verifiedFinish.receiptId).toBeTruthy();
    return { sessionState: "Verified structural completion.", text: "The editable tree has been saved. Two inputs remain unmeasured." };
  }
  expect(guided).toBe(true);
  if (!observation.skillResolution.outcome) {
    expect(available).not.toContain("vdt.create_draft");
    if (!observation.skillResolution.catalogBrowsed) return { sessionState: "Browse Skills.", tool: "skill.list" };
    if (available.includes("skill.search")) return {
      sessionState: "Find the applicable method.", tool: "skill.search",
      skillSearch: { rootKpi: "Mining production volume", businessContext: turn.submittedUserAnswers?.length
        ? compactAnswer
        : "Mine throughput and ore mined from effective working time and average productivity" }
    };
    if (!observation.skillResolution.reads?.some(read => read.skillId === compactSkill)) return {
      sessionState: "Read the method.", tool: "skill.read", skillRead: { skillId: compactSkill }
    };
    if (!turn.submittedUserAnswers?.length) return { sessionState: "Clarify the measurement boundary.", tool: "user.ask",
      focusedQuestion: { question: compactQuestion, reason: "The measurement boundary determines which operation the inputs describe." } };
    expect(turn.submittedUserAnswers).toEqual([{ question: compactQuestion, answer: [compactAnswer] }]);
    if (available.includes("user.ask")) return { sessionState: "Repeat the boundary question.", tool: "user.ask", focusedQuestion: compactRepeatedQuestion };
    return { sessionState: "Select the read method.", tool: "skill.select",
      skillSelection: { skillId: compactSkill, reason: "It models mining production as time multiplied by productivity." } };
  }

  expect(turn.submittedUserAnswers).toEqual([{ question: compactQuestion, answer: [compactAnswer] }]);
  expect(observation.selectedMethod).toMatchObject({ id: compactSkill, excerpt: expect.stringContaining(compactMethodExcerpt) });
  const tool = available[0];
  expect(available.length).toBeLessThanOrEqual(3);
  switch (tool) {
    case "vdt.create_draft":
      return { sessionState: "Create the root.", tool, draft: { projectTitle: "Mining production", rootKpi: "Mining production volume", unit: "t", timePeriod: "month" } };
    case "vdt.set_decomposition_plan":
      return { sessionState: "Plan two editable inputs.", tool, plan: { goal: "Calculate production volume", nodes: [
        { nodeId: "operating_hours" }, { nodeId: "tonnes_per_hour" },
        ...(turn.originalBrief.mode === "generate_vdt" && !turn.scopeAnalysis ? [{ nodeId: "reported_output" }] : [])
      ] } };
    case "vdt.add_drivers_batch":
      expect(observation.missingPlannedInputIds).toEqual(["operating_hours", "tonnes_per_hour"]);
      return { sessionState: "Add the unmeasured inputs.", tool, drivers: [
        { nodeId: "operating_hours", name: "Effective working time", unit: "h" },
        { nodeId: "tonnes_per_hour", name: "Average productivity", unit: "t/h" }
      ] };
    case "vdt.set_formula": {
      if (turn.originalBrief.mode !== "continue_project") {
        return { sessionState: "Set the method's expression.", tool, formula: compactFormula };
      }
      const previousFormula = turn.checkpoint?.results?.find(result => result.toolName === tool);
      if (!previousFormula) {
        expect(available).toEqual(["vdt.set_formula", "user.ask"]);
        return { sessionState: "Set the expression.", tool, formula: `${compactFormula} because both contribute` };
      }
      expect(available).toEqual(["vdt.set_formula"]);
      expect(previousFormula).toMatchObject({
        status: "failed", resultCode: "FORMULA_PARSE_ERROR",
        payload: { error: { code: "FORMULA_PARSE_ERROR", message: "Unexpected token after formula expression." } }
      });
      return { sessionState: "Correct the expression syntax.", tool, formula: compactFormula };
    }
    default:
      throw new Error(`Unexpected compact structural frontier: ${available.join(", ")}`);
  }
}
const port: AppleNativePort = {
  async discover(locale) {
    if (locale !== currentCapability.locale) throw new AppleTransportError("unsupported_locale");
    return currentCapability;
  },
  async complete(request, validate) {
    requests.push(request);
    let raw;
    const workbookTurn = JSON.parse(request.prompt.startsWith("{") ? request.prompt : "{}");
    if (request.schema.fields[0]?.name === "measurementBoundary" && workbookTurn.configuredContext !== undefined) {
      // These fixtures exercise the ordinary route after the early method review abstains.
      raw = { measurementBoundary: "not_established" };
    } else if (lateGapFixture && (["boundaryMatch", "countingRuleFirst", "countingRuleSecond", "boundaryWitness", "proposedBoundaryAudit", "boundaryAudit", "prerequisiteRule"].includes(request.schema.fields[0]?.name ?? "") || workbookTurn.originalBrief?.prompt === lateGapFixture.prompt
      || workbookTurn.userSources?.originalRequest === lateGapFixture.prompt || workbookTurn.reason === lateGapReason)) {
      raw = await lateGapResponse(request, workbookTurn, lateGapFixture);
    } else if (request.schema.fields[0]?.name === "delivery" && Object.values(workbookTurn.quoteChoices ?? {}).includes(workbookPrompt)) {
      expect(omitWorkbookBeforeAssessment).not.toBe(false);
      raw = { delivery: "saved_workbook",
        evidenceQuoteId: Object.entries(workbookTurn.quoteChoices).find(([, value]) => value === workbookPrompt)![0] };
      await afterWorkbookAssessment?.();
    } else if (workbookTurn.originalBrief?.prompt === workbookPrompt) {
      const { quoteChoices, boundWorkbook, verifiedFinish, checkpoint } = workbookTurn;
      if (verifiedFinish) {
        raw = { sessionState: "Workbook verified", text: omitWorkbookBeforeAssessment === "direct_workbook_and_summary"
          ? `The requested workbook is ready. ${workbookSummary}` : "The requested workbook is ready." };
      } else if (boundWorkbook) {
        expect(boundWorkbook).toMatchObject({ scenarioId: "old_recovery", scenarioName: "Recovery", revisionId: (omitWorkbookBeforeAssessment ? omitWorkbookBeforeAssessment + "_" : "") + "workbook_rev_2" });
        expect(workbookTurn.tools.map(({ name }: { name: string }) => name)).not.toContain("version.edit");
        const exported = checkpoint?.results?.some(({ toolName, status }: { toolName?: string; status?: string }) => toolName === "export.excel" && status === "succeeded");
        if (exported && (omitWorkbookBeforeAssessment === "named_scope_corrected" || omitWorkbookBeforeAssessment === "named_scope_finish_head_after" || omitWorkbookBeforeAssessment === "direct_workbook_and_summary")) {
          ++workbookFinishOffer;
          const eligible = workbookTurn.tools.map(({ name }: { name: string }) => name);
          expect(eligible).toEqual(expect.arrayContaining(["project.get_current", "scenario.list", "user.ask", "run.request_finish"]));
          expect(eligible).not.toContain("export.excel");
          expect(JSON.stringify(request.schema)).not.toContain("export.excel");
          expect(() => validate({ sessionState: "Repeat download", action: { tool: "export.excel" } })).toThrow();
          expect(() => validate({ sessionState: "Try an edit", action: { tool: "version.edit", argumentsJson: "{}" } })).toThrow();
          await afterWorkbookFinishOffer?.();
        }
        const projectRead = checkpoint?.results?.some(({ toolName, status }: { toolName?: string; status?: string }) =>
          toolName === "project.get_current" && status === "succeeded");
        if (exported && omitWorkbookBeforeAssessment === "direct_workbook_and_summary") {
          raw = { sessionState: "Read the model before summarizing.", action: { tool: "project.get_current", argumentsJson: "{}" } };
        } else if (projectRead && omitWorkbookBeforeAssessment === "direct_workbook_and_summary") {
          raw = { sessionState: "The workbook and requested read are complete.", action: { tool: "run.request_finish" } };
        } else if (exported && missingExportProof()) {
          expect(workbookTurn.tools.map(({ name }: { name: string }) => name)).toContain("export.excel");
          expect(JSON.stringify(request.schema)).toContain('"export.excel"');
          raw = { sessionState: "Check workbook delivery.", action: { tool: "user.ask", argumentsJson: JSON.stringify({
            questions: [{ id: "delivery", question: "Should I retry the workbook delivery?", reason: "The completed delivery could not be verified.",
              required: true, expectedAnswerType: "text" }]
          }) } };
        } else raw = { sessionState: "Deliver the archived workbook", action: {
          tool: exported ? "run.request_finish" : "export.excel"
        } };
      } else if (omitWorkbookBeforeAssessment === "direct_workbook_and_summary") {
        raw = { sessionState: "Deliver the workbook and summarize the current model.", action: { tool: "run.propose_outcome",
          workbookProposal: { outcome: "answer", evidenceQuote: workbookPrompt,
            artifact: { kind: "excel_workbook", scenarioName: "Recovery", versionName: "LINE CHECK" } }
        } };
      } else if (testingNamedScopeRecovery() && workbookTurn.revisionInstruction?.startsWith("The prior read-only workbook")) {
        ++namedScopeCorrections;
        const schema = JSON.stringify(request.schema);
        expect(schema).toContain('"name":"scenarioName","shape":{"kind":"choice","choices":["Recovery"]}');
        expect(schema).toContain('"name":"versionName","shape":{"kind":"choice","choices":["Line check"]}');
        expect(schema).not.toContain('"name":"revisionId"');
        raw = { sessionState: "Use the exact saved scope.", action: { tool: "run.propose_outcome", workbookProposal: {
          outcome: "answer", evidenceQuoteId: Object.keys(quoteChoices)[0],
          artifact: { kind: "excel_workbook", scenarioName: "Recovery", versionName: "Line check" }
        } } };
        if (omitWorkbookBeforeAssessment === "named_scope_head_after") await afterWorkbookCorrection?.();
      } else if (testingNamedScopeRecovery() && workbookTurn.revisionInstruction?.startsWith("The exact saved workbook scope could not")) {
        ++namedScopeCorrections;
        expect(JSON.stringify(request.schema)).not.toContain("workbookProposal");
        raw = { sessionState: "The saved scope needs confirmation.", action: { tool: "user.ask",
          focusedQuestion: { question: "Which saved scenario and version should I use?", reason: "The saved scope is unresolved." } } };
      } else {
        const explicit = testingExplicitWorkbook();
        const canOfferExplicit = explicit && omitWorkbookBeforeAssessment !== "explicit_missing"
          && omitWorkbookBeforeAssessment !== "explicit_head_before" && omitWorkbookBeforeAssessment !== "explicit_instruction_before";
        const artifact = { kind: "excel_workbook", scenarioName: "Recovery", ...(explicit
          ? { revisionId: explicitWorkbookRevision } : { versionName: "LINE CHECK" }) };
        if (testingNamedScopeRecovery()) artifact.scenarioName = "Recovery from the saved version";
        const exactId = quoteChoices && Object.entries(quoteChoices).find(([, value]) => value === workbookPrompt)?.[0];
        if (quoteChoices) expect(exactId).toBeTruthy();
        const repairingOrdinaryQuote = workbookTurn.revisionInstruction?.startsWith("The previous quotation was unverified.");
        if (omitWorkbookBeforeAssessment && exactId && !repairingOrdinaryQuote) {
          const revisionField = JSON.stringify(request.schema).includes('"name":"revisionId"');
          expect(revisionField).toBe(canOfferExplicit);
          if (revisionField) expect(JSON.stringify(request.schema)).toContain(`"choices":["${explicitWorkbookRevision}"]`);
        }
        if (repairingOrdinaryQuote) {
          raw = { sessionState: "Identify the deliverable from exact evidence.", action: { tool: "run.propose_outcome",
            outcomeProposal: { outcome: omitWorkbookBeforeAssessment === "answer" ? "answer" : "structural_model", evidenceQuoteId: exactId }
          } };
        } else if (omitWorkbookBeforeAssessment && !exactId) {
          const attempt = ++ordinaryWorkbookProposals;
          const exact = omitWorkbookBeforeAssessment === "structural_direct" || explicit;
          const evidenceQuote = exact ? workbookPrompt : attempt === 1
            ? workbookPrompt.replace(/[“”]/g, '"') : "A different inexact quotation";
          raw = { sessionState: "Identify the deliverable", action: { tool: "run.propose_outcome", outcomeProposal: {
            outcome: exact && omitWorkbookBeforeAssessment === "answer" ? "answer" : "structural_model", evidenceQuote
          } } };
        } else {
          raw = explicit && !canOfferExplicit
            ? { sessionState: "The saved scope needs confirmation.", action: { tool: "user.ask",
              focusedQuestion: { question: "Which saved revision should I use?", reason: "The requested ID could not be verified." } } }
            : { sessionState: "Identify the deliverable", action: { tool: "run.propose_outcome", workbookProposal: {
              outcome: "answer", artifact, ...(exactId ? { evidenceQuoteId: exactId } : { evidenceQuote: "An inexact quotation" })
            } } };
          if (!testingNamedScopeRecovery() || omitWorkbookBeforeAssessment === "named_scope_head_before") await afterWorkbookCorrection?.();
        }
      }
    } else if (request.prompt.includes("exactly three distinct chat prompts")) {
      raw = { prompts: ["What drives production volume?", "How is downtime counted?", "Which inputs need more data?"] };
    } else if (request.prompt.includes("Respond in en-US")) {
      if (smartOutput instanceof AppleTransportError) throw smartOutput;
      raw = smartOutput;
    } else if (request.schema.fields[0]?.name === "outcome") {
      const review = JSON.parse(request.prompt);
      expect([compactBrief, approvalRequest]).toContain(review.originalBrief.prompt);
      raw = { outcome: "structural_model" };
    } else if (request.schema.fields[0]?.name === "focusedScopeAudit") {
      const audit = JSON.parse(request.prompt);
      expect(audit.userSources.originalRequest).toBe(oreDiscoveryBrief);
      expect(audit.question).toBe("Which measurement boundary should this model use?");
      raw = { focusedScopeAudit: "material_unknown" };
    } else if (["measurementBoundary", "prerequisiteStatus", "focusedScopeQuestion"].includes(request.schema.fields[0]?.name ?? "")) {
      const proof = JSON.parse(request.prompt);
      const brief = proof.userSources.originalRequest;
      expect([compactBrief, oreDiscoveryBrief]).toContain(brief);
      expect(proof.method.skillId).toBe(compactSkill);
      const field = request.schema.fields[0]?.name;
      if (field === "measurementBoundary") {
        const user = proof.witnessSpans.find(({ text }: { text: string }) => text.includes(brief === compactBrief ? "mining production volume" : "monthly ore output"));
        const method = proof.method.spans.find(({ text }: { text: string }) => text.includes("production_volume = effective_working_time * average_productivity"));
        raw = { measurementBoundary: "matches", userBoundarySpanId: user.id, methodBoundarySpanId: method.id };
      } else if (field === "prerequisiteStatus") {
        const user = proof.witnessSpans.find(({ source, text }: { source: string; text: string }) => brief === compactBrief
          ? source === "submitted_answer_1" && text === compactAnswer : source === "original_request");
        const method = proof.ruleSpans.find(({ text }: { text: string }) => text.includes(compactMethodExcerpt));
        const hold = holdSkillFit;
        holdSkillFit = undefined;
        await hold?.();
        raw = { prerequisiteStatus: brief === compactBrief ? "established" : "needs_user_fact", conditionSpanId: user.id, ruleSpanId: method.id,
          governingRelationship: "Working time and productivity must reflect the boundary used to measure ore output.",
          ...(brief === compactBrief ? { conditionFact: user.text, reasonLanguage: "en" } : {}) };
      } else {
        const evidence = proof.missingConditionToCheck;
        raw = { focusedScopeQuestion: "Which measurement boundary should this model use?", conditionSpanId: evidence.condition.id,
          ruleSpanId: evidence.rule.id, reasonLanguage: "en" };
      }
    } else if (request.schema.fields[0]?.name === "fit") {
      const review = JSON.parse(request.prompt);
      expect(review.originalBrief.prompt).toBe(compactBrief);
      expect(review.submittedUserAnswers).toEqual([{ question: compactQuestion, answer: [compactAnswer] }]);
      expect(review.proposedMethod).toMatchObject({ skillId: compactSkill, readReceiptId: expect.any(String),
        version: expect.any(Number), contentHash: expect.any(String) });
      const span = review.proposedMethod.spans.find(({ text }: { text: string }) => text.includes(compactMethodExcerpt));
      expect(span).toBeDefined();
      const hold = holdSkillFit;
      holdSkillFit = undefined;
      await hold?.();
      raw = { fit: "proposed_method_matches", conclusion: "The selected method derives output from working time and productivity.",
        methodSpanId: span.id, scopeSpanId: review.scopeSpans.find(({ source }: { source: string }) => source === "submitted_answer_1").id,
        reasonLanguage: "en" };
    } else if (request.schema.fields[0]?.name === "planFit") {
      const review = JSON.parse(request.prompt);
      expect(review.originalBrief.prompt).toBe(compactBrief);
      expect(review.submittedUserAnswers).toEqual([{ question: compactQuestion, answer: [compactAnswer] }]);
      expect(review.selectedMethod).toEqual({ skillId: compactSkill, readReceiptId: expect.any(String), excerpt: expect.stringContaining(compactMethodExcerpt) });
      const ids = review.plan.nodes.map(({ nodeId }: { nodeId: string }) => nodeId);
      expect(ids.slice(0, 2)).toEqual(["operating_hours", "tonnes_per_hour"]);
      raw = ids.includes("reported_output")
        ? { planFit: "needs_revision", conclusion: "Reported output is the derived result, not a distinct input. Remove reported_output from the proposed operands." }
        : { planFit: "matches_scope", conclusion: "Working time and productivity are the distinct direct measurements." };
    } else if (request.schema.fields[0]?.name === "scopeQuestionFit") {
      const { userSources, scopeSpans, draft } = workbookTurn;
      if (userSources.originalRequest === compactBrief) {
        expect(userSources.submittedUserAnswers).toEqual([]);
        expect(draft).toEqual({ question: compactQuestion,
          reason: "The measurement boundary determines which operation the inputs describe." });
        raw = confirmCatalogQuestion(request, scopeSpans, "mining production volume");
      } else if (userSources.originalRequest === oreDiscoveryBrief) {
        expect(userSources.submittedUserAnswers).toEqual([{
          question: "Which measurement boundary should this model use?", answer: ["At the conveyor."]
        }]);
        expect(draft).toEqual({ question: conveyorFollowUp,
          reason: "The material mix determines whether the measured flow needs an ore-only factor." });
        raw = confirmCatalogQuestion(request, scopeSpans, "At the conveyor.");
      } else {
        expect(userSources.originalRequest).toMatch(/^Controlled no-match (changed|mixed) scope/);
        expect(userSources.originalRequest).toContain("at the stated counting boundary");
        expect(userSources.submittedUserAnswers).toEqual([]);
        expect(draft).toEqual({ question: "Which boundary applies?", reason: "The method depends on it." });
        raw = confirmCatalogQuestion(request, scopeSpans, "at the stated counting boundary");
      }
    } else if (request.schema.fields[0]?.name === "plausibleCard") {
      const { cards, sourceSpans } = workbookTurn;
      const aliases = (cards as { choice: string }[]).map(({ choice }) => choice);
      expect(aliases.length).toBeGreaterThan(0);
      expect(request.schema.fields).toEqual([{ name: "plausibleCard", shape: {
        kind: "choice", choices: [...aliases, "no_plausible_card"]
      } }]);
      if (sourceSpans.some(({ text }: { text: string }) => text === "At the conveyor.")) {
        expect(sourceSpans).toContainEqual(expect.objectContaining({ sourceIndex: 0, text: "At the conveyor." }));
        expect(sourceSpans).toContainEqual(expect.objectContaining({ sourceIndex: 1, text: "Build structure for monthly ore output." }));
      } else {
        expect(sourceSpans).toEqual(expect.arrayContaining([expect.objectContaining({
          text: expect.stringMatching(/each qualifying delivery/i), relationship: true
        })]));
        expect(sourceSpans).toEqual(expect.arrayContaining([expect.objectContaining({
          text: expect.stringMatching(/report (?:monthly ore|screened ore)|screening (?:runs|boundary)|sequential stages/i)
        })]));
      }
      raw = { plausibleCard: "no_plausible_card" };
    } else if (request.schema.fields[0]?.name === "gapFit") {
      const review = JSON.parse(request.prompt);
      const spans = review.sourceSpans as { id: string; sourceIndex: number; start: number; end: number; text: string; relationship: boolean }[];
      expect(review.cards).toHaveLength(12);
      expect(review.reason).toBe("The reviewed methods do not cover the supplied boundary.");
      const scope = spans.find(span => span.sourceIndex === 0 && /report (?:monthly ore|screened ore)|screening (?:runs|boundary)|sequential stages/i.test(span.text));
      expect(scope).toBeDefined();
      const relationship = spans.find(span => span.relationship && /each qualifying delivery/i.test(span.text)
        && (span.sourceIndex !== scope!.sourceIndex || span.start >= scope!.end || span.end <= scope!.start));
      expect(relationship).toBeDefined();
      raw = { gapFit: "no_fit_with_resolved_scope", scopeSpanId: scope!.id, relationshipSpanId: relationship!.id };
    } else if (request.schema.fields.some(({ name }) => name === "readiness")) {
      const review = JSON.parse(request.prompt);
      const initialGapReview = request.schema.fields.some(({ name }) => name === "scopeSpanId");
      const catalogIds = review.catalogCards?.map(({ id }: { id: string }) => id);
      const gapBusinessSpans = review.gapBusinessSpans as { id: string; relationship: boolean }[] | undefined;
      const gapAnchorPairs = review.gapAnchorPairs as { id: string }[] | undefined;
      expect(request.schema.fields).toEqual([
        expect.objectContaining({ name: "conclusion", shape: { kind: "string" } }),
        expect.objectContaining({ name: "readiness", shape: { kind: "choice", choices: review.proposedQuestion
          ? ["continue_with_current_evidence", "distinct_material_gap"] : ["method_ready", "material_scope_missing"] } }),
        ...(initialGapReview ? [expect.objectContaining({ name: "scopeSpanId", optional: true })] : []),
        ...(catalogIds ? [expect.objectContaining({ name: "catalogFit", optional: true,
          shape: { kind: "choice", choices: ["no_applicable_skill", "uncertain", ...catalogIds] } })] : []),
        ...(gapAnchorPairs ? [expect.objectContaining({ name: "gapPairId", optional: true,
          shape: { kind: "choice", choices: gapAnchorPairs.map(({ id }) => id) } })] : gapBusinessSpans ? [
          expect.objectContaining({ name: "gapOutputSpanId", optional: true,
            shape: { kind: "choice", choices: gapBusinessSpans.map(({ id }) => id) } }),
          expect.objectContaining({ name: "gapRelationshipSpanId", optional: true,
            shape: { kind: "choice", choices: gapBusinessSpans.filter(({ relationship }) => relationship).map(({ id }) => id) } })
        ] : [])
      ]);
      const gapReview = review.proposedQuestion?.question === gapFollowUp.question;
      expect(review.readMethods).toEqual(gapReview || initialGapReview ? [] : expect.arrayContaining([
        expect.objectContaining({ skillId: expect.any(String), excerpt: expect.any(String) })
      ]));
      if (initialGapReview) {
        expect(review.originalBrief.prompt).toMatch(/Controlled no-match (changed|mixed) scope/);
        if (review.originalBrief.prompt.startsWith("Controlled no-match changed scope")) {
          expect(catalogIds).toContain("mining.load_and_haul");
        }
        expect(review.proposedQuestion).toEqual({ question: "Which boundary applies?", reason: "The method depends on it." });
        expect(review.submittedUserAnswers).toEqual([]);
        raw = { conclusion: "The request has no confirmed boundary that can guide construction.", readiness: "distinct_material_gap" };
      } else if (gapReview) {
        expect(review.originalBrief.prompt).toMatch(/Controlled no-match (changed|mixed) scope/);
        expect(review.proposedQuestion).toEqual(gapFollowUp);
        expect(review.submittedUserAnswers).toEqual([{ question: "Which boundary applies?", answer: [gapBoundaryAnswer] }]);
        raw = { conclusion: "The screening boundary is settled. The scope of any reworked material is a separate question.", readiness: "distinct_material_gap" };
      } else if (review.originalBrief.prompt === compactBrief) {
        expect(review.proposedQuestion).toEqual(compactRepeatedQuestion);
        expect(review.submittedUserAnswers).toEqual([{ question: compactQuestion, answer: [compactAnswer] }]);
        raw = { conclusion: "The loading boundary is explicitly confirmed.", readiness: "continue_with_current_evidence" };
      } else if (review.originalBrief.prompt === oreDiscoveryBrief) {
        if (review.submittedUserAnswers.length) {
          expect(review.proposedQuestion?.question).toBe(conveyorFollowUp);
          expect(review.submittedUserAnswers).toEqual([{
            question: "Which measurement boundary should this model use?", answer: ["At the conveyor."]
          }]);
        }
        raw = {
          conclusion: review.submittedUserAnswers.length
            ? "The conveyor is the measurement boundary. Whether it also carries waste affects the choice of an ore-only factor."
            : "The brief leaves the measurement boundary unresolved.",
          readiness: review.proposedQuestion ? "distinct_material_gap" : "material_scope_missing"
        };
      } else {
        expect(review.originalBrief.prompt).toContain("Approve the Skill method");
        expect(review.submittedUserAnswers).toEqual([]);
        raw = { conclusion: "The monthly ore production structure is ready for explicit method approval.", readiness: "method_ready" };
      }
    } else {
      const turn = JSON.parse(request.prompt);
      const available: string[] = turn.tools?.map((tool: { name: string }) => tool.name) ?? [];
      const guided = request.schema.fields.some(({ name }) => name === "action");
      const discovery = guided && !turn.outcomeAdmissionPolicy && !turn.observation.skillResolution?.outcome;
      if (discovery) expect(request.schema.fields.map(({ name }) => name)).not.toContain("argumentsJson");
      const approvalBrief = turn.originalBrief.prompt === approvalRequest;
      const gapFixture = /Controlled no-match (empty|reviewed|changed|steered|mixed) scope/.exec(turn.originalBrief.prompt)?.[1];
      if (approvalBrief && turn.outcomeAdmissionPolicy) {
        if (turn.revisionInstruction) expect(turn.methodConfirmationPolicy).toContain("confirmSkillMethod to true");
        raw = { sessionState: "Classify the outcome with method confirmation.", tool: "run.propose_outcome", outcomeProposal: {
          outcome: turn.revisionInstruction ? "structural_model" : "answer", evidenceQuote: approvalRequest, confirmSkillMethod: true
        } };
      } else if (turn.originalBrief.prompt === compactBrief && turn.outcomeAdmissionPolicy) {
        raw = { sessionState: "Classify the requested deliverable.", tool: "run.propose_outcome", outcomeProposal: {
          outcome: turn.revisionInstruction ? "structural_model" : "answer", evidenceQuote: compactBrief
        } };
      } else if (turn.originalBrief.prompt === compactBrief) {
        raw = compactConstructionResponse(turn, available, guided);
      } else if (gapFixture && turn.observation.skillResolution?.catalogBrowsed) {
        const skills = turn.observation.skillResolution;
        if (available.includes("skill.search")) {
          expect(available).not.toContain("skill.report_gap");
          expect(available).not.toContain("user.ask");
          raw = { sessionState: "I searched the scope.", tool: "skill.search", skillSearch: gapFixture === "reviewed"
            ? { rootKpi: "Blasted tonnes", businessContext: "Drilling and blasting" }
            : { rootKpi: "xyzzqv pzqxv" } };
        } else if (gapFixture === "reviewed" && !skills.reads.length) {
          expect(available).not.toContain("skill.report_gap");
          expect(available).not.toContain("user.ask");
          raw = { sessionState: "I reviewed the candidate.", tool: "skill.read", skillRead: { skillId: skills.candidateIds[0] } };
        } else if (["changed", "mixed"].includes(gapFixture) && turn.sessionState === "I searched the scope." && !turn.observation.confirmedUserAnswers.length) {
          expect(available).toContain("skill.report_gap");
          raw = { sessionState: "The user should clarify the boundary.", tool: "user.ask",
            focusedQuestion: { question: "Which boundary applies?", reason: "The method depends on it." } };
        } else {
          expect(available).toContain("skill.report_gap");
          if (gapFixture === "reviewed") expect(available).not.toContain("skill.read");
          if (gapFixture === "empty") expect(available).toContain("skill.read");
          const hold = holdFirstGapProposal;
          holdFirstGapProposal = undefined;
          if (hold) await hold();
          raw = { sessionState: "No reviewed method fits.", tool: "skill.report_gap",
            skillGap: { reason: "The reviewed methods do not cover the supplied boundary." } };
        }
      } else if (gapFixture && turn.observation.skillResolution?.outcome === "no_applicable_skill") {
        expect(available).toContain("user.ask");
        const { question, reason } = gapFollowUp;
        raw = { sessionState: "Pause before construction.", tool: "user.ask", ...(guided
          ? { focusedQuestion: { question, reason } }
          : { argumentsJson: JSON.stringify({ questions: [{ id: "next", question, reason, required: true, expectedAnswerType: "text" }] }) }) };
      } else if (turn.outcomeAdmissionPolicy) {
        expect(request.schema.fields.map(({ name }) => name)).not.toContain("argumentsJson");
        raw = turn.checkpoint
          ? { sessionState: "I need to check scope.", tool: "user.ask",
            focusedQuestion: { question: "Which deliverable would you like?", reason: "The deliverable determines the next step." } }
          : { sessionState: "The brief requests an editable structure.", tool: "run.propose_outcome",
            outcomeProposal: { outcome: "structural_model", evidenceQuote: "Build structure for monthly ore output." } };
      } else if (available.includes("skill.list") && !turn.observation.skillResolution.catalogBrowsed) {
        expect(available).toEqual(["skill.list"]);
        raw = { sessionState: "I will inspect available Skills.", tool: "skill.list",
          focusedQuestion: { question: "Are the stages in series?", reason: "That changes the method." } };
      } else if (available.includes("skill.search")) {
        const refined = Boolean(turn.submittedUserAnswers?.length);
        if (refined) expect(available).not.toContain("skill.read");
        else expect(available).toContain("skill.read");
        if (!turn.observation.skillResolution.reads.length) expect(available).not.toContain("user.ask");
        raw = { sessionState: refined ? "I have ranked the refined scope." : "I will rank candidate Skills.", tool: "skill.search",
          skillSearch: { rootKpi: "Ore output", businessContext: refined ? "Measured at the conveyor" : "Production volume" } };
      } else if (turn.sessionState === "I will rank candidate Skills." && !turn.observation.skillResolution.reads.length) {
        expect(available).not.toContain("user.ask");
        expect(available).not.toContain("skill.select");
        expect(available).not.toContain("vdt.create_draft");
        raw = { sessionState: "I will read the candidate.", tool: "skill.read", skillRead: {
          skillId: turn.observation.skillResolution.candidateIds[0]
        } };
      } else if (turn.originalBrief.prompt === oreDiscoveryBrief && available.includes("skill.select") && !turn.submittedUserAnswers?.length) {
        raw = { sessionState: "Propose the reviewed method.", tool: "skill.select", skillSelection: {
          skillId: turn.observation.skillResolution.reads[0].skillId, reason: "The method covers monthly ore production."
        } };
      } else if (approvalBrief && available.includes("skill.select")) {
        const scope = turn.observation.skillResolution;
        const unread = turn.sessionState === "I will read the candidate.";
        raw = { sessionState: unread ? "Check the unread candidate boundary." : "Propose the exact read Skill.", tool: "skill.select",
          skillSelection: { skillId: unread ? scope.candidateIds[0] : scope.reads.at(-1).skillId,
            reason: "It matches the monthly ore production scope." } };
      } else {
        expect(available).not.toContain("skill.search");
        if (!approvalBrief) expect(available).not.toContain("vdt.create_draft");
        const hasConveyorBoundary = turn.submittedUserAnswers?.some(({ answer }: { answer: string[] }) => answer.includes("At the conveyor."));
        const question = hasConveyorBoundary ? conveyorFollowUp : "Which measurement boundary should this model use?";
        const reason = hasConveyorBoundary ? "The material mix determines whether the measured flow needs an ore-only factor." : "The boundary changes the drivers.";
        if (discovery) {
          expect(available).toContain("user.ask");
          expect(turn.instruction).toContain("Leave deferred measurements blank.");
          if (turn.scopeAnalysis) {
            expect(available).toEqual(["user.ask"]);
            expect(turn.scopeAnalysis).toBe("The brief leaves the measurement boundary unresolved.");
          } else {
            expect(turn.instruction).toContain("Do not ask for deferred values or estimates");
          }
        }
        raw = { sessionState: "I need a scope detail.", tool: "user.ask", ...(guided
          ? { focusedQuestion: { question, reason } }
          : { argumentsJson: JSON.stringify({ questions: [{ id: "scope", question, reason, required: true, expectedAnswerType: "text" }] }) }) };
      }
      if (guided) {
        const { sessionState, ...action } = raw;
        raw = { sessionState, action };
      }
    }
    try {
      return { value: validate(raw), context: { contextSize: 8192, inputTokens: 840, reservedOutputTokens: request.maxOutputTokens } };
    } catch { throw new AppleTransportError("invalid_output"); }
  }
};

function json(path: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("native provider via normal agent and bounded Smart routes", { timeout: 25_000 }, () => {
  let bindings: typeof import("../bindings/apple/route");
  let runs: typeof import("./route");
  let supervisor: typeof import("./supervisor-runtime");
  let runtime: typeof import("./runtime");
  let messages: typeof import("./[runId]/messages/route");
  let smart: typeof import("../../ai/suggestions/route");
  let bounded: typeof import("../../ai/run-task/route");
  const ambient = vi.fn();

  beforeAll(async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    vi.stubGlobal("fetch", ambient);
    vi.spyOn(await import("./apple-native-host"), "packagedAppleNativePort").mockReturnValue(port);
    [bindings, runs, supervisor, runtime, messages, smart, bounded] = await Promise.all([
      import("../bindings/apple/route"), import("./route"), import("./supervisor-runtime"),
      import("./runtime"), import("./[runId]/messages/route"), import("../../ai/suggestions/route"), import("../../ai/run-task/route")
    ]);
  });

  it.each(workbookCases)("checks the archived workbook and revision slot authority (omission=%s)", async omitted => {
    const { openVdtDatabase } = await import("@vdt-studio/storage");
    const { GET: download } = await import("./[runId]/excel-workbook/route");
    const prefix = omitted ? omitted + "_" : "";
    const projectId = prefix + "apple_named_workbook_project", vdtId = prefix + "apple_named_workbook_vdt";
    omitWorkbookBeforeAssessment = omitted;
    ordinaryWorkbookProposals = 0;
    namedScopeCorrections = 0;
    workbookFinishOffer = 0;
    const explicit = testingExplicitWorkbook();
    explicitWorkbookRevision = explicit ? prefix + "workbook_rev_2" : undefined;
    const unresolvedNamedPrompts: Partial<Record<typeof workbookCases[number] & string, string>> = {
      direct_workbook_and_summary: namedWorkbookPrompt + " Also summarize the current model.",
      named_scope_ambiguous: namedWorkbookPrompt.replace("Recovery", "Recovery or Baseline"),
      named_scope_unknown: "Export an Excel workbook for scenario Ghost from saved version “LINE CHECK”. Recovery is irrelevant.",
      named_scope_descriptive: "Export an Excel workbook from saved version “LINE CHECK”. Recovery is irrelevant."
    };
    workbookPrompt = explicit ? `Export an Excel workbook for Recovery from revision ${explicitWorkbookRevision}.`
      : (omitted && unresolvedNamedPrompts[omitted]) || namedWorkbookPrompt;
    const database = openVdtDatabase(process.cwd(), { dataDir });
    let restoreArtifactProjection: (() => void) | undefined;
    if (missingExportProof()) {
      const { SqliteVdtDatabase } = await import("@vdt-studio/storage");
      const originalGetRun = SqliteVdtDatabase.prototype.getAgentRun;
      const projection = vi.spyOn(SqliteVdtDatabase.prototype, "getAgentRun").mockImplementation(function (this: InstanceType<typeof SqliteVdtDatabase>, id) {
        const saved = originalGetRun.call(this, id);
        if (!saved?.publicSnapshot || !Array.isArray(saved.publicSnapshot.artifacts)) return saved;
        const artifacts = omitWorkbookBeforeAssessment === "named_scope_missing_export_proof" ? []
          : saved.publicSnapshot.artifacts.map(entry => entry.type === "excel_workbook"
            ? { ...entry, payload: { ...entry.payload, revisionId: "unrelated_revision" } } : entry);
        return { ...saved, publicSnapshot: { ...saved.publicSnapshot, artifacts } };
      });
      restoreArtifactProjection = () => projection.mockRestore();
    }
    try {
      const original = structuredClone(productionVolumeProject);
      const baseline = original.scenarios[0]!;
      original.scenarios = [baseline, { ...baseline, id: "old_recovery", name: "Recovery", isMain: false }];
      const named = createVersionSnapshot(original, { name: "Line check" }, { id: "version_line_check", createdAt: "2026-11-24T09:00:00.000Z" });
      const head = structuredClone(named);
      head.scenarios[1]!.id = "new_recovery";
      head.graph.nodes.find(node => node.type === "input")!.baselineValue = 1234;
      database.createProject({ id: projectId, name: "Historical workbook" });
      database.createVdt({ id: vdtId, projectId, name: "Historical workbook", rootKpi: "Production Volume" });
      const save = (no: number, project: typeof head, parentRevisionId?: string) => database.saveVdtRevision({
        id: prefix + "workbook_rev_" + no, vdtId, projectId, revisionNo: no, source: "user", project, parentRevisionId
      });
      const initial = save(1, original);
      const old = save(2, named, initial.id);
      const current = save(3, head, old.id);
      const storedHead = database.getVdtRevisionHead(vdtId)!;
      const generation = database.getProjectRuntimeState(projectId)!;
      const expectedRevision = {
        expectedActiveRevisionId: storedHead.activeRevisionId, expectedActiveContentIdentity: storedHead.activeContentIdentity,
        expectedCommitGeneration: storedHead.commitGeneration, expectedRuntimeGeneration: generation.runtimeGeneration,
        expectedGenerationVersion: generation.generationVersion
      };
      const workspace = { projectId, vdtId, ...((explicit && omitted !== "explicit_missing" || testingNamedScopeRecovery() || omitted === "direct_workbook_and_summary") ? { expectedRevision } : {}) };
      const { readExactNamedWorkbookScope, readExplicitWorkbookRevisionIds } = await import("./outcome-admission");
      if (omitted === "named_scope_corrected") {
        const sqlite = () => Object.fromEntries(readdirSync(dataDir).filter(name => /^(?:app\.sqlite|app\.sqlite-wal)$/u.test(name))
          .map(name => [name, readFileSync(join(dataDir, name))]));
        const before = sqlite();
        const { createLazySqliteAgentRunPersistence } = await import("./persistence");
        const databaseFactory = vi.fn(() => database);
        expect(createLazySqliteAgentRunPersistence(process.cwd(), { databaseFactory })
          .readNamedWorkbookScope("absent_run", workspace, workbookPrompt)).toBeUndefined();
        expect(databaseFactory).not.toHaveBeenCalled();
        expect(readExactNamedWorkbookScope(database, workspace, workbookPrompt)).toEqual({ scenarioName: "Recovery", versionName: "Line check" });
        expect(readExactNamedWorkbookScope(database, { projectId, vdtId }, workbookPrompt)).toBeUndefined();
        expect(readExactNamedWorkbookScope(database, { ...workspace, expectedRevision: { ...expectedRevision,
          expectedCommitGeneration: expectedRevision.expectedCommitGeneration + 1 } }, workbookPrompt)).toBeUndefined();
        for (const unresolved of [
          "Export an Excel workbook from saved version “LINE CHECK”.",
          "Export an Excel workbook for “LINE CHECK” from saved version “LINE CHECK”.",
          "Export an Excel workbook for Recovery from saved version “LINE CHECK” or version “OTHER”.",
          "Export an Excel workbook for Recovery from the current head or saved version “LINE CHECK”.",
          "Export an Excel workbook for Recovery or Baseline from saved version “LINE CHECK”."
        ]) expect(readExactNamedWorkbookScope(database, workspace, unresolved)).toBeUndefined();
        expect(sqlite()).toEqual(before);
        expect(database.getVdtRevisionHead(vdtId)).toEqual(storedHead);
        expect(database.listVdtRevisions(vdtId)).toHaveLength(3);
      }
      if (omitted === "explicit_id") {
        expect(readExplicitWorkbookRevisionIds({ projectId, vdtId }, workbookPrompt)).toEqual([]);
        expect(readExplicitWorkbookRevisionIds({ ...workspace, expectedRevision: { ...expectedRevision,
          expectedCommitGeneration: expectedRevision.expectedCommitGeneration + 1 } }, workbookPrompt)).toEqual([]);
        expect(readExplicitWorkbookRevisionIds(workspace, workbookPrompt)).toEqual([old.id]);
        expect(readExplicitWorkbookRevisionIds(workspace, `Export an Excel workbook for Recovery from REVISION ${old.id}.`))
          .toEqual([old.id]);
        expect(readExplicitWorkbookRevisionIds(workspace,
          `Export an Excel workbook for Recovery from revision ${old.id.toUpperCase()}. Do not use ${old.id}.`)).toEqual([]);
      }
      let resolveRegisteredRun: ((id: string) => void) | undefined;
      const registeredRun = new Promise<string>(resolve => { resolveRegisteredRun = resolve; });
      let racedHead: string | undefined;
      const replaceHead = async () => {
        const newer = structuredClone(head);
        newer.name += " (newer revision)";
        racedHead = save(4, newer, current.id).id;
      };
      const replaceInstruction = async () => {
        runtime.agentRuntime.store.appendChatMessage(await registeredRun, { kind: "instruction", role: "user",
          text: "Stop that export. I need a description of the current model." });
      };
      if (omitted === "explicit_head_before") afterWorkbookAssessment = replaceHead;
      if (omitted === "explicit_instruction_before") afterWorkbookAssessment = replaceInstruction;
      if (omitted === "explicit_head_after" || omitted === "named_scope_head_before" || omitted === "named_scope_head_after") afterWorkbookCorrection = replaceHead;
      if (omitted === "explicit_instruction_after") afterWorkbookCorrection = replaceInstruction;
      if (omitted === "named_scope_finish_head_after") afterWorkbookFinishOffer = replaceHead;
      const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
      const response = await runs.POST(json("/api/agent/runs", {
        mode: "continue_project", outcomeSelection: "automatic", executionBindingId: binding.bindingId,
        expectedExecution: expectation, workspace,
        input: { prompt: workbookPrompt, activeScenarioId: baseline.id }, options: { researchMode: "off", autoApplyPatches: false }
      }));
      expect(response.status).toBe(200);
      ({ runId } = await response.json());
      resolveRegisteredRun?.(runId!);
      if (omitted === "named_scope_finish_head_after") {
        await vi.waitFor(() => {
          const state = runtime.agentRuntime.store.getSnapshot(runId!);
          expect(["failed", "recovery_required"]).toContain(state.status);
          expect(state.events.some(event => event.message?.includes("APPLE_GUIDED_ACTION_HOST_EVIDENCE"))).toBe(true);
          expect(state.finishOutcome).toBeUndefined();
        }, { timeout: 8000 });
        expect(workbookFinishOffer).toBe(1);
        expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(racedHead);
        expect(database.listVdtRevisions(vdtId)).toHaveLength(4);
        return;
      }
      if (missingExportProof()) {
        await vi.waitFor(() => {
          const state = runtime.agentRuntime.store.getSnapshot(runId!);
          expect(state.status).toBe("needs_user_input");
          expect(state.pendingQuestions?.[0]?.id).toBe("delivery");
          expect(state.events.filter(event => event.metadata?.toolName === "export.excel" && event.metadata.ok === true)).toHaveLength(1);
          expect(state.finishOutcome).toBeUndefined();
        }, { timeout: 8000 });
        expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(current.id);
        expect(database.listVdtRevisions(vdtId)).toHaveLength(3);
        return;
      }
      if (testingNamedScopeRecovery() && omitted !== "named_scope_corrected") {
        await vi.waitFor(() => {
          const state = runtime.agentRuntime.store.getSnapshot(runId!);
          if (omitted === "named_scope_head_after") expect(["failed", "recovery_required"]).toContain(state.status);
          else expect(state.status).toBe("needs_user_input");
          expect(state.request.artifactIntent).toBeUndefined();
          expect(state.artifacts ?? []).toHaveLength(0);
          expect(state.events.filter(event => event.metadata?.code === "OUTCOME_ARTIFACT_SCOPE_UNRESOLVED")
            .map(event => event.message)).toEqual(["Ask which exact saved scenario the user wants to export."]);
        }, { timeout: 8000 });
        expect(namedScopeCorrections).toBe(1);
        expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(racedHead ?? current.id);
        expect(database.listVdtRevisions(vdtId)).toHaveLength(racedHead ? 4 : 3);
        return;
      }
      if (explicit && omitted !== "explicit_id") {
        const blockedAfterCorrection = omitted === "explicit_head_after" || omitted === "explicit_instruction_after";
        await vi.waitFor(() => {
          const state = runtime.agentRuntime.store.getSnapshot(runId!);
          if (blockedAfterCorrection) {
            expect(["failed", "recovery_required"]).toContain(state.status);
            expect(state.events.some(event => event.message?.includes("APPLE_OUTCOME_WORKBOOK_CORRECTION_HOST_EVIDENCE"))).toBe(true);
          } else expect(state.status).toBe("needs_user_input");
          expect(state.request.artifactIntent).toBeUndefined();
          expect(state.artifacts ?? []).toHaveLength(0);
        }, { timeout: 8000 });
        expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(racedHead ?? current.id);
        expect(database.listVdtRevisions(vdtId)).toHaveLength(racedHead ? 4 : 3);
        return;
      }
      await vi.waitFor(() => expect(runtime.agentRuntime.store.getSnapshot(runId!).status,
        JSON.stringify(runtime.agentRuntime.store.getState(runId!).events.slice(-3))).toBe("succeeded"), { timeout: 8000 });
      const snapshot = runtime.agentRuntime.store.getSnapshot(runId!);
      expect(snapshot.request.artifactIntent).toEqual({ kind: "excel_workbook", revisionId: old.id,
        scenarioId: "old_recovery", scenarioName: "Recovery" });
      expect(snapshot.artifacts).toHaveLength(1);
      if (omitted === "named_scope_corrected" || omitted === "direct_workbook_and_summary") {
        expect(workbookFinishOffer).toBe(1);
        expect(snapshot.events.filter(event => event.metadata?.toolName === "export.excel" && event.metadata.ok === true)).toHaveLength(1);
        expect(snapshot.finishOutcome?.state).toBe("final_persisted");
      }
      if (testingNamedScopeRecovery()) {
        expect(namedScopeCorrections).toBe(1);
        expect(snapshot.events.filter(event => event.metadata?.code === "OUTCOME_ARTIFACT_SCOPE_UNRESOLVED")
          .map(event => event.message)).toEqual(["Ask which exact saved scenario the user wants to export."]);
      }
      if (omitted === "direct_workbook_and_summary") {
        expect(snapshot.events.filter(event => event.type === "tool_call_completed"
          && event.metadata?.resultCode === "OK").map(event => event.metadata?.externalCallId)).toHaveLength(3);
        expect(snapshot.events.find(event => event.type === "tool_call_completed"
          && event.metadata?.toolName === "project.get_current" && event.metadata.ok === true)).toBeDefined();
        expect(snapshot.finalReport).toContain(workbookSummary);
      }
      const quoteFailures = snapshot.events.filter(event =>
        event.metadata?.code === "OUTCOME_QUOTE_UNVERIFIED");
      expect(quoteFailures).toHaveLength(omitted === "structural_direct" || omitted === "explicit_id" || omitted === "direct_workbook_and_summary" ? 0 : 1);
      const { downloadUrl } = snapshot.artifacts![0]!.payload as { downloadUrl: string };
      const artifact = await download(new Request(new URL(downloadUrl, "http://localhost:3000")),
        { params: Promise.resolve({ runId: runId! }) });
      expect(artifact.status).toBe(200);
      const downloaded = new Uint8Array(await artifact.arrayBuffer());
      expect(downloaded).toEqual(exportProjectExcel(database.readVdtRevision(old), { scenarioId: "old_recovery" }));
      expect(downloaded).not.toEqual(exportProjectExcel(database.readVdtRevision(current), { scenarioId: "new_recovery" }));
      expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(current.id);
      expect(database.listVdtRevisions(vdtId)).toHaveLength(3);
    } finally {
      omitWorkbookBeforeAssessment = false;
      workbookPrompt = namedWorkbookPrompt;
      explicitWorkbookRevision = undefined;
      afterWorkbookAssessment = undefined;
      afterWorkbookCorrection = undefined;
      afterWorkbookFinishOffer = undefined;
      restoreArtifactProjection?.();
      database.close();
    }
  });

  it("keeps an unverified Automatic quote unbound and offers a focused question without writing", async () => {
    const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
    const response = await runs.POST(json("/api/agent/runs", {
      mode: "generate_vdt", outcomeSelection: "automatic", executionBindingId: binding.bindingId,
      expectedExecution: expectation, input: { prompt: "Please help with this dashboard.", rootKpi: "Dashboard" },
      options: { researchMode: "off" }
    }));
    expect(response.status).toBe(200);
    ({ runId } = await response.json());
    await vi.waitFor(() => expect(runtime.agentRuntime.store.getSnapshot(runId!).status).toBe("needs_user_input"));
    const state = runtime.agentRuntime.store.getState(runId!);
    expect(state.request.outcome).toBeUndefined();
    expect(state.builder?.getRevision()).toBe(0);
    expect(state.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool_call_completed", metadata: expect.objectContaining({
        toolName: "run.propose_outcome", ok: false, code: "OUTCOME_QUOTE_UNVERIFIED"
      }) })
    ]));
    expect(state.pendingQuestions?.[0]?.question).toBe("Which deliverable would you like?");
    await supervisor.cancelStructuredModelAgentRun(runId!, true);
    runId = undefined;
  });

  afterEach(async () => {
    lateGapFixture = undefined;
    if (runId && supervisor?.isStructuredModelAgentRunActive(runId)) {
      const ownedRunId = runId;
      await supervisor.cancelStructuredModelAgentRun(ownedRunId, true);
      await vi.waitFor(() => expect(supervisor.isStructuredModelAgentRunActive(ownedRunId)).toBe(false));
    }
    runId = undefined;
  });

  afterAll(async () => {
    if (runId && supervisor?.isStructuredModelAgentRunActive(runId)) {
      await supervisor.cancelStructuredModelAgentRun(runId, true);
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("admits exact locale and runs Skill discovery through the real Supervisor Gateway", async () => {
    const russian = await bindings.POST(json("/api/agent/bindings/apple", { locale: "ru-RU" }));
    expect(russian.status).toBe(409);
    expect(await russian.json()).toMatchObject({ code: "unsupported_locale" });
    const admitted = await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }));
    expect(admitted.status).toBe(200);
    const { binding } = await admitted.json();
    expect(binding).toMatchObject({ admission: { mode: "local", modelRevision: null, research: false }, appleIdentity: { locale: "en-US" } });
    const startRequests = requests.length;
    const created = await runs.POST(json("/api/agent/runs", {
      mode: "generate_vdt", outcomeSelection: "automatic", executionBindingId: binding.bindingId,
      expectedExecution: expectation, input: { prompt: oreDiscoveryBrief, rootKpi: "Ore output" },
      options: { researchMode: "off" }
    }));
    expect(created.status).toBe(200);
    ({ runId } = await created.json());
    for (let attempts = 0; attempts < 80; attempts++) {
      if (runtime.agentRuntime.store.getSnapshot(runId!).status === "needs_user_input") break;
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    const snapshot = runtime.agentRuntime.store.getSnapshot(runId!);
    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.events.filter(event => event.type === "tool_call_completed")
      .flatMap(event => event.metadata?.toolName ? [event.metadata.toolName] : []))
      .toEqual(["run.propose_outcome", "skill.list", "skill.search", "skill.read", "user.ask"]);
    expect(runtime.agentRuntime.store.getState(runId!).request.outcome).toBe("structural_model");
    expect(snapshot.selectedSkills).toEqual([]);
    expect(snapshot.pendingQuestions?.[0]).toMatchObject({ id: "skill_scope", question: "Which measurement boundary should this model use?" });
    expect(runtime.agentRuntime.store.getState(runId!).builder?.getRevision()).toBe(0);
    expect(requests.slice(startRequests).filter(request => request.schema.fields[0]?.name === "focusedScopeQuestion")).toHaveLength(1);
    const beforeAnswer = requests.length;
    const answered = await messages.POST(json(`/api/agent/runs/${runId}/messages`, {
      type: "user_answer", answers: { skill_scope: "At the conveyor." }, expectedExecutionMode: "local"
    }), { params: Promise.resolve({ runId: runId! }) });
    expect(answered.status).toBe(200);
    await vi.waitFor(() => {
      const refined = runtime.agentRuntime.store.getSnapshot(runId!);
      expect(refined.status, JSON.stringify(refined.events.slice(-4))).toBe("needs_user_input");
      expect(refined.pendingQuestions?.[0]?.question).toBe(conveyorFollowUp);
      expect(refined.events.filter(event => event.type === "tool_call_completed")
        .flatMap(event => event.metadata?.toolName ? [event.metadata.toolName] : []))
        .toEqual(["run.propose_outcome", "skill.list", "skill.search", "skill.read", "user.ask", "skill.search", "user.ask"]);
    });
    expect(requests.slice(beforeAnswer).filter(request => request.schema.fields[0]?.name === "plausibleCard")).toHaveLength(1);
    expect(requests.slice(beforeAnswer).filter(request => request.schema.fields.some(({ name }) => name === "readiness"))).toHaveLength(1);
    const before = requests.length;
    currentCapability = { ...capability, identity: { ...capability.identity, osBuild: "different fixture build" } };
    const resumed = await messages.POST(json(`/api/agent/runs/${runId}/messages`, {
      type: "user_answer", answers: { skill_scope: "At the conveyor." }, expectedExecutionMode: "local"
    }), { params: Promise.resolve({ runId: runId! }) });
    expect(resumed.status).toBe(409);
    expect(await resumed.json()).toMatchObject({ error: { code: "stale_identity" } });
    expect(requests).toHaveLength(before);
    expect(ambient).not.toHaveBeenCalled();
    currentCapability = capability;
    await supervisor.cancelStructuredModelAgentRun(runId!, true);
    runId = undefined;
  });

  it("records nine initial Apple invalid-output failures without retaining controllers or changing the graph", async () => {
    const { POST: cancel } = await import("./[runId]/cancel/route");
    const { GET: getRun } = await import("./[runId]/route");
    const { openVdtDatabase } = await import("@vdt-studio/storage");
    const { createStorageWriteActor } = await import("../../vdt/storage-write-adapter");
    const database = openVdtDatabase(process.cwd(), { dataDir });
    const projectId = "apple_initial_failure_project", vdtId = "apple_initial_failure_vdt";
    const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
    const request = () => json("/api/agent/runs", {
      mode: "continue_project", outcomeSelection: "automatic", executionBindingId: binding.bindingId,
      expectedExecution: expectation, workspace: { projectId, vdtId }, input: {
        project: productionVolumeProject, rootKpi: "Production volume", prompt: "Build structure for monthly ore output."
      },
      options: { researchMode: "off" }
    });
    const nativeTurn = port.complete.bind(port);
    const rawModelContent = "Private generated fixture output.";
    const invalidOutput = new AppleTransportError("invalid_output");
    invalidOutput.message = rawModelContent;
    const diagnostic = "The native Apple model returned invalid output. [APPLE_OUTCOME_ACTION_UNCLASSIFIED]";
    const mockTurn = vi.spyOn(port, "complete").mockRejectedValue(invalidOutput);
    const runIds = new Set<string>();
    try {
      database.createProject({ id: projectId, name: productionVolumeProject.name });
      const runtimeState = database.getProjectRuntimeState(projectId)!;
      const seeded = database.createVdtWithInitialSnapshot({
        actor: createStorageWriteActor(projectId, { env: { VDT_APP_MODE: "development_web" } }),
        command: {
          schemaVersion: "create_vdt_with_initial_snapshot.v1", projectId,
          expectedRuntimeGeneration: runtimeState.runtimeGeneration, expectedGenerationVersion: runtimeState.generationVersion,
          idempotencyKey: "seed-apple-initial-failure", vdt: { requestedVdtId: vdtId, name: productionVolumeProject.name,
            rootKpi: "Production volume", unit: null, timePeriod: null, status: "draft", metadata: null },
          revisionIntent: { source: "user", summary: "Seed the saved graph", validation: null, calculation: null }
        }, project: productionVolumeProject
      });
      const savedHead = database.getVdtRevisionHead(vdtId);
      expect(savedHead?.activeRevisionId).toBe(seeded.revision.id);
      for (let attempt = 0; attempt < 9; attempt++) {
        const created = await runs.POST(request());
        expect(created.status).toBe(200);
        const { runId: id } = await created.json() as { runId: string };
        runIds.add(id);
        const uri = `/api/agent/runs/${id}`;
        const params = { params: Promise.resolve({ runId: id }) };
        await vi.waitFor(() => {
          expect(runtime.agentRuntime.store.getSnapshot(id)).toMatchObject({
            status: "failed", error: { code: "invalid_output", message: diagnostic }
          });
          expect(supervisor.isStructuredModelAgentRunActive(id)).toBe(false);
        });
        const terminal = await getRun(new Request(`http://localhost:3000${uri}`), params);
        expect(await terminal.json()).toMatchObject({ snapshot: { runId: id, status: "failed" } });
        const events = await supervisor.getPersistedSupervisorEvents(id);
        const errors = events.filter(event => event.type === "error");
        expect(errors).toMatchObject([{ payload: { code: "invalid_output", message: diagnostic, retryable: false } }]);
        expect(JSON.stringify(errors)).not.toContain(rawModelContent);
        expect(JSON.stringify(errors)).not.toContain("Build structure for monthly ore output.");
        expect(events).not.toContainEqual(expect.objectContaining({ type: "tool_call" }));
        expect(runtime.agentRuntime.store.getState(id).builder?.getProject()).toEqual(productionVolumeProject);
        if (attempt === 8) for (let replay = 0; replay < 2; replay++) {
          const receipt = await cancel(json(`${uri}/cancel`, { awaitTerminal: true }), params);
          expect(receipt.status).toBe(200);
          expect(await receipt.json()).toMatchObject({ status: "failed", terminalCleanupConfirmed: true });
        }
      }
      expect(runIds.size).toBe(9);
      expect(mockTurn).toHaveBeenCalledTimes(9);

      // An explicit new run gets a fresh initial turn. An identical transport
      // error after a real Gateway dispatch still requires ordinary recovery.
      mockTurn.mockImplementationOnce(nativeTurn);
      const retry = await runs.POST(request());
      expect(retry.status).toBe(200);
      const { runId: retriedId } = await retry.json() as { runId: string };
      expect(runIds.has(retriedId)).toBe(false);
      await vi.waitFor(() => {
        const snapshot = runtime.agentRuntime.store.getSnapshot(retriedId);
        expect(snapshot.status).toBe("recovery_required");
        expect(snapshot.events).toContainEqual(expect.objectContaining({
          type: "tool_call_completed", metadata: expect.objectContaining({ toolName: "run.propose_outcome" })
        }));
        expect(supervisor.isStructuredModelAgentRunActive(retriedId)).toBe(false);
      });
      expect(mockTurn).toHaveBeenCalledTimes(11);
      expect(database.getVdtRevisionHead(vdtId)).toEqual(savedHead);
      expect(database.readVdtRevision(database.getVdtRevision(seeded.revision.id)!)).toEqual(productionVolumeProject);
      expect(ambient).not.toHaveBeenCalled();
    } finally {
      mockTurn.mockRestore();
      database.close();
    }
  });

  it("retains method confirmation across outcome correction and binds only an approved, read Skill", async () => {
    const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
    const response = await runs.POST(json("/api/agent/runs", {
      mode: "generate_vdt", outcomeSelection: "automatic", executionBindingId: binding.bindingId,
      expectedExecution: expectation, input: { prompt: approvalRequest,
        rootKpi: "Ore output", unit: "t", timePeriod: "month" }, options: { researchMode: "off" }
    }));
    expect(response.status).toBe(200);
    ({ runId } = await response.json());
    await vi.waitFor(() => {
      expect(runtime.agentRuntime.store.getSnapshot(runId!).status).toBe("needs_user_input");
      expect(runtime.agentRuntime.store.getState(runId!).request.skillResolution?.pendingMethod).toBeDefined();
    });
    const pending = runtime.agentRuntime.store.getState(runId!);
    expect(pending.request.outcome).toBe("structural_model");
    expect(pending.request.skillResolution?.confirmationRequired).toBe(true);
    expect(pending.selectedSkills).toEqual([]);
    expect(pending.builder?.getRevision()).toBe(0);
    expect(pending.builder?.getProject().graph.nodes).toEqual([]);
    expect(pending.events).toEqual(expect.arrayContaining([expect.objectContaining({
      type: "tool_call_completed", metadata: expect.objectContaining({ toolName: "skill.select", ok: false, code: "SKILL_READ_REQUIRED" })
    })]));
    const method = pending.request.skillResolution!.pendingMethod!;
    const approved = await messages.POST(json(`/api/agent/runs/${runId}/messages`, {
      type: "user_answer", structuredAnswers: [{ questionId: method.questionId, selectedOptionIds: ["accept_method"] }],
      expectedExecutionMode: "local"
    }), { params: Promise.resolve({ runId: runId! }) });
    expect(approved.status).toBe(200);
    await vi.waitFor(() => {
      const after = runtime.agentRuntime.store.getState(runId!);
      expect(after.selectedSkills[0]).toMatchObject({ id: method.skillId, reason: "It matches the monthly ore production scope." });
      expect(after.events).toEqual(expect.arrayContaining([expect.objectContaining({
        type: "skill_selected", metadata: expect.objectContaining({ readReceiptId: method.readReceiptId })
      })]));
      expect(after.builder?.getRevision()).toBe(pending.builder?.getRevision());
    });
    await supervisor.cancelStructuredModelAgentRun(runId!, true);
    runId = undefined;
  });

  it.each(["generate_vdt", "continue_project"] as const)("saves and reopens the Apple compact structural tree (%s)", async mode => {
    const rootKpi = "Mining production volume";
    const projectId = "compact_existing_project";
    const vdtId = "compact_existing_vdt";
    const reopen = await import("../../vdt/vdts/[vdtId]/route");
    const loadVdt = (id: string) => reopen.GET(new Request(`http://localhost:3000/api/vdt/vdts/${id}`), {
      params: Promise.resolve({ vdtId: id })
    });
    let existing: { activeProject: ReturnType<VdtBuilderSession["getProject"]>; activeRevision: { id: string } } | undefined;
    if (mode === "continue_project") {
      const projects = await import("../../vdt/projects/route");
      const vdts = await import("../../vdt/projects/[projectId]/vdts/route");
      const createdProject = await projects.POST(json("/api/vdt/projects", { id: projectId, name: "Existing mining workspace" }));
      expect(createdProject.status).toBe(201);
      const { summary: { runtimeState } } = await createdProject.json();
      const builder = new VdtBuilderSession();
      builder.createDraft({ projectTitle: "Existing mining tree", rootKpi, unit: "t", timePeriod: "month" });
      const createdVdt = await vdts.POST(json(`/api/vdt/projects/${projectId}/vdts`, {
        schemaVersion: "create_vdt_with_initial_http_request.v1",
        idempotencyKey: "seed-compact-existing-vdt",
        expectedRuntime: { schemaVersion: "project_runtime_cas.v1", runtimeGeneration: runtimeState.runtimeGeneration, generationVersion: runtimeState.generationVersion },
        vdt: { requestedVdtId: vdtId, name: "Existing mining tree", rootKpi, unit: "t", timePeriod: "month", status: "draft", metadata: null },
        project: builder.getProject()
      }), { params: Promise.resolve({ projectId }) });
      expect(createdVdt.status, await createdVdt.text()).toBe(201);
      const opened = await loadVdt(vdtId);
      expect(opened.status).toBe(200);
      existing = await opened.json();
      expect(existing?.activeProject.graph.nodes).toHaveLength(1);
    }
    const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
    const response = await runs.POST(json("/api/agent/runs", {
      mode, ...(mode === "generate_vdt" ? { outcomeSelection: "automatic" } : { outcome: "structural_model" }),
      executionBindingId: binding.bindingId, expectedExecution: expectation,
      ...(existing ? { workspace: { projectId, vdtId } } : {}),
      input: { prompt: compactBrief, rootKpi, unit: "t", timePeriod: "month", ...(existing ? { project: existing.activeProject } : {}) },
      options: { autoApplyPatches: true, researchMode: "off", ...(existing ? { enforceDerivedRoot: true } : {}) }
    }));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    runId = body.runId;
    const projectRunId = runId!;
    await vi.waitFor(() => {
      const state = runtime.agentRuntime.store.getState(projectRunId);
      expect(state.status, JSON.stringify(state.events.slice(-5))).toBe("needs_user_input");
      expect(state.pendingQuestions?.[0]).toMatchObject({ id: "skill_scope", question: compactQuestion });
    });
    const beforeAnswer = runtime.agentRuntime.store.getState(projectRunId);
    expect(beforeAnswer.request.outcome).toBe("structural_model");
    expect(beforeAnswer.selectedSkills).toEqual([]);
    expect(beforeAnswer.request.skillResolution?.outcome).toBeUndefined();
    expect(beforeAnswer.builder?.getRevision()).toBe(0);
    expect(beforeAnswer.builder?.getProject().graph.nodes).toEqual(existing?.activeProject.graph.nodes ?? []);
    const read = beforeAnswer.events.find(event => event.type === "skill_read" && event.metadata?.id === compactSkill);
    expect(read?.metadata).toMatchObject({
      readReceiptId: expect.any(String), version: 3, contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
    });
    const resumeRequest = requests.length;
    const answered = await messages.POST(json(`/api/agent/runs/${projectRunId}/messages`, {
      type: "user_answer", structuredAnswers: [{ questionId: "skill_scope", fields: { answer: compactAnswer } }],
      expectedExecutionMode: "local"
    }), { params: Promise.resolve({ runId: projectRunId }) });
    expect(answered.status).toBe(200);
    await vi.waitFor(() => {
      const state = runtime.agentRuntime.store.getState(projectRunId);
      expect(state.status, JSON.stringify(state.events.slice(-5))).toBe("succeeded");
    }, { timeout: 10_000 });
    runId = undefined;

    const resumedTurns = requests.slice(resumeRequest).map(request => JSON.parse(request.prompt));
    expect(resumedTurns.some(turn => turn.tools?.some(({ name }: { name: string }) => name === "run.request_finish"))).toBe(false);
    expect(resumedTurns.filter(turn => turn.verifiedFinish)).toEqual([expect.objectContaining({
      verifiedFinish: expect.objectContaining({ receiptId: expect.any(String) }),
      checkpoint: expect.objectContaining({ results: [expect.objectContaining({
        toolName: "run.request_finish", status: "succeeded", resultCode: "FINISH_VERIFIED"
      })] })
    })]);
    expect(resumedTurns[0].tools.map(({ name }: { name: string }) => name)).toContain("skill.search");
    const afterSearch = resumedTurns[1];
    expect(afterSearch.tools.map(({ name }: { name: string }) => name)).not.toContain("skill.search");
    expect(afterSearch.submittedUserAnswers).toEqual([{ question: compactQuestion, answer: [compactAnswer] }]);
    expect(afterSearch.observation.readSkillMethods).toContainEqual({
      skillId: compactSkill, readReceiptId: read?.metadata?.readReceiptId, version: read?.metadata?.version,
      contentHash: read?.metadata?.contentHash, excerpt: expect.stringContaining(compactMethodExcerpt)
    });
    expect(resumedTurns.filter(turn => turn.proposedQuestion)).toEqual([expect.objectContaining({
      proposedQuestion: compactRepeatedQuestion, submittedUserAnswers: [{ question: compactQuestion, answer: [compactAnswer] }]
    })]);
    expect(resumedTurns.some(turn => turn.revisionInstruction && turn.tools?.map(({ name }: { name: string }) => name).includes("skill.select")
      && !turn.tools.some(({ name }: { name: string }) => name === "user.ask"))).toBe(true);
    expect(resumedTurns.filter(turn => turn.ruleSpans)).toEqual([expect.objectContaining({
      method: expect.objectContaining({ skillId: compactSkill, readReceiptId: read?.metadata?.readReceiptId })
    })]);
    expect(resumedTurns.filter(turn => turn.plan).map(turn => turn.plan.nodes.map(({ nodeId }: { nodeId: string }) => nodeId))).toEqual(existing
      ? [["operating_hours", "tonnes_per_hour"]]
      : [["operating_hours", "tonnes_per_hour", "reported_output"], ["operating_hours", "tonnes_per_hour"]]);

    const state = runtime.agentRuntime.store.getState(projectRunId);
    expect(state.chatMessages.filter(message => message.kind === "question").flatMap(message => message.kind === "question" ? message.questions : []))
      .toMatchObject([{ question: compactQuestion }]);
    expect(state.request.skillResolution?.outcome).toBe("selected");
    const reason = `This method fits the scope you specified: «${compactAnswer}»`;
    expect(state.selectedSkills).toMatchObject([{ id: compactSkill, reason }]);
    expect(state.events.filter(event => event.type === "skill_selected")).toMatchObject([{
      message: expect.stringContaining(reason),
      metadata: { reason, readReceiptId: read?.metadata?.readReceiptId }
    }]);
    const writes = ["vdt.create_draft", "vdt.set_decomposition_plan", "vdt.add_drivers_batch", "vdt.set_formula"];
    const formulaFailure = { toolName: "vdt.set_formula", ok: false, code: "FORMULA_PARSE_ERROR" };
    const attemptedWrites = state.events.filter(event => event.type === "tool_call_completed" && writes.includes(String(event.metadata?.toolName)));
    const expectedWrites = existing
      ? [{ toolName: "vdt.set_decomposition_plan", ok: true }, { toolName: "vdt.add_drivers_batch", ok: true },
        formulaFailure, { toolName: "vdt.set_formula", ok: true }]
      : writes.map(toolName => ({ toolName, ok: true }));
    expect(attemptedWrites.map(event => event.metadata)).toMatchObject(expectedWrites);
    if (existing) {
      const plan = resumedTurns.find(turn => turn.tools?.[0]?.name === "vdt.set_decomposition_plan");
      expect(plan?.observation.rootNodeId).toBe(existing.activeProject.rootNodeId);
      expect(plan?.submittedUserAnswers).toEqual([{ question: compactQuestion, answer: [compactAnswer] }]);
      const retry = resumedTurns.find(turn => turn.tools?.length === 1 && turn.tools[0].name === "vdt.set_formula");
      expect(retry?.instruction).toContain("formula parser diagnostic");
      expect(retry?.submittedUserAnswers).toEqual([{ question: compactQuestion, answer: [compactAnswer] }]);
      expect(retry?.checkpoint?.results).toContainEqual(expect.objectContaining({
        toolName: "vdt.set_formula", status: "failed", resultCode: "FORMULA_PARSE_ERROR"
      }));
    }

    const snapshot = await supervisor.compactSupervisorAwareSnapshot(runtime.agentRuntime.store.getSnapshot(projectRunId));
    expect(snapshot.finishOutcome).toMatchObject({ state: "final_persisted", outcome: "structural_model", missingInputCount: 2 });
    const { openAgentRunPersistenceDatabase } = await import("./persistence");
    const database = openAgentRunPersistenceDatabase(process.cwd());
    try {
      const stored = database.getAgentRun(projectRunId);
      expect(stored?.vdtId).toBeTruthy();
      if (existing) expect(stored).toMatchObject({ projectId, vdtId });
      const head = database.getVdtRevisionHead(stored!.vdtId!);
      expect(head?.activeRevisionId).toBeTruthy();
      const revision = database.getVdtRevision(head!.activeRevisionId!);
      expect(revision).toBeDefined();
      const project = database.readVdtRevision(revision!);
      const root = project.graph.nodes.find(node => node.id === project.rootNodeId);
      expect(root).toMatchObject({ name: rootKpi, unit: "t", formula: compactFormula });
      expect(root?.decompositionPlan).toEqual({
        version: 1, goal: "Calculate production volume",
        nodes: ["operating_hours", "tonnes_per_hour"].map(nodeId => ({
          nodeId, parentNodeId: project.rootNodeId, kind: "input"
        }))
      });
      if (existing) {
        expect(project.rootNodeId).toBe(existing.activeProject.rootNodeId);
        expect(revision!.id).not.toBe(existing.activeRevision.id);
        const reopened = await loadVdt(vdtId);
        expect(reopened.status).toBe(200);
        expect(await reopened.json()).toMatchObject({ activeRevision: { id: revision!.id }, activeProject: project });
      }
      expect(project.graph.edges.map(({ sourceNodeId, targetNodeId, relation }) => [sourceNodeId, targetNodeId, relation])).toEqual([
        [project.rootNodeId, "operating_hours", "formula_dependency"], [project.rootNodeId, "tonnes_per_hour", "formula_dependency"]
      ]);
      const inputs = project.graph.nodes.filter(node => node.id !== project.rootNodeId);
      expect(inputs.map(({ id, unit, valueStatus, value, baselineValue }) => [id, unit, valueStatus, value, baselineValue])).toEqual([
        ["operating_hours", "h", "unknown", undefined, undefined], ["tonnes_per_hour", "t/h", "unknown", undefined, undefined]
      ]);
    } finally {
      database.close();
    }
  });

  it.each(["empty", "reviewed", "changed"])("requires current successful scoped evidence for an Apple Skill gap (%s)", async kind => {
    const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
    const response = await runs.POST(json("/api/agent/runs", {
      mode: "generate_vdt", outcome: "structural_model", executionBindingId: binding.bindingId,
      expectedExecution: expectation, input: { prompt: `Controlled no-match ${kind} scope. ${gapScopeFacts} Leave measurements blank for now.`,
        rootKpi: "Ore output", unit: "t", timePeriod: "month" }, options: { researchMode: "off" }
    }));
    expect(response.status).toBe(200);
    ({ runId } = await response.json());
    if (kind === "changed") {
      await vi.waitFor(() => {
        const before = runtime.agentRuntime.store.getState(runId!);
        expect(before.status).toBe("needs_user_input");
        expect(before.request.skillResolution?.outcome).toBeUndefined();
        expect(before.pendingQuestions?.[0]?.id).toBe("skill_scope");
      });
      const answer = await messages.POST(json(`/api/agent/runs/${runId}/messages`, {
        type: "user_answer", answers: { skill_scope: gapBoundaryAnswer }, expectedExecutionMode: "local"
      }), { params: Promise.resolve({ runId: runId! }) });
      expect(answer.status).toBe(200);
    }
    await vi.waitFor(() => {
      const state = runtime.agentRuntime.store.getState(runId!);
      expect(state.status).toBe("needs_user_input");
      expect(state.request.skillResolution?.outcome).toBe("no_applicable_skill");
      const searches = state.events.filter(event => event.type === "skill_search" && event.metadata?.toolName === "skill.search");
      const reads = state.events.filter(event => event.type === "skill_read");
      expect(searches).toHaveLength(kind === "changed" ? 2 : 1);
      expect(reads).toHaveLength(kind === "reviewed" ? 1 : 0);
      expect(searches.at(-1)?.metadata?.candidateIds).toEqual(kind === "reviewed" ? ["mining.drill_and_blast"] : []);
      if (kind === "reviewed") expect(reads[0]?.metadata?.id).toBe("mining.drill_and_blast");
    });
    await supervisor.cancelStructuredModelAgentRun(runId!, true);
    runId = undefined;
  });

  it("rejects an in-flight reviewed Skill selection when newer steering is queued", async () => {
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    holdSkillFit = async () => { entered(); await held; };
    const requestStart = requests.length;
    const instruction = "Use the confirmed loading boundary. Keep the measurements blank.";
    try {
      const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
      const started = await runs.POST(json("/api/agent/runs", {
        mode: "generate_vdt", outcome: "structural_model", executionBindingId: binding.bindingId, expectedExecution: expectation,
        input: { prompt: compactBrief, rootKpi: "Mining production volume", unit: "t", timePeriod: "month" },
        options: { researchMode: "off", autoApplyPatches: true }
      }));
      expect(started.status).toBe(200);
      ({ runId } = await started.json());
      const args = { params: Promise.resolve({ runId: runId! }) };
      const endpoint = `/api/agent/runs/${runId}/messages`;
      await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(runId!).pendingQuestions?.[0]?.id).toBe("skill_scope"));
      const answer = await messages.POST(json(endpoint, {
        type: "user_answer", structuredAnswers: [{ questionId: "skill_scope", fields: { answer: compactAnswer } }], expectedExecutionMode: "local"
      }), args);
      expect(answer.status).toBe(200);
      await Promise.race([waiting, new Promise((_, reject) => setTimeout(() => reject(new Error("Expected held Skill assessment")), 6_000))]);
      const accepted = await messages.POST(json(endpoint, { type: "user_instruction", text: instruction, expectedExecutionMode: "local" }), args);
      expect(accepted.status).toBe(200);
      release();
      await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(runId!).status).toBe("succeeded"), { timeout: 10_000 });
      const state = runtime.agentRuntime.store.getState(runId!);
      expect(state.events.filter(event => event.type === "tool_call_completed" && event.metadata?.toolName === "skill.select")
        .map(event => [event.metadata?.ok, event.metadata?.code])).toEqual([[false, "APPLE_SKILL_SCOPE_CHANGED"], [true, undefined]]);
      expect(state.events.filter(event => event.type === "skill_selected")).toMatchObject([{ metadata: { id: compactSkill } }]);
      const reviews = requests.slice(requestStart).filter(request => request.schema.fields[0]?.name === "prerequisiteStatus").map(request => JSON.parse(request.prompt));
      expect(reviews.map(review => review.userSources.latestUserInstruction)).toEqual([undefined, instruction]);
      runId = undefined;
    } finally {
      release();
      holdSkillFit = undefined;
      if (runId) await supervisor.cancelStructuredModelAgentRun(runId, true);
      runId = undefined;
    }
  });

  it.each(["gap", "search"])("fences an in-flight old Apple %s proposal after a new user instruction", async heldTool => {
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const hold = async () => { entered(); await held; };
    let restoreSearch: (() => void) | undefined;
    if (heldTool === "gap") holdFirstGapProposal = hold;
    else {
      const tool = runtime.agentRuntime.tools.list().find(tool => tool.name === "skill.search")!;
      const original = tool.run.bind(tool);
      const mock = vi.spyOn(tool, "run").mockImplementationOnce(async (context, args) => {
        await hold();
        return original(context, args);
      });
      restoreSearch = () => mock.mockRestore();
    }
    try {
      const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
      const response = await runs.POST(json("/api/agent/runs", {
        mode: "generate_vdt", outcome: "structural_model", executionBindingId: binding.bindingId,
        expectedExecution: expectation, input: { prompt: `Controlled no-match steered scope. ${gapScopeFacts}`, rootKpi: "Ore output", unit: "t", timePeriod: "month" },
        options: { researchMode: "off" }
      }));
      expect(response.status).toBe(200);
      ({ runId } = await response.json());
      await Promise.race([waiting, new Promise((_, reject) => setTimeout(() => reject(new Error("Expected held Apple proposal")), 6_000))]);
      const instruction = await messages.POST(json(`/api/agent/runs/${runId}/messages`, {
        type: "user_instruction", text: gapSteering, expectedExecutionMode: "local"
      }), { params: Promise.resolve({ runId: runId! }) });
      expect(instruction.status).toBe(200);
      release();
      await vi.waitFor(() => {
        const state = runtime.agentRuntime.store.getState(runId!);
        expect(state.status).toBe("needs_user_input");
        expect(state.request.skillResolution?.outcome).toBe("no_applicable_skill");
        const receipts = state.events.filter(event => event.type === "tool_call_completed")
          .filter(event => ["skill.search", "skill.report_gap"].includes(String(event.metadata?.toolName)))
          .map(event => [event.metadata?.toolName, event.metadata?.ok, event.metadata?.code]);
        expect(receipts).toEqual([
          ["skill.search", true, undefined],
          ...(heldTool === "gap" ? [["skill.report_gap", false, "APPLE_SKILL_SCOPE_CHANGED"]] : []),
          ["skill.search", true, undefined],
          ["skill.report_gap", true, undefined]
        ]);
      }, { timeout: 5_000 });
    } finally {
      release();
      holdFirstGapProposal = undefined;
      restoreSearch?.();
      if (runId) await supervisor.cancelStructuredModelAgentRun(runId, true);
      runId = undefined;
    }
  });

  it.each([
    { input: "unitless stage count", answer: gapBoundaryAnswer, compact: true },
    { input: "supplied measurement", answer: "Screening runs at 120 t/h. Report screened ore as the monthly output.", compact: false },
    { input: "explicit digit", answer: "Use 2 consecutive review steps. Report screened ore as the monthly output.", compact: false },
    { input: "uncertain numeral", answer: "Screening runs at twenty five. Report screened ore as the monthly output.", compact: false }
  ])("refreshes mixed-checkpoint Skill evidence and chooses the construction guide for $input", async ({ answer, compact }) => {
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const steering = "Report monthly ore deliveries using two consecutive review steps.";
    // Hold the actual Gateway question so the next checkpoint receives the queued instruction with the answer.
    const ask = runtime.agentRuntime.tools.list().find(tool => tool.name === "user.ask")!;
    const original = ask.run.bind(ask);
    const askSpy = vi.spyOn(ask, "run").mockImplementationOnce(async (context, args) => {
      entered();
      await held;
      return original(context, args);
    });
    const requestCount = requests.length;
    try {
      const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
      const response = await runs.POST(json("/api/agent/runs", {
        mode: "generate_vdt", outcome: "structural_model", executionBindingId: binding.bindingId,
        expectedExecution: expectation, input: { prompt: `Controlled no-match mixed scope. Build two review steps. ${gapScopeFacts} Leave measurements blank.`,
          rootKpi: "Ore output", unit: "t/h", timePeriod: "month" },
        options: { researchMode: "off" }
      }));
      expect(response.status).toBe(200);
      ({ runId } = await response.json());
      await Promise.race([waiting, new Promise((_, reject) => setTimeout(() => reject(new Error("Expected held Apple question")), 6_000))]);
      const send = (body: object) => messages.POST(json(`/api/agent/runs/${runId}/messages`, { ...body, expectedExecutionMode: "local" }),
        { params: Promise.resolve({ runId: runId! }) });
      const queued = await send({ type: "user_instruction", text: steering });
      expect(queued.status).toBe(200);
      release();
      await vi.waitFor(() => {
        const state = runtime.agentRuntime.store.getState(runId!);
        expect(state.status).toBe("needs_user_input");
        expect(state.pendingQuestions?.[0]?.id).toBe("skill_scope");
      });
      const answered = await send({ type: "user_answer", answers: { skill_scope: answer } });
      expect(answered.status).toBe(200);
      await vi.waitFor(() => {
        const state = runtime.agentRuntime.store.getState(runId!);
        expect(state.status).toBe("needs_user_input");
        expect(state.request.skillResolution?.outcome).toBe("no_applicable_skill");
        expect(state.events.filter(event => event.type === "tool_call_completed")
          .flatMap(event => event.metadata?.toolName ? [event.metadata.toolName] : []))
          .toEqual(["skill.list", "skill.search", "user.ask", "skill.search", "skill.report_gap", "user.ask"]);
      });
      const turns = requests.slice(requestCount);
      expect(turns.map(request => JSON.parse(request.prompt).checkpoint)).toContainEqual(expect.objectContaining({
        type: "checkpoint_inputs",
        checkpointDelta: expect.objectContaining({ type: "human_input", input: expect.objectContaining({
          type: "user_answer", answers: { skill_scope: answer }
        }) }),
        inputs: [{ type: "user_instruction", text: steering }]
      }));
      const afterGap = turns.find(turn => JSON.parse(turn.prompt).observation?.skillResolution?.outcome === "no_applicable_skill");
      expect(afterGap?.schema.fields.map(field => field.name)).toEqual(compact
        ? ["sessionState", "action"] : ["sessionState", "tool", "argumentsJson"]);
    } finally {
      release();
      askSpy.mockRestore();
      if (runId) await supervisor.cancelStructuredModelAgentRun(runId, true);
      runId = undefined;
    }
  });

  it("uses the same owner for Smart with strict source identity, no fallback and canonical output", async () => {
    const admitted = await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }));
    const { binding } = await admitted.json();
    const input = buildKpiSuggestionTaskInput(await buildKpiSuggestionContext(productionVolumeProject, {
      targetNodeId: productionVolumeProject.rootNodeId, workspaceId: "smart-apple", vdtId: null,
      period: { key: "explicit:2026-11-01–2026-11-30", grain: "custom" }
    }));
    const body = { input, providerId: "apple_foundation_models", providerConfig: { bindingId: binding.bindingId }, expectedExecution: expectation };
    const before = requests.length;
    const forged = await smart.POST(json("/api/ai/suggestions", { ...body, providerConfig: { ...body.providerConfig, apiKey: "should-not-leave" } }));
    expect(forged.status).toBe(422);
    expect(requests).toHaveLength(before);
    const response = await smart.POST(json("/api/ai/suggestions", body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: { status: "empty", groups: [] } });
    expect(requests).toHaveLength(before + 1);
    const prompt = requests[before]!.prompt;
    const instructions = prompt.slice(0, prompt.indexOf('{"schemaVersion"'));
    expect(instructions).not.toMatch(/strict JSON|return one group|selectionMode|requiredKeys|recipeId:null|existingNodeId must be null/);
    expect(instructions).toContain("Keep the remaining causes complete, disjoint and qualified by the target scope.");
    expect(instructions).toContain("Before answering, check exact unit cancellation");
    expect(prompt).toContain(productionVolumeProject.rootNodeId);
    expect(ambient).not.toHaveBeenCalled();
  });
  it.each([
    { value: new AppleTransportError("invalid_output"), code: "invalid_output" },
    { value: { proposal: { kind: "empty", reason: "Fixture.", formula: "cannot_mix" } }, code: "APPLE_SMART_ENVELOPE_INVALID" },
    { value: { proposal: { kind: "ready", rationale: "Fixture.", children: "incorrect" } }, code: "APPLE_SMART_GROUP_SHAPE_INVALID" },
    { value: { proposal: { kind: "ready", rationale: "Fixture.", title: "Layer", formula: "missing", children: [
      { key: "first", conceptKey: "primary_input", name: "First", unit: "t" },
      { key: "second", conceptKey: "secondary_input", name: "Second", unit: "t" }
    ] } }, code: "APPLE_SMART_CANONICAL_INVALID" }
  ])("distinguishes safe native and canonical failure stages: $code", async ({ value, code }) => {
    const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
    const input = buildKpiSuggestionTaskInput(await buildKpiSuggestionContext(productionVolumeProject, {
      targetNodeId: productionVolumeProject.rootNodeId, workspaceId: "smart-diagnostics", vdtId: null,
      period: { key: "explicit:2026-11-01–2026-11-30", grain: "custom" }
    }));
    const previous = smartOutput;
    smartOutput = value;
    try {
      const response = await smart.POST(json("/api/ai/suggestions", {
        input, providerId: "apple_foundation_models", providerConfig: { bindingId: binding.bindingId }, expectedExecution: expectation
      }));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code } });
      expect(ambient).not.toHaveBeenCalled();
    } finally { smartOutput = previous; }
  });

  it("preserves a complete canonical factor group, source scope and selected model", async () => {
    const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
    const context = await buildKpiSuggestionContext(productionVolumeProject, {
      targetNodeId: productionVolumeProject.rootNodeId, workspaceId: "smart-ready-apple", vdtId: null,
      period: { key: "explicit:2026-11-01–2026-11-30", grain: "custom" }
    });
    const children = [
      { key: "work", conceptKey: "effective_time", name: "Working time", unit: "hours/month", existingNodeId: "effective_working_time" },
      { key: "rate", conceptKey: "productivity", name: "Average productivity", unit: "tonnes/hour", existingNodeId: "average_productivity" }
    ];
    const previous = smartOutput;
    smartOutput = { proposal: { kind: "ready", rationale: "Time and production rate.",
      title: "Time and rate", children, formula: "work * rate" } };
    try {
      const response = await smart.POST(json("/api/ai/suggestions", {
        input: buildKpiSuggestionTaskInput(context), providerId: "apple_foundation_models",
        providerConfig: { bindingId: binding.bindingId }, expectedExecution: expectation
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ result: { status: "ready", groups: [{
        formula: "work * rate", requiredKeys: ["work", "rate"], children
      }] } });
      const request = requests.at(-1)!;
      expect(request.expectedIdentity).toEqual(capability.identity);
      expect(request.prompt).toContain(productionVolumeProject.rootNodeId);
      expect(request.prompt).toContain(context.period.key);
    } finally { smartOutput = previous; }
  });

  it("admits three tree-based starters and rejects a mismatched locale without a cloud call", async () => {
    const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
    const input = buildChatStarterInput(productionVolumeProject, "en-US");
    const body = { taskType: "suggest_chat_starters", providerId: "apple_foundation_models",
      expectedExecution: expectation, providerConfig: { bindingId: binding.bindingId }, input };
    const before = requests.length;
    const wrongLocale = await bounded.POST(json("/api/ai/run-task", { ...body, input: { ...input, locale: "ru-RU" } }));
    expect(wrongLocale.status).toBe(409);
    expect(requests).toHaveLength(before);
    const response = await bounded.POST(json("/api/ai/run-task", body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: { kind: "chat_starters", prompts: expect.arrayContaining(["How is downtime counted?"]) } });
    expect(ambient).not.toHaveBeenCalled();
  });

  it("reviews the late rejected gap through the real Apple Supervisor and preserves open scope", async () => {
    const { POST: publish } = await import("../../skills/route");
    const { draftSkillMarkdown } = await import("@vdt-studio/vdt-agent");
    const definitions = JSON.parse(readFileSync("eval/agent-autonomy/assets/workspace-q01-catalog.v2.json", "utf8"));
    const ids: string[] = [];
    for (const { title, description, content } of definitions) {
      const raw = draftSkillMarkdown({ title, description, instructions: content, domain: "custom", patterns: ["accepted captions"] });
      const response = await publish(json("/api/skills", { raw }));
      expect(response.status).toBe(201);
      ids.push((await response.json()).skill.id);
    }
    const fixture = JSON.parse(readFileSync("eval/agent-autonomy/workspace-requests.v2.json", "utf8"));
    const exact = fixture.cases.find(({ id }: { id: string }) => id === "SKILL-01-held-out").variants.en.turns[0].prompt;
    for (const { complete, direct, joint, wrongBoundary, distinctQuestion, rejectedQuestion, wrongRule } of [
      { complete: true }, { complete: false }, { complete: true, direct: true }, { complete: false, direct: true },
      { complete: true, direct: true, joint: true }, { complete: false, direct: true, joint: true },
      { complete: true, joint: true }, { complete: false, joint: true, wrongBoundary: true },
      { complete: true, joint: true, distinctQuestion: true },
      { complete: false, joint: true, rejectedQuestion: true },
      { complete: false, direct: true, joint: true, wrongRule: true }
    ]) {
      const shouldRecover = rejectedQuestion || wrongRule;
      const shouldSelect = complete && !distinctQuestion;
      const prompt = complete ? exact : exact.replace("No caption occurs in both queues.", "We have not checked whether any caption occurs in both queues.");
      lateGapFixture = { prompt, deskId: ids[0]!, publishingId: ids[1]!, complete, ...(direct ? { direct } : {}), ...(joint ? { joint } : {}),
        ...(wrongBoundary ? { wrongBoundary } : {}), ...(distinctQuestion ? { distinctQuestion } : {}),
        ...(rejectedQuestion ? { rejectedQuestion } : {}), ...(wrongRule ? { wrongRule } : {}) };
      const before = requests.length;
      const { binding } = await (await bindings.POST(json("/api/agent/bindings/apple", { locale: "en-US" }))).json();
      const response = await runs.POST(json("/api/agent/runs", {
        mode: "generate_vdt", outcomeSelection: "automatic", executionBindingId: binding.bindingId,
        expectedExecution: expectation, input: { prompt, rootKpi: "Accepted captions" }, options: { researchMode: "off" }
      }));
      expect(response.status).toBe(200);
      ({ runId } = await response.json());
      await vi.waitFor(() => {
        const state = runtime.agentRuntime.store.getState(runId!);
        if (shouldSelect) expect(state.selectedSkills.map(skill => skill.id), JSON.stringify(state.events.slice(-3))).toEqual([ids[0]]);
        else expect(state.status, JSON.stringify(state.events.slice(-3))).toBe(shouldRecover ? "recovery_required" : "needs_user_input");
      });
      const state = runtime.agentRuntime.store.getState(runId!);
      const dispatched = state.events.filter(event => event.type === "tool_call_completed")
        .flatMap(event => event.metadata?.toolName ? [event.metadata.toolName] : []);
      expect(dispatched).toEqual(["run.propose_outcome", "skill.list", "skill.search", "skill.read", "skill.read",
        ...(shouldRecover ? [] : [shouldSelect ? "skill.select" : "user.ask"])]);
      if (shouldSelect) {
        const exactRead = state.events.find(event => event.type === "skill_read" && event.metadata?.id === ids[0]);
        const selected = state.events.find(event => event.type === "skill_selected");
        expect(selected?.metadata?.readReceiptId).toBe(exactRead?.metadata?.readReceiptId);
        expect(state.pendingQuestions ?? []).toEqual([]);
      } else {
        expect(state.selectedSkills).toEqual([]);
        expect(state.pendingQuestions ?? []).toEqual(shouldRecover ? [] : [expect.objectContaining({
          question: distinctQuestion ? "Should the count follow the original caption date or the date checked?" : lateGapGroundedQuestion,
          id: "skill_scope", required: true, expectedAnswerType: "text"
        })]);
      }
      expect(state.builder?.getRevision()).toBe(0);
      const reviewFields = requests.slice(before).map(request => request.schema.fields[0]?.name);
      expect(reviewFields.filter(field => field === "countingRuleFirst")).toHaveLength(1);
      expect(reviewFields.filter(field => field === "countingRuleSecond")).toHaveLength(1);
      expect(reviewFields.filter(field => field === "boundaryMatch")).toHaveLength(1);
      expect(reviewFields.filter(field => field === "boundaryWitness")).toHaveLength(1);
      expect(reviewFields.filter(field => field === "proposedBoundaryAudit")).toHaveLength(2);
      expect(reviewFields.filter(field => field === "boundaryAudit")).toHaveLength(1);
      expect(reviewFields.filter(field => field === "prerequisiteRule")).toHaveLength(1);
      expect(reviewFields.filter(field => field === "conditionEvidence")).toHaveLength(1);
      expect(reviewFields.filter(field => field === "conditionWitness")).toHaveLength(wrongRule ? 0 : 1);
      expect(reviewFields.filter(field => field === "reasonLanguage")).toHaveLength(complete ? 1 : 0);
      expect(reviewFields.filter(field => field === "occurrenceQuestionProof")).toHaveLength(complete || wrongRule ? 0 : 1);
      expect(reviewFields.filter(field => field === "conditionQuestion")).toHaveLength(complete && !direct ? 1 : 0);
      expect(reviewFields).not.toContain("questionEffect");
      if (direct && !complete && !wrongRule) {
        expect(lateGapFixture).toBeDefined();
        lateGapFixture!.answered = true;
        lateGapFixture!.complete = true;
        const beforeAnswer = requests.length;
        const resumed = await messages.POST(json(`/api/agent/runs/${runId}/messages`, {
          type: "user_answer", expectedExecutionMode: "local", answers: { skill_scope: "No caption occurs in both queues." }
        }), { params: Promise.resolve({ runId: runId! }) });
        expect(resumed.status).toBe(200);
        await vi.waitFor(() => {
          const reviewed = runtime.agentRuntime.store.getState(runId!);
          expect(reviewed.selectedSkills.map(skill => skill.id), JSON.stringify(reviewed.events.slice(-3))).toEqual([ids[0]]);
          expect(reviewed.builder?.getRevision()).toBe(0);
        });
        const refreshed = runtime.agentRuntime.store.getState(runId!);
        const answerReviewFields = requests.slice(beforeAnswer).map(request => request.schema.fields[0]?.name);
        expect(answerReviewFields).toContain("occurrenceAnswerProof");
        expect(answerReviewFields).not.toContain("conditionEvidence");
        expect(refreshed.events.filter(event => event.type === "skill_selected")).toHaveLength(1);
        expect(refreshed.events.filter(event => event.type === "skill_search" && event.metadata?.toolName === "skill.search")).toHaveLength(2);
      }
      const finishedRunId = runId!;
      if (shouldRecover) await vi.waitFor(() => expect(supervisor.isStructuredModelAgentRunActive(finishedRunId)).toBe(false));
      else await supervisor.cancelStructuredModelAgentRun(finishedRunId, true);
      runId = undefined;
    }
    lateGapFixture = undefined;
    expect(ambient).not.toHaveBeenCalled();
  }, 25_000);

});
