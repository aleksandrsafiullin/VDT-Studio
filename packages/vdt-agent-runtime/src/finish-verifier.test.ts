import { describe, expect, it } from "vitest";
import { productionVolumeProject,VdtBuilderSession,inspectDecompositionHierarchy,validateGraph } from "@vdt-studio/vdt-core";
import type { AgentSessionBinding } from "./agent-execution-contracts";
import type { AgentSupervisorPersistenceStateV2 } from "./agent-supervisor-persistence";
import { verifyDeterministicRunFinish } from "./finish-verifier";
import { unboundQuotedFormulaFacts } from "./model-acceptance-contract";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

it("requires the recorded hierarchy on protected runs even when the flat graph calculates",()=>{
 const b=new VdtBuilderSession();b.createDraft({rootKpi:"Output",projectTitle:"Output",unit:"t"});
 b.addDriver({nodeId:"rate",parentNodeId:"output",name:"Rate",baselineValue:2});
 b.addDriver({nodeId:"hours",parentNodeId:"output",name:"Hours",baselineValue:3});
 b.addDriver({nodeId:"production",parentNodeId:"output",name:"Production",type:"calculated",formula:"rate * hours"});b.setFormula({nodeId:"output",formula:"production"});
 expect(verifyDeterministicRunFinish({...readyInput(),project:b.getProject(),requireHierarchy:true}).code).toBe("HIERARCHY_INCOMPLETE");
 b.updateNode({nodeId:"output",patch:{decompositionPlan:{version:1,goal:"Output by time and productivity",nodes:[{nodeId:"production",parentNodeId:"output",kind:"calculated"},{nodeId:"rate",parentNodeId:"production",kind:"input"},{nodeId:"hours",parentNodeId:"production",kind:"input"}]}}});
 const flat=b.getProject();expect(verifyDeterministicRunFinish({...readyInput(),project:flat,requireHierarchy:true})).toMatchObject({accepted:false,code:"HIERARCHY_INCOMPLETE"});
 for(const edge of flat.graph.edges)if(["rate","hours"].includes(edge.targetNodeId))edge.sourceNodeId="production";
 expect(verifyDeterministicRunFinish({...readyInput(),project:flat,requireHierarchy:true})).toMatchObject({accepted:true,code:"FINISH_VERIFIED"});
 flat.graph.nodes.find(n=>n.id==="production")!.formula="rate + 0 * hours";
 expect(verifyDeterministicRunFinish({...readyInput(),project:flat,requireHierarchy:true})).toMatchObject({accepted:false,code:"HIERARCHY_INCOMPLETE"});
});

