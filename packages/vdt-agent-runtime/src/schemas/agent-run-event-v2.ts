import { z } from "zod";
import { agentQuestionSchema } from "./agent-event";

const nonEmptyString = (max: number) => z.string().trim().min(1).max(max);
const safeIdSchema = nonEmptyString(200).regex(
  /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/,
  "Must use only letters, numbers, dots, colons, underscores, or hyphens."
);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const agentRunEventV2TypeSchema = z.enum([
  "assistant_message",
  "question",
  "runtime_status",
  "tool_call",
  "tool_result",
  "approval_required",
  "checkpoint",
  "warning",
  "final",
  "error"
]);

export const agentRunEventV2SourceSchema = z.enum([
  "external_agent",
  "vdt_agent",
  "runtime",
  "tool_gateway"
]);

export type AgentRunEventV2Type = z.infer<typeof agentRunEventV2TypeSchema>;
export type AgentRunEventV2Source = z.infer<typeof agentRunEventV2SourceSchema>;

/**
 * This matrix is normative. Agent-authored prose and runtime facts are never
 * interchangeable, even when they render in the same activity panel.
 */
export const AGENT_RUN_EVENT_V2_SOURCE_TYPES = {
  external_agent: ["assistant_message", "question", "final"],
  vdt_agent: ["assistant_message", "question", "final"],
  runtime: ["runtime_status", "checkpoint", "warning", "error"],
  tool_gateway: ["tool_call", "tool_result", "approval_required", "warning", "error"]
} as const satisfies Record<AgentRunEventV2Source, readonly AgentRunEventV2Type[]>;

const commonEventShape = {
  schemaVersion: z.literal(2),
  id: safeIdSchema,
  runId: safeIdSchema,
  seq: z.number().int().positive(),
  previousHash: sha256Schema.nullable(),
  hash: sha256Schema,
  timestamp: z.string().datetime({ offset: true }),
  sessionId: safeIdSchema.optional(),
  turnId: safeIdSchema.optional(),
  correlationId: safeIdSchema.optional(),
  messageId: safeIdSchema.optional()
} as const;

const agentSourceSchema = z.enum(["external_agent", "vdt_agent"]);
const warningOrErrorSourceSchema = z.enum(["runtime", "tool_gateway"]);

const assistantMessageEventSchema = z.object({
  ...commonEventShape,
  type: z.literal("assistant_message"),
  source: agentSourceSchema,
  sessionId: safeIdSchema,
  messageId: safeIdSchema,
  payload: z.object({
    text: nonEmptyString(8_000),
    format: z.enum(["plain_text", "markdown"]),
    completed: z.literal(true)
  }).strict()
}).strict();

const questionEventSchema = z.object({
  ...commonEventShape,
  type: z.literal("question"),
  source: agentSourceSchema,
  sessionId: safeIdSchema,
  messageId: safeIdSchema,
  payload: z.object({
    questionSetId: safeIdSchema,
    checkpointId: safeIdSchema,
    questions: z.array(agentQuestionSchema.strict()).min(1).max(5)
  }).strict()
}).strict();

const runtimeStatusEventSchema = z.object({
  ...commonEventShape,
  type: z.literal("runtime_status"),
  source: z.literal("runtime"),
  payload: z.object({
    code: safeIdSchema,
    message: nonEmptyString(1_000),
    state: nonEmptyString(120).optional(),
    progress: z.object({
      completed: z.number().int().nonnegative(),
      total: z.number().int().positive()
    }).strict().optional()
  }).strict()
}).strict();

const toolCallEventSchema = z.object({
  ...commonEventShape,
  type: z.literal("tool_call"),
  source: z.literal("tool_gateway"),
  correlationId: safeIdSchema,
  payload: z.object({
    externalCallId: safeIdSchema,
    toolName: nonEmptyString(160),
    argsHash: sha256Schema,
    replay: z.boolean()
  }).strict()
}).strict();

const toolResultEventSchema = z.object({
  ...commonEventShape,
  type: z.literal("tool_result"),
  source: z.literal("tool_gateway"),
  correlationId: safeIdSchema,
  payload: z.object({
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
    retryable: z.boolean()
  }).strict()
}).strict();

const approvalRequiredEventSchema = z.object({
  ...commonEventShape,
  type: z.literal("approval_required"),
  source: z.literal("tool_gateway"),
  correlationId: safeIdSchema,
  payload: z.object({
    approvalId: safeIdSchema,
    externalCallId: safeIdSchema,
    proposalId: safeIdSchema,
    proposalBasisHash: sha256Schema,
    summary: nonEmptyString(1_000)
  }).strict()
}).strict();

const checkpointEventSchema = z.object({
  ...commonEventShape,
  type: z.literal("checkpoint"),
  source: z.literal("runtime"),
  payload: z.object({
    checkpointId: safeIdSchema,
    checkpointHash: sha256Schema,
    reason: z.enum([
      "engine_exchange",
      "tool_call",
      "tool_result",
      "waiting_user",
      "waiting_approval",
      "manual_reconciliation",
      "human_input_accepted",
      "finish_verified",
      "recovery"
    ]),
    sessionEpoch: z.number().int().positive()
  }).strict()
}).strict();

const warningEventSchema = z.object({
  ...commonEventShape,
  type: z.literal("warning"),
  source: warningOrErrorSourceSchema,
  payload: z.object({
    code: safeIdSchema,
    message: nonEmptyString(2_000),
    retryable: z.boolean(),
    detailsHash: sha256Schema.nullable()
  }).strict()
}).strict();

const finalEventSchema = z.object({
  ...commonEventShape,
  type: z.literal("final"),
  source: agentSourceSchema,
  sessionId: safeIdSchema,
  messageId: safeIdSchema,
  payload: z.object({
    text: nonEmptyString(8_000),
    format: z.enum(["plain_text", "markdown"]),
    finishReceiptId: safeIdSchema,
    finishReceiptHash: sha256Schema
  }).strict()
}).strict();

const errorEventSchema = z.object({
  ...commonEventShape,
  type: z.literal("error"),
  source: warningOrErrorSourceSchema,
  payload: z.object({
    code: safeIdSchema,
    message: nonEmptyString(2_000),
    retryable: z.boolean(),
    detailsHash: sha256Schema.nullable()
  }).strict()
}).strict();

export const agentRunEventV2Schema = z.union([
  assistantMessageEventSchema,
  questionEventSchema,
  runtimeStatusEventSchema,
  toolCallEventSchema,
  toolResultEventSchema,
  approvalRequiredEventSchema,
  checkpointEventSchema,
  warningEventSchema,
  finalEventSchema,
  errorEventSchema
]).superRefine((value, ctx) => {
  if (value.seq === 1 && value.previousHash !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["previousHash"],
      message: "The first event in a run must have a null previousHash."
    });
  }
  if (value.seq > 1 && value.previousHash === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["previousHash"],
      message: "Events after sequence 1 must link to the previous event hash."
    });
  }
});

export type AgentRunEventV2 = z.infer<typeof agentRunEventV2Schema>;
