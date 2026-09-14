import { createHash } from "node:crypto";
import { AGENT_QUESTION_SCHEMA_KEYS } from "@vdt-studio/vdt-agent-runtime";
import { parseCheckpointActionBatch, type CheckpointActionBatch } from "./action-batch";
import { collectCheckpointEnvelopeCandidates, type CheckpointEnvelopeCandidate } from "./checkpoint-envelope";
import { safeProtocolLabel } from "./checkpoint-protocol-reporting";
import { summarizeDroppedQuestionKeys } from "./checkpoint-protocol-reporting";

export const CHECKPOINT_DROPPED_QUESTION_KEYS_ARG = "__vdtDroppedQuestionKeys";

const DEFAULT_MAX_PROMPT_BYTES = 1024 * 1024;
const MAX_ASSISTANT_TEXT_BYTES = 64 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

export interface CheckpointAssistantMessage {
  readonly messageId: string;
  readonly text: string;
}

export type CheckpointTurn =
  | {
      readonly protocolVersion: string;
      readonly assistantMessage: CheckpointAssistantMessage | null;
      readonly action: {
        readonly type: "action_batch";
        readonly batch: CheckpointActionBatch;
      };
    }
  | {
      readonly protocolVersion: string;
      readonly assistantMessage: CheckpointAssistantMessage | null;
      readonly action: {
        readonly type: "final";
        readonly messageId: string;
        readonly finishReceiptId: string;
        readonly text: string;
      };
    };

export interface ParseCheckpointTurnOptions {
  readonly protocolVersion: string;
  readonly allowedToolNames: readonly string[];
  readonly errorPrefix: string;
  readonly maxPromptBytes?: number;
}

function checkpointTurnError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], field: string, errorPrefix: string): void {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  if (keys.length !== required.length || keys.some((key, index) => key !== required[index])) {
    throw checkpointTurnError(
      `${errorPrefix}_PROTOCOL_INVALID`,
      `${field} must contain exactly: ${required.join(", ")}; received: ${keys.join(", ") || "<none>"}.`
    );
  }
}

function assertSafeId(value: unknown, field: string, errorPrefix: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw checkpointTurnError(`${errorPrefix}_PROTOCOL_INVALID`, `${field} is invalid.`);
  }
}

function assertText(
  value: unknown,
  field: string,
  errorPrefix: string,
  maxBytes = MAX_ASSISTANT_TEXT_BYTES
): asserts value is string {
  if (typeof value !== "string" || !value.trim() || byteLength(value) > maxBytes || value.includes("\0")) {
    throw checkpointTurnError(`${errorPrefix}_PROTOCOL_INVALID`, `${field} is invalid.`);
  }
}

interface NormalizedCheckpointQuestions {
  readonly questions: unknown;
  readonly droppedKeysByIndex: readonly { index: number; keys: readonly string[] }[];
}

function normalizeCheckpointQuestions(value: unknown): NormalizedCheckpointQuestions {
  if (!Array.isArray(value)) return { questions: value, droppedKeysByIndex: [] };
  const droppedKeysByIndex: { index: number; keys: string[] }[] = [];
  const questions = value.map((question, index) => {
    if (!isRecord(question)) return question;
    const { label, type, ...rest } = question;
    const normalized: Record<string, unknown> = { ...rest };
    if (normalized.question === undefined && typeof label === "string") {
      normalized.question = label;
    }
    if (normalized.expectedAnswerType === undefined && typeof type === "string") {
      normalized.expectedAnswerType = type;
    }
    const droppedKeys = Object.keys(normalized).filter((key) => !AGENT_QUESTION_SCHEMA_KEYS.has(key));
    for (const key of droppedKeys) delete normalized[key];
    if (droppedKeys.length > 0) droppedKeysByIndex.push({ index, keys: droppedKeys });
    const expectedAnswerType = normalized.expectedAnswerType === "enum" || normalized.expectedAnswerType === "choice"
      ? "single_choice"
      : normalized.expectedAnswerType;
    const options = Array.isArray(normalized.options)
      ? normalized.options.map((option) => {
          if (
            isRecord(option)
            && typeof option.id === "string"
            && typeof option.label === "string"
            && option.value === undefined
          ) {
            return { ...option, value: option.id };
          }
          return option;
        })
      : normalized.options;
    return {
      ...normalized,
      ...(expectedAnswerType !== undefined ? { expectedAnswerType } : {}),
      ...(options !== undefined ? { options } : {})
    };
  });
  return { questions, droppedKeysByIndex };
}