describe("verifyDeterministicRunFinish", () => {
  it("withholds a finish receipt for conflicting source bindings in a calculable draft", () => {
    const issue = { code: "DUPLICATE_SOURCE_FACT" as const, nodeId: "discount", usedBy: "quantity", value: 120,
      quote: "Sold 120 items", detail: "Quantity already owns the quoted measurement." };
    const result = verifyDeterministicRunFinish({ ...readyInput(), sourceGroundingIssues: [issue] });
    expect(result).toMatchObject({ accepted: false, code: "SOURCE_GROUNDING_CONFLICT", payload: { sourceGroundingIssues: [issue] } });
    expect(result.finishReceipt).toBeUndefined();
  });

  it("requires percent scaling before issuing a receipt for a new tree", () => {
    const b = new VdtBuilderSession();
    b.createDraft({ rootKpi: "Revenue", projectTitle: "Revenue", unit: "USD" });
    b.addDriver({ nodeId: "gross", parentNodeId: "revenue", name: "Gross", unit: "USD", baselineValue: 100 });
    b.addDriver({ nodeId: "discount", parentNodeId: "revenue", name: "Discount", unit: "%", baselineValue: 10 });
    b.setFormula({ nodeId: "revenue", formula: "gross * (1 - discount)" });
    const input = { ...readyInput(), requireDerivedRoot: true, enforcePercentageScale: true };
    expect(verifyDeterministicRunFinish({ ...input, project: b.getProject() })).toMatchObject({ accepted: false, code: "GRAPH_INVALID" });
    b.setFormula({ nodeId: "revenue", formula: "gross * (1 - discount / 100)" });
    expect(verifyDeterministicRunFinish({ ...input, project: b.getProject() })).toMatchObject({ accepted: true, payload: { rootValue: 90 } });
  });

  it("withholds the finish receipt for minutes presented as hours, including a missing operand unit", () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ rootKpi: "Review time", projectTitle: "Review time", unit: "h" });
    const parentNodeId = builder.getProject().rootNodeId;
    builder.addDriver({ nodeId: "documents", parentNodeId, name: "Documents", baselineValue: 250 });
    builder.addDriver({ nodeId: "share", parentNodeId, name: "Share", unit: "%", baselineValue: 16 });
    builder.addDriver({ nodeId: "duration", parentNodeId, name: "Time per document", unit: "min/item", baselineValue: 12 });
    const minutes = "documents * (share / 100) * duration";
    builder.setFormula({ nodeId: parentNodeId, formula: minutes });
    const input = { ...readyInput(), requireDerivedRoot: true };
    const verify = () => verifyDeterministicRunFinish({ ...input, project: builder.getProject() });
    expect(verify()).toMatchObject({ accepted: false, code: "GRAPH_INVALID" });
    builder.updateNode({ nodeId: "documents", patch: { unit: "items" } });
    expect(verify()).toMatchObject({ accepted: false, code: "GRAPH_INVALID" });
    builder.setFormula({ nodeId: parentNodeId, formula: "documents * share * duration / 60" });
    expect(verify()).toMatchObject({ accepted: false, code: "GRAPH_INVALID" });
    builder.setFormula({ nodeId: parentNodeId, formula: `(${minutes}) / 60` });
    expect(validateGraph(builder.getProject()).valid).toBe(true);
    expect(verify()).toMatchObject({ accepted: true, code: "FINISH_VERIFIED", payload: { rootValue: 8 } });
  });

  it("requires a sourced input when a quoted amount appears as a formula literal", () => {
    const b = new VdtBuilderSession();
    b.createDraft({ rootKpi: "Revenue", projectTitle: "Revenue", unit: "USD" });
    b.addDriver({ nodeId: "gross", parentNodeId: "revenue", name: "Gross", unit: "USD", baselineValue: 100 });
    b.setFormula({ nodeId: "revenue", formula: "gross - 20" });
    const request = { mode: "generate_vdt" as const, providerId: "test", input: { prompt: "Refunds were 20 USD." } };
    const verify = () => {
      const project = b.getProject();
      return verifyDeterministicRunFinish({ ...readyInput(), project, unboundSourceFacts: unboundQuotedFormulaFacts(project, request) });
    };
    expect(verify()).toMatchObject({ accepted: false, payload: { blockers: [
      { code: "SOURCE_PROVENANCE_INCOMPLETE", detail: expect.stringContaining("Refunds were 20 USD") }
    ] } });
    b.addDriver({ nodeId: "refunds", parentNodeId: "revenue", name: "Refunds", unit: "USD", baselineValue: 20 });
    b.updateNode({ nodeId: "refunds", patch: { valueStatus: "user_provided_value", valueSource: {
      sourceTier: "user_input", note: "Refunds were 20 USD", editableInDialog: true, acceptedByUserInDialog: true
    } } });
    b.setFormula({ nodeId: "revenue", formula: "gross - refunds" });
    expect(verify()).toMatchObject({ accepted: true, payload: { rootValue: 80 } });
  });

  it("recognizes a quoted percent as a literal multiplier or fraction and preserves scale constants", () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ rootKpi: "Revenue", projectTitle: "Revenue", unit: "USD" });
    builder.addDriver({ nodeId: "gross", parentNodeId: "revenue", name: "Gross", unit: "USD", baselineValue: 1_000 });
    const request = { mode: "generate_vdt" as const, providerId: "test", input: {
      prompt: "A discount of 10% applies. Refunds were 500 USD. A 100 USD cap is informational. The maximum possible discount is 100%."
    } };
    for (const formula of ["gross * 0.9 - 500", "gross * (90 / 100) - 500", "gross * (9 / 10) - 500",
      "gross * (1 - 0.1) - 500", "gross * (1 - 10 / 100) - 500"]) {
      expect(unboundQuotedFormulaFacts(builder.getProject(), request, { nodeId: "revenue", formula }))
        .toEqual([{ value: 10, quote: "A discount of 10% applies", unit: "%" }, { value: 500, quote: "Refunds were 500 USD", unit: "USD" }]);
    }
    expect(unboundQuotedFormulaFacts(builder.getProject(), request, { nodeId: "revenue", formula: "gross / 100" }))
      .toEqual([{ value: 100, quote: "A 100 USD cap is informational", unit: "USD" }]);
    builder.addDriver({ nodeId: "discount", parentNodeId: "revenue", name: "Discount", unit: "%", baselineValue: 10 });
    builder.addDriver({ nodeId: "refunds", parentNodeId: "revenue", name: "Refunds", unit: "USD", baselineValue: 500 });
    builder.setFormula({ nodeId: "revenue", formula: "gross * (1 - discount / 100) - refunds" });
    expect(unboundQuotedFormulaFacts(builder.getProject(), request)).toEqual([]);
    expect(verifyDeterministicRunFinish({ ...readyInput(), project: builder.getProject(), enforcePercentageScale: true }))
      .toMatchObject({ accepted: true, payload: { rootValue: 400 } });
  });

  it("never issues a finish receipt for formula/link divergence accepted as an editable draft", () => {
    const project = structuredClone(productionVolumeProject);
    project.graph.edges = project.graph.edges.filter(edge => edge.targetNodeId !== "average_productivity");
    expect(validateGraph(project, undefined, { purpose: "draft" }).valid).toBe(true);
    const result = verifyDeterministicRunFinish({ ...readyInput(), project });
    expect(result).toMatchObject({ accepted: false, code: "GRAPH_INVALID" });
    expect(result.finishReceipt).toBeUndefined();
  });

  it("retains full-agent root-group enforcement after an explicit incremental user inspection", () => {
    const b = new VdtBuilderSession(); b.createDraft({ rootKpi: "Output", projectTitle: "Incremental context boundary", unit: "t" });
    b.addDriver({ nodeId: "rate", parentNodeId: "output", name: "Measured rate", baselineValue: 2 }); b.setFormula({ nodeId: "output", formula: "rate" });
    for (const id of ["reference_a", "reference_b"]) b.addDriver({ nodeId: id, parentNodeId: "output", name: id, baselineValue: 1, relation: "contextual_influence" });
    b.updateNode({ nodeId: "output", patch: { decompositionPlan: { version: 1, goal: "Keep explicit user context one layer", nodes: [
      { nodeId: "rate", parentNodeId: "output", kind: "input" },
      { nodeId: "reference_a", parentNodeId: "output", kind: "context", rationale: "Explicit user context" },
      { nodeId: "reference_b", parentNodeId: "output", kind: "context", rationale: "Explicit user context" }
    ] } } });
    const project = b.getProject();
    expect(inspectDecompositionHierarchy(project, "incremental_user_apply")).toMatchObject({ valid: true, constructionWarnings: [expect.stringContaining("ROOT_CONTEXT_LEAVES_REQUIRE_GROUP")] });
    expect(inspectDecompositionHierarchy(project).valid).toBe(false);
    expect(verifyDeterministicRunFinish({ ...readyInput(), project, requireHierarchy: true })).toMatchObject({ accepted: false, code: "HIERARCHY_INCOMPLETE" });
  });
  it("accepts empty reference containers but never empty numerical reference leaves", () => {
    const b = new VdtBuilderSession(); b.createDraft({ rootKpi: "Output", projectTitle: "References", unit: "t" });
    b.addDriver({ nodeId: "rate", parentNodeId: "output", name: "Rate", baselineValue: 2 }); b.setFormula({ nodeId: "output", formula: "rate * 3" });
    b.addDriver({ nodeId: "refs", parentNodeId: "output", name: "References", type: "external_factor", relation: "contextual_influence" });
    b.addDriver({ nodeId: "spec", parentNodeId: "refs", name: "Specification", baselineValue: 10, relation: "contextual_influence" });
    b.updateNode({ nodeId: "output", patch: { decompositionPlan: { version: 1, goal: "Output and references", nodes: [
      { nodeId: "rate", parentNodeId: "output", kind: "input" },
      { nodeId: "refs", parentNodeId: "output", kind: "context", rationale: "Group" },
      { nodeId: "spec", parentNodeId: "refs", kind: "context", rationale: "Reference" }
    ] } } });
    expect(verifyDeterministicRunFinish({ ...readyInput(), project: b.getProject(), requireHierarchy: true })).toMatchObject({ accepted: true, code: "FINISH_VERIFIED" });
    const missing = b.getProject(); delete missing.graph.nodes.find(n => n.id === "spec")!.baselineValue;
    expect(verifyDeterministicRunFinish({ ...readyInput(), project: missing, requireHierarchy: true }).code).toBe("CALCULATION_ERRORS");
  });
  it("refuses a constant placeholder as a new completed tree while preserving legitimate numeric review", () => {
    const project = structuredClone(productionVolumeProject);
    const root = project.graph.nodes.find((node) => node.id === project.rootNodeId)!;
    project.graph = { nodes: [{ ...root, formula: "0" }], edges: [] };
    expect(verifyDeterministicRunFinish({ ...readyInput(), project, requireDerivedRoot: true })).toMatchObject({ accepted: false, code: "ROOT_NOT_DERIVED" });
    expect(verifyDeterministicRunFinish({ ...readyInput(), project, requireDerivedRoot: false })).toMatchObject({ accepted: true, payload: { rootValue: 0 } });
    expect(verifyDeterministicRunFinish({ ...readyInput(), requireDerivedRoot: true }).accepted).toBe(true);
  });

  it("creates an idempotent FinishReceiptV2 only for a valid calculable head", () => {
    const first = verifyDeterministicRunFinish({
      ...readyInput(),
      now: () => "2026-08-26T10:00:00.000Z"
    });
    expect(first).toMatchObject({
      accepted: true,
      code: "FINISH_VERIFIED",
      finishReceipt: {
        state: "verified",
        projectRevision: 7,
        finalMessageHash: null
      },
      payload: { rootValue: expect.any(Number) }
    });

    const replay = verifyDeterministicRunFinish({
      ...readyInput(),
      existingFinishReceipt: first.finishReceipt,
      now: () => "2026-08-26T11:00:00.000Z"
    });
    expect(replay.finishReceipt).toEqual(first.finishReceipt);
  });

  it("rejects stale heads and pending control-plane work before graph inspection", () => {
    const result = verifyDeterministicRunFinish({
      ...readyInput(),
      currentRevision: 8,
      pendingQuestion: true,
      pendingApproval: true,
      pendingProposal: true,
      ambiguousOperation: true
    });
    expect(result).toMatchObject({
      accepted: false,
      code: "STALE_PROJECT_REVISION"
    });
    expect((result.payload.blockers as Array<{ code: string }>).map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "STALE_PROJECT_REVISION",
        "PENDING_QUESTION",
        "PENDING_APPROVAL",
        "PENDING_PROPOSAL",
        "OPERATION_LEDGER_NOT_SETTLED"
      ])
    );
  });

  it("returns a compact formula backlog rejection for incomplete calculated nodes", () => {
    const project = structuredClone(productionVolumeProject);
    const calculated = project.graph.nodes.find((node) => node.id === "average_productivity")!;
    calculated.formula = undefined;
    const result = verifyDeterministicRunFinish({ ...readyInput(), project });
    expect(result).toMatchObject({
      accepted: false,
      code: "FORMULA_BACKLOG_NOT_EMPTY",
      payload: { formulaBacklogCount: 1 }
    });
  });

  it("enforces mode-specific completion for deepen_node", () => {
    expect(verifyDeterministicRunFinish({
      ...readyInput(),
      mode: "deepen_node",
      modeCompletion: { immediateChildCreated: false }
    })).toMatchObject({ accepted: false, code: "MODE_COMPLETION_MISSING" });

    expect(verifyDeterministicRunFinish({
      ...readyInput(),
      mode: "deepen_node",
      modeCompletion: { immediateChildCreated: true, selectedNodeId: "production_volume", createdNodeIds: ["effective_working_time", "average_productivity"] },
      now: () => "2026-08-26T10:00:00.000Z"
    })).toMatchObject({ accepted: true, code: "FINISH_VERIFIED" });

    const incomplete = structuredClone(productionVolumeProject);
    incomplete.graph.nodes.find((node) => node.id === "average_productivity")!.formula = undefined;
    expect(verifyDeterministicRunFinish({
      ...readyInput(),
      project: incomplete,
      mode: "deepen_node",
      modeCompletion: { immediateChildCreated: true, selectedNodeId: "production_volume", createdNodeIds: ["effective_working_time", "average_productivity"] }
    })).toMatchObject({ accepted: false, code: "FORMULA_BACKLOG_NOT_EMPTY" });
  });
  it("rejects child-only selected completion and accepts a valid formula with unknown inputs", () => {
    const b = new VdtBuilderSession(); b.createDraft({ rootKpi: "Output", projectTitle: "Selected layer", unit: "t" });
    b.addDriver({ nodeId: "selected", parentNodeId: "output", name: "Measured source", unit: "t", type: "input", baselineValue: 4 });
    b.setFormula({ nodeId: "output", formula: "selected" }); b.addDriver({ nodeId: "new_input", parentNodeId: "selected", name: "New measured input", unit: "t", type: "input" });
    const input = { ...readyInput(), mode: "deepen_node" as const, modeCompletion: { immediateChildCreated: true, selectedNodeId: "selected", createdNodeIds: ["new_input"] } };
    expect(verifyDeterministicRunFinish({ ...input, project: b.getProject() })).toMatchObject({ accepted: false, code: "TARGET_FORMULA_REQUIRED" });
    b.setFormula({ nodeId: "selected", formula: "new_input" });
    expect(verifyDeterministicRunFinish({ ...input, project: b.getProject() })).toMatchObject({ accepted: true, code: "FINISH_VERIFIED" });
    expect(b.getProject().graph.nodes.find(node => node.id === "selected")?.baselineValue).toBe(4);
  });

  it("evaluates only latest ledger states and permits the currently executing finish request", () => {
    const state = supervisorStateWithSettledHistory();
    expect(verifyDeterministicRunFinish({
      ...readyInput(),
      supervisorState: state,
      currentFinishCallId: "finish-call",
      now: () => "2026-08-26T10:00:03.000Z"
    })).toMatchObject({ accepted: true, code: "FINISH_VERIFIED" });

    expect(verifyDeterministicRunFinish({
      ...readyInput(),
      supervisorState: state
    })).toMatchObject({ accepted: false, code: "OPERATION_LEDGER_NOT_SETTLED" });

    state.toolOperationReceipts.push({
      ...state.toolOperationReceipts[0]!,
      receiptId: "tool-receipt-ambiguous",
      externalCallId: "old-ambiguous-call",
      idempotencyKey: "tool-key-ambiguous",
      state: "ambiguous",
      resultCode: "AMBIGUOUS_TOOL_RECOVERY",
      startedAt: "2026-08-26T10:00:03.000Z",
      updatedAt: "2026-08-26T10:00:03.000Z"
    });
    expect(verifyDeterministicRunFinish({
      ...readyInput(),
      supervisorState: state
    })).toMatchObject({ accepted: false, code: "OPERATION_LEDGER_NOT_SETTLED" });
  });

  it("rejects missing_value calculation errors and a non-finite root", () => {
    const project = structuredClone(productionVolumeProject);
    project.graph.nodes = project.graph.nodes.map((node) => (
      node.formula?.trim()
        ? node
        : { ...node, baselineValue: undefined, value: undefined }
    ));
    expect(verifyDeterministicRunFinish({ ...readyInput(), project })).toMatchObject({
      accepted: false,
      code: "CALCULATION_ERRORS"
    });
  });
});

