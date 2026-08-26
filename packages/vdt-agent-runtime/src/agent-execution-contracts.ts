import { z } from "zod";

const nonEmptyString = (max: number) => z.string().trim().min(1).max(max);
const safeIdSchema = nonEmptyString(160).regex(
  /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/,
  "Must use only letters, numbers, dots, colons, underscores, or hyphens."
);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });

export const agentExecutionProfileSchema = z.enum([
  "external_cli_agent",
  "model_agent"
]);

export const agentSessionStrategySchema = z.enum([
  "native",
  "checkpoint_resume",
  "structured_turn"
]);

export const agentToolIsolationSchema = z.enum([
  "unverified",
  "permission_only",
  "hard_verified"
]);

export const agentQualificationStatusSchema = z.enum([
  "unverified",
  "qualified",
  "rejected",
  "revoked"
]);

export const agentPlatformSchema = z.object({
  os: nonEmptyString(80),
  arch: nonEmptyString(80),
  runtimeVersion: nonEmptyString(120).nullable()
}).strict();

export const agentQualificationSchema = z.object({
  status: agentQualificationStatusSchema,
  platform: agentPlatformSchema,
  testedAt: timestampSchema.nullable(),
  evidenceHash: sha256Schema.nullable()
}).strict().superRefine((value, ctx) => {
  if (value.status === "qualified" && value.testedAt === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["testedAt"],
      message: "A qualified capability must include testedAt."
    });
  }
  if (value.status === "qualified" && value.evidenceHash === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceHash"],
      message: "A qualified capability must include evidenceHash."
    });
  }
});

const capabilityFlagsShape = {
  supportsNativeSession: z.boolean(),
  supportsResume: z.boolean(),
  supportsStructuredEvents: z.boolean(),
  supportsToolBridge: z.boolean(),
  supportsQuestions: z.boolean(),
  supportsCancellation: z.boolean(),
  supportsUsageMetrics: z.boolean()
} as const;

const capabilityCommonShape = {
  schemaVersion: z.literal(1),
  engineId: safeIdSchema,
  engineAdapterId: safeIdSchema,
  backendId: safeIdSchema,
  protocolVersion: nonEmptyString(120),
  sessionStrategy: agentSessionStrategySchema,
  toolCatalogHash: sha256Schema,
  toolIsolation: agentToolIsolationSchema,
  qualification: agentQualificationSchema,
  ...capabilityFlagsShape
} as const;

const externalAgentCapabilitySchema = z.object({
  ...capabilityCommonShape,
  executionProfile: z.literal("external_cli_agent"),
  cli: z.object({
    name: nonEmptyString(120),
    version: nonEmptyString(120)
  }).strict()
}).strict().superRefine((value, ctx) => {
  if (value.sessionStrategy === "structured_turn") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sessionStrategy"],
      message: "The external_cli_agent profile must use native or checkpoint_resume."
    });
  }
  if (value.sessionStrategy === "native" && !value.supportsNativeSession) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["supportsNativeSession"],
      message: "A native external session must advertise supportsNativeSession."
    });
  }
  if (value.sessionStrategy === "checkpoint_resume" && !value.supportsResume) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["supportsResume"],
      message: "A checkpoint_resume external session must advertise supportsResume."
    });
  }
  if (!value.supportsStructuredEvents || !value.supportsToolBridge) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [!value.supportsStructuredEvents ? "supportsStructuredEvents" : "supportsToolBridge"],
      message: "External execution requires structured events and the VDT-only tool bridge."
    });
  }
  if (
    value.toolIsolation === "hard_verified"
    && value.qualification.status !== "qualified"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toolIsolation"],
      message: "hard_verified isolation requires a qualified capability."
    });
  }
});

const modelAgentCapabilitySchema = z.object({
  ...capabilityCommonShape,
  executionProfile: z.literal("model_agent"),
  cli: z.null()
}).strict().superRefine((value, ctx) => {
  if (value.sessionStrategy !== "structured_turn") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sessionStrategy"],
      message: "The model_agent profile must use structured_turn."
    });
  }
  if (!value.supportsStructuredEvents || !value.supportsToolBridge) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [!value.supportsStructuredEvents ? "supportsStructuredEvents" : "supportsToolBridge"],
      message: "Model-agent execution requires structured events and the VDT-only tool bridge."
    });
  }
});

