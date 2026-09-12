import { describe, expect, it } from "vitest";
import { parseCheckpointTurn } from "./checkpoint-turn";
import { VDT_CHECKPOINT_TURN_PROTOCOL_VERSION } from "./persistent-cli-checkpoint-canaries";

const PROTOCOL = VDT_CHECKPOINT_TURN_PROTOCOL_VERSION;
const TOOLS = ["vdt.echo", "user.ask", "run.request_finish"] as const;

function parse(raw: unknown) {
  return parseCheckpointTurn(typeof raw === "string" ? raw : JSON.stringify(raw), {
    protocolVersion: PROTOCOL,
    allowedToolNames: TOOLS,
    errorPrefix: "CHECKPOINT"
  });
}

describe("parseCheckpointTurn", () => {
  it("accepts wrapped action_batch batches", () => {
    const turn = parse({
      protocolVersion: PROTOCOL,
      assistantMessage: { messageId: "message-1", text: "Starting." },
      action: {
        type: "action_batch",
        batch: {
          calls: [{ externalCallId: "call-1", toolName: "vdt.echo", args: { value: 1 } }]
        }
      }
    });
    expect(turn.action.type).toBe("action_batch");
    if (turn.action.type === "action_batch") {
      expect(turn.action.batch.calls[0]?.toolName).toBe("vdt.echo");
    }
  });

  it("accepts direct calls on action_batch", () => {
    const turn = parse({
      protocolVersion: PROTOCOL,
      assistantMessage: null,
      action: {
        type: "action_batch",
        calls: [{ externalCallId: "call-direct", toolName: "vdt.echo", args: { value: 2 } }]
      }
    });
    expect(turn.action.type).toBe("action_batch");
  });

  it("accepts string assistantMessage on action_batch", () => {
    const turn = parse({
      protocolVersion: PROTOCOL,
      assistantMessage: "I will build the fleet branches.",
      action: {
        type: "action_batch",
        calls: [{ externalCallId: "call-string", toolName: "vdt.echo", args: { value: 3 } }]
      }
    });
    expect(turn.assistantMessage?.text).toBe("I will build the fleet branches.");
  });

  it("normalizes user.ask shorthand into an action_batch", () => {
    const turn = parse({
      protocolVersion: PROTOCOL,
      assistantMessage: "Confirm topology.",
      action: {
        type: "user.ask",
        questions: [{
          id: "fleet_split",
          question: "Use two branches?",
          reason: "Fleets differ.",
          required: true,
          expectedAnswerType: "choice",
          options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }]
        }]
      }
    });
    expect(turn.action.type).toBe("action_batch");
    if (turn.action.type === "action_batch") {
      expect(turn.action.batch.calls[0]?.toolName).toBe("user.ask");
      const questions = (turn.action.batch.calls[0]?.args as { questions?: Array<{ expectedAnswerType?: string; options?: Array<{ value?: string }> }> }).questions;
      expect(questions?.[0]?.expectedAnswerType).toBe("single_choice");
      expect(questions?.[0]?.options?.[0]?.value).toBe("yes");
    }
  });

  it("normalizes expectedAnswerType enum into single_choice", () => {
    const turn = parse({
      protocolVersion: PROTOCOL,
      assistantMessage: "Pick a period.",
      action: {
        type: "user.ask",
        questions: [{
          id: "period",
          question: "Which reporting period?",
          reason: "The root formula needs one time basis.",
          required: true,
          expectedAnswerType: "enum",
          options: [{ id: "year", label: "Year" }, { id: "quarter", label: "Quarter" }]
        }]
      }
    });
    expect(turn.action.type).toBe("action_batch");
    if (turn.action.type === "action_batch") {
      const questions = (turn.action.batch.calls[0]?.args as { questions?: Array<{ expectedAnswerType?: string }> }).questions;
      expect(questions?.[0]?.expectedAnswerType).toBe("single_choice");
    }
  });

  it("accepts canonical final actions", () => {
    const turn = parse({
      protocolVersion: PROTOCOL,
      assistantMessage: null,
      action: {
        type: "final",
        messageId: "message-final",
        finishReceiptId: "finish-receipt-1",
        text: "Done."
      }
    });
    expect(turn.action).toMatchObject({ type: "final", finishReceiptId: "finish-receipt-1", text: "Done." });
  });

  it("accepts compact final actions with assistantMessage prose", () => {
    const turn = parse({
      protocolVersion: PROTOCOL,
      assistantMessage: "Ore hauled is complete.",
      action: {
        type: "final",
        finishReceiptId: "finish-receipt-2"
      }
    });
    expect(turn.action).toMatchObject({
      type: "final",
      finishReceiptId: "finish-receipt-2",
      text: "Ore hauled is complete."
    });
  });

  it("rejects canonical final actions that duplicate assistantMessage", () => {
    expect(() => parse({
      protocolVersion: PROTOCOL,
      assistantMessage: { messageId: "message-dup", text: "Still talking." },
      action: {
        type: "final",
        messageId: "message-final",
        finishReceiptId: "finish-receipt-3",
        text: "Done."
      }
    })).toThrow(expect.objectContaining({ code: "CHECKPOINT_PROTOCOL_INVALID" }));
  });
});