function attachNormalizedUserAskArgs(
  args: Record<string, unknown>
): Record<string, unknown> {
  const { questions, droppedKeysByIndex } = normalizeCheckpointQuestions(args.questions);
  const droppedSummary = summarizeDroppedQuestionKeys(droppedKeysByIndex);
  return {
    ...args,
    questions,
    ...(droppedSummary ? { [CHECKPOINT_DROPPED_QUESTION_KEYS_ARG]: droppedSummary } : {})
  };
}

const CANONICAL_CHECKPOINT_ACTION_TYPES = new Set(["action_batch", "user.ask", "final"]);
const ACTION_BATCH_TYPE_ALIASES = new Set(["tool_call", "tool_calls"]);

function normalizeCheckpointActionType(type: string): string {
  if (CANONICAL_CHECKPOINT_ACTION_TYPES.has(type)) return type;
  if (ACTION_BATCH_TYPE_ALIASES.has(type)) return "action_batch";
  return type;
}

function normalizeCheckpointActionBatch(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.calls)) return value;
  return {
    ...value,
    calls: value.calls.map((call) => {
      if (!isRecord(call) || call.toolName !== "user.ask" || !isRecord(call.args)) return call;
      return {
        ...call,
        args: attachNormalizedUserAskArgs(call.args)
      };
    })
  };
}

/** Lenient checkpoint-turn parser shared by Cursor, Codex, and Claude transports. */
export function parseCheckpointTurn(raw: string, options: ParseCheckpointTurnOptions): CheckpointTurn {
  const maxPromptBytes = options.maxPromptBytes ?? DEFAULT_MAX_PROMPT_BYTES;
  if (byteLength(raw) > maxPromptBytes) {
    throw checkpointTurnError(`${options.errorPrefix}_PROTOCOL_INVALID`, "Checkpoint response is too large.");
  }
  const trimmed = raw.trim();
  const candidates = collectCheckpointEnvelopeCandidates(raw);
  const parsed: Array<{ candidate: CheckpointEnvelopeCandidate; turn: CheckpointTurn }> = [];
  for (const candidate of candidates) {
    try {
      parsed.push({ candidate, turn: parseUnwrappedCheckpointTurn(candidate.payload, options) });
    } catch (error) {
      if (errorCodeOf(error)?.endsWith("_PROTOCOL_AMBIGUOUS")) throw error;
    }
  }
  if (parsed.length > 1) {
    throw checkpointTurnError(
      `${options.errorPrefix}_PROTOCOL_AMBIGUOUS`,
      `Checkpoint result is ambiguous: found ${parsed.length} candidate JSON objects.`
    );
  }
  if (parsed.length === 1) {
    return withInlineNarration(parsed[0]!.turn, trimmed, parsed[0]!.candidate);
  }
  if (candidates.length === 1) {
    return parseUnwrappedCheckpointTurn(candidates[0]!.payload, options);
  }
  throw checkpointTurnError(
    `${options.errorPrefix}_PROTOCOL_INVALID`,
    "Checkpoint result must be exactly one JSON object without prose or fences."
  );
}