export const agentCapabilityProfileSchema = z.union([
  externalAgentCapabilitySchema,
  modelAgentCapabilitySchema
]);

export type AgentExecutionProfile = z.infer<typeof agentExecutionProfileSchema>;
export type AgentSessionStrategy = z.infer<typeof agentSessionStrategySchema>;
export type AgentToolIsolation = z.infer<typeof agentToolIsolationSchema>;
export type AgentCapabilityProfile = z.infer<typeof agentCapabilityProfileSchema>;

export const agentSessionBindingSchema = z.object({
  schemaVersion: z.literal(2),
  bindingId: safeIdSchema,
  runId: safeIdSchema,
  projectId: safeIdSchema,
  executionProfile: agentExecutionProfileSchema,
  engineId: safeIdSchema,
  engineAdapterId: safeIdSchema,
  backendId: safeIdSchema,
  modelId: nonEmptyString(160),
  protocolVersion: nonEmptyString(120),
  cliVersion: nonEmptyString(120).nullable(),
  toolIsolation: agentToolIsolationSchema,
  qualificationStatus: agentQualificationStatusSchema,
  capabilityEvidenceHash: sha256Schema.nullable(),
  settingsHash: sha256Schema,
  capabilityProfileHash: sha256Schema,
  toolCatalogHash: sha256Schema,
  externalSessionId: nonEmptyString(512).nullable(),
  sessionEpoch: z.number().int().positive(),
  boundAt: timestampSchema
}).strict().superRefine((value, ctx) => {
  if (value.executionProfile === "external_cli_agent" && value.cliVersion === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cliVersion"],
      message: "An external CLI binding must pin the CLI version."
    });
  }
  if (value.executionProfile === "model_agent" && value.cliVersion !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cliVersion"],
      message: "A model-agent binding cannot claim a CLI version."
    });
  }
  if (value.qualificationStatus === "qualified" && value.capabilityEvidenceHash === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["capabilityEvidenceHash"],
      message: "A qualified binding must pin its capability evidence hash."
    });
  }
});

const checkpointCursorSchema = z.object({
  cursor: nonEmptyString(512),
  contentHash: sha256Schema
}).strict();

const activeExchangeSchema = z.object({
  exchangeId: safeIdSchema,
  stableCallKey: safeIdSchema,
  state: z.enum(["prepared", "in_flight", "completed", "failed", "ambiguous"])
}).strict();

const activeToolCallSchema = z.object({
  externalCallId: safeIdSchema,
  toolName: nonEmptyString(160),
  state: z.enum(["reserved", "in_flight", "completed", "failed", "ambiguous"])
}).strict();

const finishCheckpointSchema = z.object({
  receiptId: safeIdSchema,
  state: z.enum(["verified", "final_persisted"]),
  receiptHash: sha256Schema
}).strict();

export const agentHumanInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_answer"),
    questionSetId: nonEmptyString(160),
    answers: z.record(z.string(), z.unknown())
  }).strict(),
  z.object({
    type: z.literal("user_instruction"),
    text: nonEmptyString(8_000)
  }).strict()
]);

export const agentEngineCheckpointSchema = z.object({
  schemaVersion: z.literal(2),
  checkpointId: safeIdSchema,
  bindingId: safeIdSchema,
  runId: safeIdSchema,
  sessionEpoch: z.number().int().positive(),
  externalSessionId: nonEmptyString(512).nullable(),
  lastConfirmedInput: checkpointCursorSchema.nullable(),
  lastConfirmedOutput: checkpointCursorSchema.nullable(),
  activeExchange: activeExchangeSchema.nullable(),
  activeToolCall: activeToolCallSchema.nullable(),
  finishReceipt: finishCheckpointSchema.nullable(),
  /** Inputs accepted by the Supervisor but not yet confirmed by an engine
   * exchange. Optional keeps previously persisted Sequence 4 checkpoints
   * readable while making new acknowledgements crash-safe. */
  pendingHumanInputs: z.array(agentHumanInputSchema).max(20).optional(),
  createdAt: timestampSchema
}).strict();

