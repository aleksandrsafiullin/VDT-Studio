import { describe, expect, it } from "vitest";
import {
  AGENT_RUN_EVENT_V2_SOURCE_TYPES,
  agentRunEventV2Schema,
  type AgentRunEventV2Source,
  type AgentRunEventV2Type
} from "./agent-run-event-v2";

const hashA = `sha256:${"a".repeat(64)}`;
const base = {
  schemaVersion: 2 as const,
  id: "run-1:event-1",
  runId: "run-1",
  seq: 1,
  previousHash: null,
  hash: hashA,
  timestamp: "2026-08-26T06:00:00.000Z"
};

const samples: Record<AgentRunEventV2Type, Record<string, unknown>> = {
  assistant_message: {
    ...base,
    type: "assistant_message",
    source: "external_agent",
    sessionId: "session-1",
    messageId: "message-1",
    payload: { text: "I am reading the brief.", format: "markdown", completed: true }
  },
  question: {
    ...base,
    type: "question",
    source: "vdt_agent",
    sessionId: "session-1",
    messageId: "message-1",
    payload: {
      questionSetId: "questions-1",
      checkpointId: "checkpoint-1",
      questions: [{
        id: "question-1",
        question: "Which operating period should be used?",
        reason: "The root unit depends on it.",
        required: true
      }]
    }
  },
  runtime_status: {
    ...base,
    type: "runtime_status",
    source: "runtime",
    payload: { code: "SESSION_STARTED", message: "Agent session started." }
  },
  tool_call: {
    ...base,
    type: "tool_call",
    source: "tool_gateway",
    correlationId: "call-1",
    payload: {
      externalCallId: "call-1",
      toolName: "vdt.add_driver",
      argsHash: hashA,
      replay: false
    }
  },
  tool_result: {
    ...base,
    type: "tool_result",
    source: "tool_gateway",
    correlationId: "call-1",
    payload: {
      externalCallId: "call-1",
      toolName: "vdt.add_driver",
      status: "succeeded",
      resultCode: "APPLIED",
      resultHash: hashA,
      retryable: false
    }
  },
  approval_required: {
    ...base,
    type: "approval_required",
    source: "tool_gateway",
    correlationId: "call-1",
    payload: {
      approvalId: "approval-1",
      externalCallId: "call-1",
      proposalId: "proposal-1",
      proposalBasisHash: hashA,
      summary: "Apply the proposed graph changes."
    }
  },
  checkpoint: {
    ...base,
    type: "checkpoint",
    source: "runtime",
    payload: {
      checkpointId: "checkpoint-1",
      checkpointHash: hashA,
      reason: "tool_result",
      sessionEpoch: 1
    }
  },
  warning: {
    ...base,
    type: "warning",
    source: "runtime",
    payload: {
      code: "RECOVERY_REQUIRED",
      message: "The original session must be resumed.",
      retryable: true,
      detailsHash: null
    }
  },
  final: {
    ...base,
    type: "final",
    source: "external_agent",
    sessionId: "session-1",
    messageId: "message-final",
    payload: {
      text: "The value-driver tree is ready.",
      format: "markdown",
      finishReceiptId: "finish-1",
      finishReceiptHash: hashA
    }
  },
  error: {
    ...base,
    type: "error",
    source: "tool_gateway",
    payload: {
      code: "TOOL_SCHEMA_INVALID",
      message: "The tool arguments did not match the schema.",
      retryable: true,
      detailsHash: hashA
    }
  }
};

describe("AgentRunEventV2", () => {
  it("accepts every declared type with every permitted source", () => {
    for (const [source, types] of Object.entries(AGENT_RUN_EVENT_V2_SOURCE_TYPES)) {
      for (const type of types) {
        expect(agentRunEventV2Schema.safeParse({
          ...samples[type],
          source
        }).success, `${source}/${type}`).toBe(true);
      }
    }
  });

  it("rejects every type/source pair outside the normative matrix", () => {
    const sources = Object.keys(AGENT_RUN_EVENT_V2_SOURCE_TYPES) as AgentRunEventV2Source[];
    for (const [type, sample] of Object.entries(samples) as [AgentRunEventV2Type, Record<string, unknown>][]) {
      for (const source of sources) {
        const allowed = (AGENT_RUN_EVENT_V2_SOURCE_TYPES[source] as readonly string[]).includes(type);
        expect(agentRunEventV2Schema.safeParse({ ...sample, source }).success, `${source}/${type}`)
          .toBe(allowed);
      }
    }
  });

  it("stores completed messages, not streaming deltas", () => {
    expect(agentRunEventV2Schema.safeParse({
      ...samples.assistant_message,
      payload: {
        text: "partial",
        format: "markdown",
        completed: false
      }
    }).success).toBe(false);
    expect(agentRunEventV2Schema.safeParse({
      ...base,
      type: "assistant_message_delta",
      source: "external_agent",
      payload: { delta: "partial" }
    }).success).toBe(false);
  });

  it("requires a contiguous previous-hash link", () => {
    expect(agentRunEventV2Schema.safeParse({
      ...samples.runtime_status,
      seq: 2,
      previousHash: null
    }).success).toBe(false);
    expect(agentRunEventV2Schema.safeParse({
      ...samples.runtime_status,
      seq: 2,
      previousHash: hashA
    }).success).toBe(true);
  });

  it("rejects unknown envelope and payload fields", () => {
    expect(agentRunEventV2Schema.safeParse({
      ...samples.runtime_status,
      providerConfig: { apiKey: "must-not-be-logged" }
    }).success).toBe(false);
    expect(agentRunEventV2Schema.safeParse({
      ...samples.runtime_status,
      payload: {
        code: "SESSION_STARTED",
        message: "Agent session started.",
        rawPrompt: "must-not-be-logged"
      }
    }).success).toBe(false);
  });
});