/** Parse a payload that is already a single unwrapped JSON object. */
function parseUnwrappedCheckpointTurn(unwrapped: string, options: ParseCheckpointTurnOptions): CheckpointTurn {
  const { protocolVersion, allowedToolNames, errorPrefix } = options;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapped) as unknown;
  } catch {
    throw checkpointTurnError(
      `${errorPrefix}_PROTOCOL_INVALID`,
      "Checkpoint result must be exactly one JSON object without prose or fences."
    );
  }
  if (!isRecord(parsed)) {
    throw checkpointTurnError(`${errorPrefix}_PROTOCOL_INVALID`, "Checkpoint result must be a JSON object.");
  }
  assertExactKeys(parsed, ["action", "assistantMessage", "protocolVersion"], "checkpoint result", errorPrefix);
  if (parsed.protocolVersion !== protocolVersion) {
    throw checkpointTurnError(`${errorPrefix}_PROTOCOL_MISMATCH`, "Checkpoint protocol version changed or is unknown.");
  }
  if (!isRecord(parsed.action) || typeof parsed.action.type !== "string") {
    throw checkpointTurnError(`${errorPrefix}_PROTOCOL_INVALID`, "checkpoint result action is invalid.");
  }

  const actionType = normalizeCheckpointActionType(parsed.action.type);

  if (actionType === "action_batch") {
    const actionKeys = Object.keys(parsed.action).sort();
    const usesWrappedBatch = actionKeys.length === 2 && actionKeys[0] === "batch" && actionKeys[1] === "type";
    const usesDirectCalls = actionKeys.length === 2 && actionKeys[0] === "calls" && actionKeys[1] === "type";
    if (!usesWrappedBatch && !usesDirectCalls) {
      throw checkpointTurnError(
        `${errorPrefix}_PROTOCOL_INVALID`,
        `checkpoint result action must contain exactly type plus batch or calls; received: ${actionKeys.join(", ") || "<none>"}.`
      );
    }
    let assistantMessage: CheckpointAssistantMessage | null = null;
    if (parsed.assistantMessage !== null) {
      if (typeof parsed.assistantMessage === "string") {
        assertText(parsed.assistantMessage, "assistantMessage", errorPrefix, 8_000);
        assistantMessage = Object.freeze({
          messageId: `message-${createHash("sha256").update(parsed.assistantMessage, "utf8").digest("hex").slice(0, 24)}`,
          text: parsed.assistantMessage
        });
      } else if (!isRecord(parsed.assistantMessage)) {
        throw checkpointTurnError(
          `${errorPrefix}_PROTOCOL_INVALID`,
          `assistantMessage is invalid; received ${Array.isArray(parsed.assistantMessage) ? "array" : typeof parsed.assistantMessage}.`
        );
      } else {
        assertExactKeys(parsed.assistantMessage, ["messageId", "text"], "assistantMessage", errorPrefix);
        assertSafeId(parsed.assistantMessage.messageId, "assistantMessage.messageId", errorPrefix);
        assertText(parsed.assistantMessage.text, "assistantMessage.text", errorPrefix, 8_000);
        assistantMessage = Object.freeze({
          messageId: parsed.assistantMessage.messageId,
          text: parsed.assistantMessage.text
        });
      }
    }
    const batch = parseCheckpointActionBatch(
      normalizeCheckpointActionBatch(usesWrappedBatch ? parsed.action.batch : { calls: parsed.action.calls }),
      { allowedToolNames }
    );
    return Object.freeze({
      protocolVersion,
      assistantMessage,
      action: Object.freeze({ type: "action_batch", batch })
    });
  }

  if (actionType === "user.ask") {
    assertExactKeys(parsed.action, ["questions", "type"], "checkpoint user.ask action", errorPrefix);
    if (parsed.assistantMessage !== null && typeof parsed.assistantMessage !== "string") {
      throw checkpointTurnError(`${errorPrefix}_PROTOCOL_INVALID`, "user.ask assistantMessage must be text or null.");
    }
    if (typeof parsed.assistantMessage === "string") {
      assertText(parsed.assistantMessage, "assistantMessage", errorPrefix, 8_000);
    }
    const askArgs = attachNormalizedUserAskArgs({ questions: parsed.action.questions });
    const controlHash = createHash("sha256")
      .update(JSON.stringify(askArgs.questions), "utf8")
      .digest("hex")
      .slice(0, 24);
    const batch = parseCheckpointActionBatch({
      calls: [{
        externalCallId: `control-ask-${controlHash}`,
        toolName: "user.ask",
        args: askArgs
      }]
    }, { allowedToolNames });
    return Object.freeze({
      protocolVersion,
      assistantMessage: typeof parsed.assistantMessage === "string"
        ? Object.freeze({
            messageId: `message-${createHash("sha256").update(parsed.assistantMessage, "utf8").digest("hex").slice(0, 24)}`,
            text: parsed.assistantMessage
          })
        : null,
      action: Object.freeze({ type: "action_batch", batch })
    });
  }

  if (actionType === "final") {
    const finalKeys = Object.keys(parsed.action).sort();
    const canonicalFinal = finalKeys.length === 4
      && finalKeys[0] === "finishReceiptId"
      && finalKeys[1] === "messageId"
      && finalKeys[2] === "text"
      && finalKeys[3] === "type";
    const compactFinal = finalKeys.length === 2
      && finalKeys[0] === "finishReceiptId"
      && finalKeys[1] === "type"
      && typeof parsed.assistantMessage === "string";
    if (!canonicalFinal && !compactFinal) {
      throw checkpointTurnError(
        `${errorPrefix}_PROTOCOL_INVALID`,
        `checkpoint final action is invalid; received: ${finalKeys.join(", ") || "<none>"}.`
      );
    }
    if (canonicalFinal && parsed.assistantMessage !== null) {
      throw checkpointTurnError(`${errorPrefix}_PROTOCOL_INVALID`, "Final cannot duplicate assistantMessage.");
    }
    const finalText = compactFinal ? parsed.assistantMessage : parsed.action.text;
    assertText(finalText, "final.text", errorPrefix, 8_000);
    const finalMessageId = compactFinal
      ? `message-${createHash("sha256").update(finalText, "utf8").digest("hex").slice(0, 24)}`
      : parsed.action.messageId;
    assertSafeId(finalMessageId, "final.messageId", errorPrefix);
    assertSafeId(parsed.action.finishReceiptId, "final.finishReceiptId", errorPrefix);
    return Object.freeze({
      protocolVersion,
      assistantMessage: null,
      action: Object.freeze({
        type: "final",
        messageId: finalMessageId,
        finishReceiptId: parsed.action.finishReceiptId,
        text: finalText
      })
    });
  }

  throw checkpointTurnError(
    `${errorPrefix}_PROTOCOL_INVALID`,
    `Checkpoint action type is unknown: ${safeProtocolLabel(parsed.action.type)}.`
  );
}