export type AgentSessionBinding = z.infer<typeof agentSessionBindingSchema>;
export type AgentEngineCheckpoint = z.infer<typeof agentEngineCheckpointSchema>;

const MODEL_CONTROLLED_AUTHORITY_KEYS = new Set([
  "actor",
  "backendid",
  "bindingid",
  "capabilityevidencehash",
  "capabilityprofilehash",
  "engineadapterid",
  "enginebindingid",
  "expecteddraftrevision",
  "expectedrevision",
  "externalsessionid",
  "idempotencykey",
  "leasegeneration",
  "leasetoken",
  "modelid",
  "ownertoken",
  "permission",
  "permissions",
  "projectid",
  "revision",
  "runid",
  "sessionepoch",
  "sessionid",
  "settingshash",
  "toolcataloghash"
]);

function normalizedAuthorityKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findModelControlledAuthorityKey(
  value: unknown,
  path: Array<string | number> = [],
  visited: WeakSet<object> = new WeakSet()
): Array<string | number> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (visited.has(value)) return undefined;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findModelControlledAuthorityKey(entry, [...path, index], visited);
      if (found) return found;
    }
    return undefined;
  }

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = [...path, key];
    if (MODEL_CONTROLLED_AUTHORITY_KEYS.has(normalizedAuthorityKey(key))) {
      return entryPath;
    }
    const found = findModelControlledAuthorityKey(entry, entryPath, visited);
    if (found) return found;
  }
  return undefined;
}

export const vdtGatewayToolCallSchema = z.object({
  externalCallId: safeIdSchema,
  toolName: nonEmptyString(160),
  args: z.record(z.unknown())
}).strict().superRefine((value, ctx) => {
  const authorityPath = findModelControlledAuthorityKey(value.args);
  if (authorityPath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["args", ...authorityPath],
      message: "Run authority is server-owned and cannot be supplied in tool arguments."
    });
  }
});

export const vdtGatewayToolResultSchema = z.object({
  externalCallId: safeIdSchema,
  toolName: nonEmptyString(160),
  status: z.enum([
    "succeeded",
    "failed",
    "replayed",
    "waiting_user",
    "waiting_approval"
  ]),
  resultCode: nonEmptyString(160),
  resultHash: sha256Schema,
  payload: z.unknown()
}).strict();

const CONTROL_TOOLS = new Set([
  "user.ask",
  "approval.request",
  "user.request_approval",
  "run.request_finish"
]);

export const agentActionBatchSchema = z.object({
  calls: z.array(vdtGatewayToolCallSchema).min(1).max(6)
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  for (const [index, call] of value.calls.entries()) {
    if (ids.has(call.externalCallId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["calls", index, "externalCallId"],
        message: "externalCallId must be unique within an ActionBatch."
      });
    }
    ids.add(call.externalCallId);
  }

  if (value.calls.length > 1) {
    for (const [index, call] of value.calls.entries()) {
      if (CONTROL_TOOLS.has(call.toolName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["calls", index, "toolName"],
          message: "Question, approval, and finish calls must be the only call in a batch."
        });
      }
    }
  }
});

export type VdtGatewayToolCall = z.infer<typeof vdtGatewayToolCallSchema>;
export type VdtGatewayToolResult = z.infer<typeof vdtGatewayToolResultSchema>;
export type AgentActionBatch = z.infer<typeof agentActionBatchSchema>;

export interface AgentCapabilityQualificationRequirement {
  engineAdapterId: string;
  backendId: string;
  cliVersion: string;
  protocolVersion: string;
  toolCatalogHash: string;
  platform: AgentCapabilityProfile["qualification"]["platform"];
}

export type AgentCapabilityUnavailableReason =
  | "PROFILE_NOT_EXTERNAL"
  | "QUALIFICATION_NOT_CURRENT"
  | "TOOL_ISOLATION_NOT_HARD_VERIFIED"
  | "ADAPTER_MISMATCH"
  | "BACKEND_MISMATCH"
  | "CLI_VERSION_MISMATCH"
  | "PROTOCOL_VERSION_MISMATCH"
  | "TOOL_CATALOG_HASH_MISMATCH"
  | "PLATFORM_MISMATCH";

