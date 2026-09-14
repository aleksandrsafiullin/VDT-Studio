import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  compactGatewayFeedback,
  feedbackFromForbiddenFields,
  feedbackFromToolEnvelope,
  feedbackFromValidation,
  feedbackFromZodError,
  formatFeedbackForPrompt
} from "./feedback";

describe("structured feedback", () => {
  it("maps schema and forbidden-field failures into retryable prompt feedback", () => {
    const schema = z.object({ type: z.literal("call_tool"), toolName: z.string() });
    const parsed = schema.safeParse({ type: "call_tool" });
    if (parsed.success) throw new Error("Expected schema parse to fail.");

    const schemaFeedback = feedbackFromZodError(parsed.error, { taskType: "agent_decision" });
    const forbiddenFeedback = feedbackFromForbiddenFields(["nodes", "driverPlan"]);

    expect(schemaFeedback).toMatchObject({
      kind: "schema_validation_failed",
      severity: "error",
      retryable: true,
      target: { taskType: "agent_decision", fieldPath: "toolName" }
    });
    expect(forbiddenFeedback).toMatchObject({
      kind: "forbidden_field",
      retryable: true,
      actual: ["nodes", "driverPlan"]
    });
    expect(formatFeedbackForPrompt([schemaFeedback, forbiddenFeedback])).toContain("forbidden_field");
  });

  it("maps tool envelopes and validation failures into next-tool hints", () => {
    const invalidArgs = feedbackFromToolEnvelope({
      toolName: "vdt.add_driver",
      ok: false,
      error: { code: "INVALID_TOOL_ARGS", message: "Expected string", details: [{ path: ["name"] }] },
      projectChanged: false,
      emittedEventIds: []
    });
    const validation = feedbackFromValidation({
      valid: false,
      errors: [{
        type: "invalid_graph",
        severity: "error",
        message: "Root node has no formula.",
        nodeId: "root",
        repairHints: ["Set a root formula."]
      }],
      warnings: []
    });

    expect(invalidArgs).toMatchObject({
      kind: "invalid_tool_args",
      target: { toolName: "vdt.add_driver" },
      retryable: true
    });
    expect(validation).toMatchObject({
      kind: "graph_validation_failed",
      target: { nodeId: "root" },
      suggestedNextTools: expect.arrayContaining(["vdt.set_formula"])
    });
  });

  it("suggests add_driver instead of create_draft when the graph already has nodes", () => {
    const noDraft = feedbackFromToolEnvelope({
      toolName: "vdt.add_driver",
      ok: false,
      error: { code: "NO_DRAFT_PROJECT", message: "VDT builder session is not available for this run." },
      projectChanged: false,
      emittedEventIds: []
    }, { hasNonemptyGraph: true });
    const draftExists = feedbackFromToolEnvelope({
      toolName: "vdt.create_draft",
      ok: false,
      error: { code: "DRAFT_ALREADY_EXISTS", message: "Draft project already exists. Pass replaceExisting=true to replace it." },
      projectChanged: false,
      emittedEventIds: []
    });
    const forbidden = feedbackFromForbiddenFields(["nodes"], { hasNonemptyGraph: true });

    expect(noDraft).toMatchObject({
      suggestedNextTools: ["vdt.add_driver", "vdt.update_node"]
    });
    expect(draftExists).toMatchObject({
      suggestedNextTools: ["vdt.add_driver", "vdt.update_node"]
    });
    expect(forbidden).toMatchObject({
      suggestedNextTools: expect.not.arrayContaining(["vdt.create_draft"])
    });
    expect(forbidden?.suggestedNextTools).toEqual(expect.arrayContaining(["vdt.add_driver", "vdt.update_node"]));
  });

  it("maps a missing research provider to research_required and suggests user.ask", () => {
    const envelope = {
      toolName: "research.search_web",
      ok: false as const,
      error: {
        code: "RESEARCH_PROVIDER_NOT_CONFIGURED",
        message: "Research provider is not configured. Ask the user for process details or continue with explicit assumptions.",
        details: { providerConfigured: false }
      },
      projectChanged: false,
      emittedEventIds: []
    };
    const feedback = feedbackFromToolEnvelope(envelope);
    const gateway = compactGatewayFeedback(envelope);

    expect(feedback).toMatchObject({
      kind: "research_required",
      target: { toolName: "research.search_web" },
      suggestedNextTools: ["user.ask"],
      retryable: false
    });
    expect(gateway).toEqual({
      kind: "research_required",
      message: envelope.error.message,
      retryable: false,
      suggestedNextTools: ["user.ask"]
    });
  });

  it("maps a configured-but-broken research provider as a non-retryable tool failure", () => {
    const envelope = {
      toolName: "research.search_web",
      ok: false as const,
      error: {
        code: "RESEARCH_PROVIDER_AUTH_FAILED",
        message: "Research provider \"brave\" request failed with status 401."
      },
      projectChanged: false,
      emittedEventIds: []
    };
    const feedback = feedbackFromToolEnvelope(envelope);
    const gateway = compactGatewayFeedback(envelope);

    expect(feedback).toMatchObject({
      kind: "tool_failed",
      target: { toolName: "research.search_web" },
      suggestedNextTools: ["user.ask"],
      retryable: false
    });
    expect(gateway).toEqual({
      kind: "tool_failed",
      message: envelope.error.message,
      retryable: false,
      suggestedNextTools: ["user.ask"]
    });
  });

  it("keeps a missing proposal base non-retryable and a pending lock retryable", () => {
    const missingBase = feedbackFromToolEnvelope({
      toolName: "vdt.update_node",
      ok: false,
      error: {
        code: "PROPOSAL_BASE_NOT_PERSISTED",
        message: "Proposal run:mutation:28 cannot resolve a persisted VDT base revision."
      },
      projectChanged: false,
      emittedEventIds: []
    });
    const pendingLock = feedbackFromToolEnvelope({
      toolName: "vdt.update_node",
      ok: false,
      error: {
        code: "REVISION_CONFLICT",
        message: "Another pending revision owns this VDT."
      },
      projectChanged: false,
      emittedEventIds: []
    });

    expect(missingBase).toMatchObject({ retryable: false });
    expect(pendingLock).toMatchObject({ retryable: true });
  });

  it("keeps research unavailable retryable and stable 4xx terminal", () => {
    const reset = feedbackFromToolEnvelope({
      toolName: "research.search_web",
      ok: false,
      error: {
        code: "RESEARCH_PROVIDER_UNAVAILABLE",
        message: "Research provider \"brave\" request failed: fetch failed"
      },
      projectChanged: false,
      emittedEventIds: []
    });
    const stable4xx = feedbackFromToolEnvelope({
      toolName: "research.search_web",
      ok: false,
      error: {
        code: "RESEARCH_PROVIDER_FAILED",
        message: "Research provider \"brave\" request failed with status 404."
      },
      projectChanged: false,
      emittedEventIds: []
    });

    expect(reset).toMatchObject({ retryable: true });
    expect(stable4xx).toMatchObject({
      retryable: false,
      suggestedNextTools: ["user.ask"]
    });
  });
});
