import { createHash } from "node:crypto";
import { parseCheckpointActionBatch, type CheckpointActionBatch } from "./action-batch";

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
      readonly assistantMessage: null;
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

function normalizeCheckpointQuestions(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((question) => {
    if (!isRecord(question)) return question;
    const expectedAnswerType = question.expectedAnswerType === "enum" || question.expectedAnswerType === "choice"
      ? "single_choice"
      : question.expectedAnswerType;
    const options = Array.isArray(question.options)
      ? question.options.map((option) => {
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
      : question.options;
    return {
      ...question,
      ...(expectedAnswerType !== undefined ? { expectedAnswerType } : {}),
      ...(options !== undefined ? { options } : {})
    };
  });
}

function normalizeCheckpointActionBatch(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.calls)) return value;
  return {
    ...value,
    calls: value.calls.map((call) => {
      if (!isRecord(call) || call.toolName !== "user.ask" || !isRecord(call.args)) return call;
      return {
        ...call,
        args: {
          ...call.args,
          questions: normalizeCheckpointQuestions(call.args.questions)
        }
      };
    })
  };
}

/** Lenient checkpoint-turn parser shared by Cursor, Codex, and Claude transports. */
export function parseCheckpointTurn(raw: string, options: ParseCheckpointTurnOptions): CheckpointTurn {
  const maxPromptBytes = options.maxPromptBytes ?? DEFAULT_MAX_PROMPT_BYTES;
  const { protocolVersion, allowedToolNames, errorPrefix } = options;
  if (byteLength(raw) > maxPromptBytes) {
    throw checkpointTurnError(`${errorPrefix}_PROTOCOL_INVALID`, "Checkpoint response is too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim()) as unknown;
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

  if (parsed.action.type === "action_batch") {
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

  if (parsed.action.type === "user.ask") {
    assertExactKeys(parsed.action, ["questions", "type"], "checkpoint user.ask action", errorPrefix);
    if (parsed.assistantMessage !== null && typeof parsed.assistantMessage !== "string") {
      throw checkpointTurnError(`${errorPrefix}_PROTOCOL_INVALID`, "user.ask assistantMessage must be text or null.");
    }
    if (typeof parsed.assistantMessage === "string") {
      assertText(parsed.assistantMessage, "assistantMessage", errorPrefix, 8_000);
    }
    const questions = normalizeCheckpointQuestions(parsed.action.questions);
    const controlHash = createHash("sha256")
      .update(JSON.stringify(questions), "utf8")
      .digest("hex")
      .slice(0, 24);
    const batch = parseCheckpointActionBatch({
      calls: [{
        externalCallId: `control-ask-${controlHash}`,
        toolName: "user.ask",
        args: { questions }
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

  if (parsed.action.type === "final") {
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

  throw checkpointTurnError(`${errorPrefix}_PROTOCOL_INVALID`, "Checkpoint action type is unknown.");
}