export interface AgentCapabilityAvailability {
  available: boolean;
  reasons: AgentCapabilityUnavailableReason[];
}

/**
 * External execution is fail-closed. A stored qualification is usable only for
 * the exact adapter, backend, CLI, protocol, tool catalog, and platform that
 * produced its evidence.
 */
export function assessExternalAgentCapability(
  capability: AgentCapabilityProfile,
  requirement: AgentCapabilityQualificationRequirement
): AgentCapabilityAvailability {
  const reasons: AgentCapabilityUnavailableReason[] = [];
  if (capability.executionProfile !== "external_cli_agent") {
    reasons.push("PROFILE_NOT_EXTERNAL");
    return { available: false, reasons };
  }
  if (capability.qualification.status !== "qualified") {
    reasons.push("QUALIFICATION_NOT_CURRENT");
  }
  if (capability.toolIsolation !== "hard_verified") {
    reasons.push("TOOL_ISOLATION_NOT_HARD_VERIFIED");
  }
  if (capability.engineAdapterId !== requirement.engineAdapterId) {
    reasons.push("ADAPTER_MISMATCH");
  }
  if (capability.backendId !== requirement.backendId) {
    reasons.push("BACKEND_MISMATCH");
  }
  if (capability.cli.version !== requirement.cliVersion) {
    reasons.push("CLI_VERSION_MISMATCH");
  }
  if (capability.protocolVersion !== requirement.protocolVersion) {
    reasons.push("PROTOCOL_VERSION_MISMATCH");
  }
  if (capability.toolCatalogHash !== requirement.toolCatalogHash) {
    reasons.push("TOOL_CATALOG_HASH_MISMATCH");
  }
  if (
    capability.qualification.platform.os !== requirement.platform.os
    || capability.qualification.platform.arch !== requirement.platform.arch
    || capability.qualification.platform.runtimeVersion !== requirement.platform.runtimeVersion
  ) {
    reasons.push("PLATFORM_MISMATCH");
  }
  return { available: reasons.length === 0, reasons };
}

export interface AgentEngineStart {
  binding: AgentSessionBinding;
  initialContext: Readonly<Record<string, unknown>>;
  initialContextHash: string;
}

export type AgentHumanInput = z.infer<typeof agentHumanInputSchema>;

export type AgentEngineEvent =
  | {
      type: "assistant_message_delta";
      messageId: string;
      delta: string;
    }
  | {
      type: "assistant_message";
      messageId: string;
      text: string;
    }
  | {
      type: "question";
      messageId: string;
      questionSetId: string;
      questions: readonly Readonly<Record<string, unknown>>[];
    }
  | {
      type: "tool_request";
      call: VdtGatewayToolCall;
    }
  | {
      type: "checkpoint_requested";
      reason: string;
    }
  | {
      type: "final";
      messageId: string;
      finishReceiptId: string;
      text: string;
    }
  | {
      type: "transport_error";
      code: string;
      message: string;
      retryable: boolean;
    }
  | {
      type: "usage";
      metrics: Readonly<Record<string, number | null>>;
    };

export interface AgentEngineHost {
  readonly signal: AbortSignal;
  executeTool(call: VdtGatewayToolCall): Promise<VdtGatewayToolResult>;
}

export interface AgentRunSession {
  readonly binding: AgentSessionBinding;
  events(): AsyncIterable<AgentEngineEvent>;
  submit(input: AgentHumanInput): Promise<void>;
  checkpoint(): Promise<AgentEngineCheckpoint>;
  cancel(reason: string): Promise<void>;
  close(): Promise<void>;
}

export interface AgentExecutionEngine {
  readonly capability: AgentCapabilityProfile;
  openSession(start: AgentEngineStart, host: AgentEngineHost): Promise<AgentRunSession>;
  resumeSession(
    checkpoint: AgentEngineCheckpoint,
    host: AgentEngineHost
  ): Promise<AgentRunSession>;
}

export interface ExternalCliAgentEngine extends AgentExecutionEngine {
  readonly capability: Extract<
    AgentCapabilityProfile,
    { executionProfile: "external_cli_agent" }
  >;
}

export interface InProductModelAgentEngine extends AgentExecutionEngine {
  readonly capability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }>;
}