/** Pick the unique agent message that parses as a checkpoint envelope.
 * Extra JSON envelopes are the same PROTOCOL_AMBIGUOUS case unwrap already uses.
 * Non-envelope messages stay as assistant narration in stream order. */
export function selectCheckpointTurnFromAgentMessages(
  messages: readonly string[],
  options: ParseCheckpointTurnOptions
): CheckpointTurn {
  if (messages.length === 0) {
    throw checkpointTurnError(
      `${options.errorPrefix}_PROTOCOL_INVALID`,
      "Checkpoint result must be exactly one JSON object without prose or fences."
    );
  }
  const parsed: Array<{ index: number; turn: CheckpointTurn }> = [];
  for (const [index, raw] of messages.entries()) {
    try {
      parsed.push({ index, turn: parseCheckpointTurn(raw, options) });
    } catch (error) {
      if (errorCodeOf(error)?.endsWith("_PROTOCOL_AMBIGUOUS")) throw error;
    }
  }
  if (parsed.length > 1) {
    throw checkpointTurnError(
      `${options.errorPrefix}_PROTOCOL_AMBIGUOUS`,
      `Checkpoint result is ambiguous: found ${parsed.length} candidate JSON objects.`
    );
  }
  if (parsed.length === 0) {
    if (messages.length === 1) return parseCheckpointTurn(messages[0]!, options);
    throw checkpointTurnError(
      `${options.errorPrefix}_PROTOCOL_INVALID`,
      "Checkpoint result must be exactly one JSON object without prose or fences."
    );
  }
  const winner = parsed[0]!;
  return withStreamNarration(winner.turn, messages, winner.index);
}

function withInlineNarration(
  turn: CheckpointTurn,
  source: string,
  winner: CheckpointEnvelopeCandidate
): CheckpointTurn {
  return withStreamNarration(turn, [
    source.slice(0, winner.start),
    source.slice(winner.start, winner.end),
    source.slice(winner.end)
  ], 1);
}

function withStreamNarration(
  turn: CheckpointTurn,
  messages: readonly string[],
  envelopeIndex: number
): CheckpointTurn {
  const parts: string[] = [];
  for (const [index, raw] of messages.entries()) {
    if (index === envelopeIndex) {
      const inner = turn.assistantMessage?.text?.trim();
      if (inner) parts.push(inner);
      continue;
    }
    const prose = raw.trim();
    if (prose) parts.push(prose);
  }
  if (parts.length === 0) return turn;
  const text = parts.join("\n\n");
  if (turn.assistantMessage?.text === text) return turn;
  const messageId = turn.assistantMessage?.messageId
    ?? `message-${createHash("sha256").update(text, "utf8").digest("hex").slice(0, 24)}`;
  const assistantMessage = Object.freeze({ messageId, text });
  if (turn.action.type === "action_batch") {
    return Object.freeze({
      protocolVersion: turn.protocolVersion,
      assistantMessage,
      action: turn.action
    });
  }
  return Object.freeze({
    protocolVersion: turn.protocolVersion,
    assistantMessage,
    action: turn.action
  });
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
