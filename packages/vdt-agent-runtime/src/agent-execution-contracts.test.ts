import { describe, expect, it } from "vitest";
import {
  agentActionBatchSchema,
  agentCapabilityProfileSchema,
  agentEngineCheckpointSchema,
  agentSessionBindingSchema,
  assessExternalAgentCapability,
  vdtGatewayToolCallSchema
} from "./agent-execution-contracts";

const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const testedAt = "2026-08-26T06:00:00.000Z";

const externalCapability = {
  schemaVersion: 1 as const,
  executionProfile: "external_cli_agent" as const,
  engineId: "cursor-acp",
  engineAdapterId: "cursor-acp-v1",
  backendId: "cursor",
  cli: { name: "cursor-agent", version: "2026.08.11" },
  protocolVersion: "acp-0.12",
  sessionStrategy: "native" as const,
  toolCatalogHash: hashA,
  toolIsolation: "hard_verified" as const,
  qualification: {
    status: "qualified" as const,
    platform: { os: "darwin", arch: "arm64", runtimeVersion: "node-24.15.0" },
    testedAt,
    evidenceHash: hashB
  },
  supportsNativeSession: true,
  supportsResume: true,
  supportsStructuredEvents: true,
  supportsToolBridge: true,
  supportsQuestions: true,
  supportsCancellation: true,
  supportsUsageMetrics: false
};