function readyInput() {
  return {
    binding,
    project: structuredClone(productionVolumeProject),
    currentRevision: 7,
    expectedHeadRevision: 7,
    mode: "generate_vdt" as const,
    pendingQuestion: false,
    pendingApproval: false,
    pendingProposal: false,
    ambiguousOperation: false
  };
}

const binding: AgentSessionBinding = {
  schemaVersion: 2,
  bindingId: "binding-1",
  runId: "run-1",
  projectId: "project-1",
  executionProfile: "model_agent",
  engineId: "model-engine",
  engineAdapterId: "structured-turn-v1",
  backendId: "model-backend",
  modelId: "model-1",
  protocolVersion: "model-turn.v1",
  cliVersion: null,
  toolIsolation: "hard_verified",
  qualificationStatus: "qualified",
  capabilityEvidenceHash: HASH_B,
  settingsHash: HASH_A,
  capabilityProfileHash: HASH_B,
  toolCatalogHash: HASH_A,
  externalSessionId: null,
  sessionEpoch: 1,
  boundAt: "2026-08-26T10:00:00.000Z"
};

function supervisorStateWithSettledHistory(): AgentSupervisorPersistenceStateV2 {
  return {
    schemaVersion: 2,
    binding,
    checkpoint: {
      schemaVersion: 2,
      checkpointId: "checkpoint-finish-in-flight",
      bindingId: binding.bindingId,
      runId: binding.runId,
      sessionEpoch: binding.sessionEpoch,
      externalSessionId: null,
      lastConfirmedInput: null,
      lastConfirmedOutput: null,
      activeExchange: null,
      activeToolCall: {
        externalCallId: "finish-call",
        toolName: "run.request_finish",
        state: "in_flight"
      },
      finishReceipt: null,
      createdAt: "2026-08-26T10:00:02.000Z"
    },
    exchangeReceipts: [
      {
        schemaVersion: 2,
        receiptId: "exchange-receipt-1",
        runId: binding.runId,
        bindingId: binding.bindingId,
        exchangeId: "exchange-1",
        stableCallKey: "turn-1",
        sessionEpoch: 1,
        state: "in_flight",
        inputHash: HASH_A,
        outputHash: null,
        resultCode: null,
        startedAt: "2026-08-26T10:00:00.000Z",
        updatedAt: "2026-08-26T10:00:00.000Z"
      },
      {
        schemaVersion: 2,
        receiptId: "exchange-receipt-1",
        runId: binding.runId,
        bindingId: binding.bindingId,
        exchangeId: "exchange-1",
        stableCallKey: "turn-1",
        sessionEpoch: 1,
        state: "completed",
        inputHash: HASH_A,
        outputHash: HASH_B,
        resultCode: "OK",
        startedAt: "2026-08-26T10:00:00.000Z",
        updatedAt: "2026-08-26T10:00:01.000Z"
      }
    ],
    toolOperationReceipts: [
      {
        schemaVersion: 2,
        receiptId: "tool-receipt-finish",
        runId: binding.runId,
        bindingId: binding.bindingId,
        externalCallId: "finish-call",
        toolName: "run.request_finish",
        idempotencyKey: "tool-key-finish",
        sessionEpoch: 1,
        state: "in_flight",
        argsHash: HASH_A,
        resultHash: null,
        resultCode: null,
        expectedRevision: 7,
        committedRevision: null,
        startedAt: "2026-08-26T10:00:02.000Z",
        updatedAt: "2026-08-26T10:00:02.000Z"
      }
    ],
    finishReceipt: null,
    eventOutbox: [],
    updatedAt: "2026-08-26T10:00:02.000Z"
  };
}