describe("agent execution contracts", () => {
  it("accepts a hard-qualified external capability for the exact evidence tuple", () => {
    const capability = agentCapabilityProfileSchema.parse(externalCapability);
    expect(assessExternalAgentCapability(capability, {
      engineAdapterId: "cursor-acp-v1",
      backendId: "cursor",
      cliVersion: "2026.08.11",
      protocolVersion: "acp-0.12",
      toolCatalogHash: hashA,
      platform: { os: "darwin", arch: "arm64", runtimeVersion: "node-24.15.0" }
    })).toEqual({ available: true, reasons: [] });
  });

  it("fails closed when a qualified CLI or tool catalog drifts", () => {
    const capability = agentCapabilityProfileSchema.parse(externalCapability);
    expect(assessExternalAgentCapability(capability, {
      engineAdapterId: "cursor-acp-v1",
      backendId: "cursor",
      cliVersion: "2026.08.12",
      protocolVersion: "acp-0.12",
      toolCatalogHash: hashB,
      platform: { os: "darwin", arch: "arm64", runtimeVersion: "node-24.15.0" }
    })).toEqual({
      available: false,
      reasons: ["CLI_VERSION_MISMATCH", "TOOL_CATALOG_HASH_MISMATCH"]
    });
  });

  it("does not let permission-only isolation qualify an external profile", () => {
    const capability = agentCapabilityProfileSchema.parse({
      ...externalCapability,
      toolIsolation: "permission_only"
    });
    const availability = assessExternalAgentCapability(capability, {
      engineAdapterId: capability.engineAdapterId,
      backendId: capability.backendId,
      cliVersion: externalCapability.cli.version,
      protocolVersion: capability.protocolVersion,
      toolCatalogHash: capability.toolCatalogHash,
      platform: capability.qualification.platform
    });
    expect(availability).toEqual({
      available: false,
      reasons: ["TOOL_ISOLATION_NOT_HARD_VERIFIED"]
    });
  });

  it("requires qualification evidence before isolation can be hard-verified", () => {
    expect(agentCapabilityProfileSchema.safeParse({
      ...externalCapability,
      qualification: {
        ...externalCapability.qualification,
        status: "unverified",
        testedAt: null,
        evidenceHash: null
      }
    }).success).toBe(false);
  });

  it("represents a model agent without pretending it is a CLI", () => {
    expect(agentCapabilityProfileSchema.parse({
      ...externalCapability,
      executionProfile: "model_agent",
      engineId: "in-product-model-agent",
      engineAdapterId: "structured-http-v1",
      backendId: "azure-openai",
      cli: null,
      sessionStrategy: "structured_turn",
      toolIsolation: "permission_only"
    })).toMatchObject({
      executionProfile: "model_agent",
      cli: null,
      sessionStrategy: "structured_turn"
    });
  });

  it("rejects profile strategies that cannot preserve the declared session/tool boundary", () => {
    expect(agentCapabilityProfileSchema.safeParse({
      ...externalCapability,
      sessionStrategy: "structured_turn"
    }).success).toBe(false);
    expect(agentCapabilityProfileSchema.safeParse({
      ...externalCapability,
      supportsToolBridge: false
    }).success).toBe(false);
    expect(agentCapabilityProfileSchema.safeParse({
      ...externalCapability,
      executionProfile: "model_agent",
      engineId: "in-product-model-agent",
      engineAdapterId: "structured-http-v1",
      backendId: "azure-openai",
      cli: null,
      sessionStrategy: "structured_turn",
      supportsStructuredEvents: false
    }).success).toBe(false);
  });

  it("keeps all run authority out of model-authored gateway calls", () => {
    const valid = {
      externalCallId: "call-1",
      toolName: "vdt.add_driver",
      args: { parentId: "root" }
    };
    expect(vdtGatewayToolCallSchema.parse(valid)).toEqual(valid);
    expect(vdtGatewayToolCallSchema.safeParse({
      ...valid,
      runId: "model-controlled-run"
    }).success).toBe(false);
    expect(vdtGatewayToolCallSchema.safeParse({
      ...valid,
      args: {
        parentId: "root",
        overrides: [{ nodeId: "haulage", expected_revision: 42 }]
      }
    }).success).toBe(false);
  });

  it("accepts only 1..6 unique sequential calls and isolates control calls", () => {
    const call = (externalCallId: string, toolName = "vdt.add_driver") => ({
      externalCallId,
      toolName,
      args: {}
    });

    expect(agentActionBatchSchema.parse({ calls: [call("call-1")] }).calls).toHaveLength(1);
    expect(agentActionBatchSchema.safeParse({
      calls: [call("call-1"), call("call-1")]
    }).success).toBe(false);
    expect(agentActionBatchSchema.safeParse({
      calls: [call("call-1", "run.request_finish"), call("call-2")]
    }).success).toBe(false);
    expect(agentActionBatchSchema.safeParse({
      calls: [call("call-1", "user.request_approval"), call("call-2")]
    }).success).toBe(false);
    expect(agentActionBatchSchema.safeParse({
      calls: Array.from({ length: 7 }, (_, index) => call(`call-${index}`))
    }).success).toBe(false);
  });

  it("strictly validates immutable session bindings and resumable checkpoints", () => {
    const binding = agentSessionBindingSchema.parse({
      schemaVersion: 2,
      bindingId: "binding-1",
      runId: "run-1",
      projectId: "project-1",
      executionProfile: "external_cli_agent",
      engineId: "cursor-acp",
      engineAdapterId: "cursor-acp-v1",
      backendId: "cursor",
      modelId: "grok-4.6-medium",
      protocolVersion: "acp-v1",
      cliVersion: "2026.08",
      toolIsolation: "hard_verified",
      qualificationStatus: "qualified",
      capabilityEvidenceHash: hashB,
      settingsHash: hashA,
      capabilityProfileHash: hashB,
      toolCatalogHash: hashA,
      externalSessionId: "cursor-session-1",
      sessionEpoch: 1,
      boundAt: testedAt
    });

    expect(agentEngineCheckpointSchema.parse({
      schemaVersion: 2,
      checkpointId: "checkpoint-1",
      bindingId: binding.bindingId,
      runId: binding.runId,
      sessionEpoch: binding.sessionEpoch,
      externalSessionId: binding.externalSessionId,
      lastConfirmedInput: { cursor: "input-7", contentHash: hashA },
      lastConfirmedOutput: { cursor: "output-6", contentHash: hashB },
      activeExchange: null,
      activeToolCall: null,
      finishReceipt: null,
      createdAt: testedAt
    })).toMatchObject({ bindingId: "binding-1", externalSessionId: "cursor-session-1" });
  });
});
