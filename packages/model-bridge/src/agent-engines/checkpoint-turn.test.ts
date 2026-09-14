import { agentQuestionSchema } from "@vdt-studio/vdt-agent-runtime";
import { describe, expect, it } from "vitest";
import { parseCheckpointTurn, selectCheckpointTurnFromAgentMessages } from "./checkpoint-turn";
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

function validTurn() {
  return {
    protocolVersion: PROTOCOL,
    assistantMessage: { messageId: "message-1", text: "Starting." },
    action: {
      type: "action_batch" as const,
      batch: {
        calls: [{ externalCallId: "call-1", toolName: "vdt.echo", args: { value: 1 } }]
      }
    }
  };
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

  it("normalizes label and type aliases on user.ask questions before strict validation", () => {
    const liveQuestions = [
      {
        id: "fleet-topology",
        question: "Should the fleet be split into two branches?",
        reason: "Truck classes differ materially.",
        required: true,
        label: "Should the fleet be split into two branches?",
        type: "choice",
        options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }]
      },
      {
        id: "reporting-period",
        question: "Which reporting period should anchor the root KPI?",
        reason: "The root formula needs one time basis.",
        required: true,
        label: "Which reporting period should anchor the root KPI?",
        type: "choice",
        options: [{ id: "year", label: "Year" }, { id: "quarter", label: "Quarter" }]
      },
      {
        id: "capacity-unit",
        question: "What unit should capacity use?",
        reason: "Downstream formulas must stay consistent.",
        required: true,
        label: "What unit should capacity use?",
        type: "text"
      }
    ];
    const turn = parse({
      protocolVersion: PROTOCOL,
      assistantMessage: "Confirm topology, period, and units.",
      action: {
        type: "user.ask",
        questions: liveQuestions
      }
    });
    expect(turn.action.type).toBe("action_batch");
    if (turn.action.type !== "action_batch") return;
    const questions = (turn.action.batch.calls[0]?.args as { questions?: unknown }).questions;
    const parsed = agentQuestionSchema.strict().array().min(1).max(5).safeParse(questions);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual([
      {
        id: "fleet-topology",
        question: "Should the fleet be split into two branches?",
        reason: "Truck classes differ materially.",
        required: true,
        expectedAnswerType: "single_choice",
        options: [
          { id: "yes", label: "Yes", value: "yes" },
          { id: "no", label: "No", value: "no" }
        ]
      },
      {
        id: "reporting-period",
        question: "Which reporting period should anchor the root KPI?",
        reason: "The root formula needs one time basis.",
        required: true,
        expectedAnswerType: "single_choice",
        options: [
          { id: "year", label: "Year", value: "year" },
          { id: "quarter", label: "Quarter", value: "quarter" }
        ]
      },
      {
        id: "capacity-unit",
        question: "What unit should capacity use?",
        reason: "Downstream formulas must stay consistent.",
        required: true,
        expectedAnswerType: "text"
      }
    ]);
  });

  it("drops unknown question keys such as responseType before strict validation", () => {
    const liveQuestions = [
      {
        id: "fleet-topology",
        question: "Should the fleet be split into two branches?",
        reason: "Truck classes differ materially.",
        required: true,
        responseType: "choice",
        options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }]
      },
      {
        id: "reporting-period",
        question: "Which reporting period should anchor the root KPI?",
        reason: "The root formula needs one time basis.",
        required: true,
        responseType: "choice",
        options: [{ id: "year", label: "Year" }, { id: "quarter", label: "Quarter" }]
      },
      {
        id: "capacity-unit",
        question: "What unit should capacity use?",
        reason: "Downstream formulas must stay consistent.",
        required: true,
        responseType: "text"
      }
    ];
    const turn = parse({
      protocolVersion: PROTOCOL,
      assistantMessage: "Confirm topology, period, and units.",
      action: {
        type: "user.ask",
        questions: liveQuestions
      }
    });
    if (turn.action.type !== "action_batch") throw new Error("Expected action batch.");
    const callArgs = turn.action.batch.calls[0]?.args as {
      questions?: Array<Record<string, unknown>>;
      __vdtDroppedQuestionKeys?: string;
    };
    expect(callArgs?.__vdtDroppedQuestionKeys).toBe(
      "0 (dropped_keys: responseType), 1 (dropped_keys: responseType), 2 (dropped_keys: responseType)"
    );
    const parsed = agentQuestionSchema.strict().array().min(1).max(5).safeParse(callArgs?.questions);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    for (const question of parsed.data) {
      expect(question).not.toHaveProperty("responseType");
    }
    expect(parsed.data[0]).toMatchObject({
      id: "fleet-topology",
      question: "Should the fleet be split into two branches?",
      required: true
    });
  });

  it("still rejects genuinely invalid questions after unknown-key dropping", () => {
    const invalidTurns = [
      {
        protocolVersion: PROTOCOL,
        assistantMessage: "Missing reason.",
        action: {
          type: "user.ask",
          questions: [{
            id: "missing-reason",
            question: "What scope?",
            required: true,
            responseType: "text"
          }]
        }
      },
      {
        protocolVersion: PROTOCOL,
        assistantMessage: "Overlong question.",
        action: {
          type: "user.ask",
          questions: [{
            id: "overlong",
            question: "x".repeat(501),
            reason: "Too long.",
            required: true
          }]
        }
      },
      {
        protocolVersion: PROTOCOL,
        assistantMessage: "Bad answer type.",
        action: {
          type: "user.ask",
          questions: [{
            id: "bad-type",
            question: "Pick one?",
            reason: "Enum is invalid.",
            required: true,
            expectedAnswerType: "bogus"
          }]
        }
      }
    ];
    for (const payload of invalidTurns) {
      const turn = parse(payload);
      if (turn.action.type !== "action_batch") throw new Error("Expected action batch.");
      const questions = (turn.action.batch.calls[0]?.args as { questions?: unknown }).questions;
      const parsed = agentQuestionSchema.strict().array().min(1).max(5).safeParse(questions);
      expect(parsed.success).toBe(false);
    }
  });

  it("prefers canonical question and expectedAnswerType over label and type aliases", () => {
    const turn = parse({
      protocolVersion: PROTOCOL,
      assistantMessage: "Canonical fields win.",
      action: {
        type: "action_batch",
        calls: [{
          externalCallId: "call-alias-pref",
          toolName: "user.ask",
          args: {
            questions: [{
              id: "alias-pref",
              question: "Canonical question?",
              label: "Alias label",
              reason: "Aliases must not override canonical keys.",
              required: true,
              expectedAnswerType: "text",
              type: "choice"
            }]
          }
        }]
      }
    });
    if (turn.action.type !== "action_batch") throw new Error("Expected action batch.");
    const questions = (turn.action.batch.calls[0]?.args as { questions?: Array<Record<string, unknown>> }).questions;
    expect(questions?.[0]).toMatchObject({
      question: "Canonical question?",
      expectedAnswerType: "text"
    });
    expect(questions?.[0]).not.toHaveProperty("label");
    expect(questions?.[0]).not.toHaveProperty("type");
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

  it.each([
    ["tool_call", "wrapped batch"],
    ["tool_calls", "wrapped batch"],
    ["tool_call", "direct calls"],
    ["tool_calls", "direct calls"]
  ] as const)("normalizes action.type %s %s onto action_batch", (alias, shape) => {
    const calls = [{ externalCallId: `call-${alias}-${shape.replace(" ", "-")}`, toolName: "vdt.echo", args: { value: 4 } }];
    const turn = parse({
      protocolVersion: PROTOCOL,
      assistantMessage: { messageId: "message-alias", text: "Starting." },
      action: shape === "wrapped batch"
        ? { type: alias, batch: { calls } }
        : { type: alias, calls }
    });
    expect(turn.action.type).toBe("action_batch");
    if (turn.action.type === "action_batch") {
      expect(turn.action.batch.calls[0]?.toolName).toBe("vdt.echo");
      expect(turn.action.batch.calls[0]?.externalCallId).toBe(calls[0]?.externalCallId);
    }
  });

  it("rejects a genuinely unknown action type with _PROTOCOL_INVALID and names the value", () => {
    expect(() => parse({
      protocolVersion: PROTOCOL,
      assistantMessage: null,
      action: {
        type: "call_tools",
        calls: [{ externalCallId: "call-unknown", toolName: "vdt.echo", args: { value: 6 } }]
      }
    })).toThrow(expect.objectContaining({
      code: "CHECKPOINT_PROTOCOL_INVALID",
      message: expect.stringContaining("call_tools")
    }));
  });

  it("still parses a bare JSON object", () => {
    const turn = parse(validTurn());
    expect(turn.action.type).toBe("action_batch");
  });

  it("parses a fenced block with a language tag", () => {
    const turn = parse(`Here is the turn:\n\`\`\`json\n${JSON.stringify(validTurn())}\n\`\`\`\n`);
    expect(turn.action.type).toBe("action_batch");
    if (turn.action.type === "action_batch") {
      expect(turn.action.batch.calls[0]?.toolName).toBe("vdt.echo");
    }
  });

  it("parses a fenced block without a language tag", () => {
    const turn = parse(`\`\`\`\n${JSON.stringify(validTurn())}\n\`\`\``);
    expect(turn.action.type).toBe("action_batch");
  });

  it("parses leading and trailing whitespace or a short prose preamble", () => {
    const body = JSON.stringify(validTurn());
    const turn = parse(`  \nI will start the batch now.\n${body}\nThanks.\n  `);
    expect(turn.action.type).toBe("action_batch");
  });

  it("rejects two candidate objects as PROTOCOL_AMBIGUOUS and names the count", () => {
    const first = JSON.stringify(validTurn());
    const second = JSON.stringify({
      ...validTurn(),
      assistantMessage: { messageId: "message-2", text: "Example only." }
    });
    expect(() => parse(`Example:\n${first}\nReal turn:\n${second}`)).toThrow(expect.objectContaining({
      code: "CHECKPOINT_PROTOCOL_AMBIGUOUS",
      message: expect.stringMatching(/ambiguous: found 2 candidate JSON objects/)
    }));
  });

  it("accepts prose plus one valid envelope plus leftover JSON and keeps narration", () => {
    const prose = "Opening summary of the haulage tree.";
    const leftover = "{not a turn}";
    const turn = parse(`${prose}\n${JSON.stringify(validTurn())}\n${leftover}`);
    expect(turn.action.type).toBe("action_batch");
    if (turn.action.type !== "action_batch") throw new Error("expected action_batch");
    expect(turn.action.batch.calls[0]?.externalCallId).toBe("call-1");
    expect(turn.assistantMessage?.text).toContain(prose);
    expect(turn.assistantMessage?.text).toContain("Starting.");
    expect(turn.assistantMessage?.text).toContain(leftover);
    expect(turn.assistantMessage?.text.indexOf(prose)).toBeLessThan(
      turn.assistantMessage!.text.indexOf("Starting.")
    );
    expect(turn.assistantMessage?.text.indexOf("Starting.")).toBeLessThan(
      turn.assistantMessage!.text.indexOf(leftover)
    );
  });

  it("accepts three objects when exactly one is a valid turn", () => {
    const first = JSON.stringify({ not: "a turn" });
    const third = JSON.stringify({ foo: 1 });
    const turn = parse(`${first}\n${JSON.stringify(validTurn())}\n${third}`);
    expect(turn.action.type).toBe("action_batch");
    if (turn.action.type !== "action_batch") throw new Error("expected action_batch");
    expect(turn.action.batch.calls[0]?.toolName).toBe("vdt.echo");
    expect(turn.assistantMessage?.text).toContain(first);
    expect(turn.assistantMessage?.text).toContain("Starting.");
    expect(turn.assistantMessage?.text).toContain(third);
  });

  it("keeps a single valid envelope unchanged", () => {
    const turn = parse(JSON.stringify(validTurn()));
    expect(turn.assistantMessage).toEqual({ messageId: "message-1", text: "Starting." });
    expect(turn.action.type).toBe("action_batch");
    if (turn.action.type !== "action_batch") throw new Error("expected action_batch");
    expect(turn.action.batch.calls[0]).toMatchObject({
      externalCallId: "call-1",
      toolName: "vdt.echo",
      args: { value: 1 }
    });
  });

  it("does not rewrite values inside the chosen envelope", () => {
    const innerText = "Keep ```json\n{\"decoy\":true}\n``` and {\"x\":1} verbatim.";
    const envelope = {
      ...validTurn(),
      assistantMessage: { messageId: "message-fence", text: innerText }
    };
    const leftover = JSON.stringify({ not: "a turn" });
    const turn = parse(`${JSON.stringify(envelope)}\n${leftover}`);
    expect(turn.assistantMessage?.messageId).toBe("message-fence");
    expect(turn.assistantMessage?.text).toContain(innerText);
    expect(turn.action.type).toBe("action_batch");
    if (turn.action.type !== "action_batch") throw new Error("expected action_batch");
    expect(turn.action.batch.calls[0]).toMatchObject({
      externalCallId: "call-1",
      toolName: "vdt.echo",
      args: { value: 1 }
    });
  });

  it("rejects malformed JSON as PROTOCOL_INVALID", () => {
    expect(() => parse("{not-json")).toThrow(expect.objectContaining({
      code: "CHECKPOINT_PROTOCOL_INVALID",
      message: "Checkpoint result must be exactly one JSON object without prose or fences."
    }));
    expect(() => parse("this is not json")).toThrow(expect.objectContaining({
      code: "CHECKPOINT_PROTOCOL_INVALID",
      message: "Checkpoint result must be exactly one JSON object without prose or fences."
    }));
    expect(() => parse("{")).toThrow(expect.objectContaining({
      code: "CHECKPOINT_PROTOCOL_INVALID"
    }));
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

describe("selectCheckpointTurnFromAgentMessages", () => {
  const options = {
    protocolVersion: PROTOCOL,
    allowedToolNames: TOOLS,
    errorPrefix: "CHECKPOINT"
  } as const;
  const opening = "Accepted: build a VDT model for Ore haulage (tonnes/year) using your provided trucking inputs.";
  const envelope = JSON.stringify(validTurn());

  it("keeps a single envelope message working as before", () => {
    const turn = selectCheckpointTurnFromAgentMessages([envelope], options);
    expect(turn.action.type).toBe("action_batch");
    expect(turn.assistantMessage).toEqual({ messageId: "message-1", text: "Starting." });
  });

  it("accepts prose followed by an envelope and keeps the prose as assistant narration", () => {
    const turn = selectCheckpointTurnFromAgentMessages([opening, envelope], options);
    expect(turn.action.type).toBe("action_batch");
    expect(turn.assistantMessage?.text).toContain(opening);
    expect(turn.assistantMessage?.text).toContain("Starting.");
    expect(turn.assistantMessage?.text.indexOf(opening)).toBeLessThan(
      turn.assistantMessage!.text.indexOf("Starting.")
    );
  });

  it("accepts an envelope followed by prose instead of taking the last message", () => {
    const turn = selectCheckpointTurnFromAgentMessages([envelope, opening], options);
    expect(turn.action.type).toBe("action_batch");
    if (turn.action.type !== "action_batch") throw new Error("expected action_batch");
    expect(turn.action.batch.calls[0]?.externalCallId).toBe("call-1");
    expect(turn.assistantMessage?.text).toContain(opening);
    expect(turn.assistantMessage?.text).toContain("Starting.");
    expect(turn.assistantMessage?.text.indexOf("Starting.")).toBeLessThan(
      turn.assistantMessage!.text.indexOf(opening)
    );
  });

  it("rejects two parseable envelopes as PROTOCOL_AMBIGUOUS", () => {
    const second = JSON.stringify({
      ...validTurn(),
      assistantMessage: { messageId: "message-2", text: "A second envelope." }
    });
    expect(() => selectCheckpointTurnFromAgentMessages([envelope, second], options)).toThrow(
      expect.objectContaining({
        code: "CHECKPOINT_PROTOCOL_AMBIGUOUS",
        message: expect.stringMatching(/ambiguous: found 2 candidate JSON objects/)
      })
    );
  });

  it("keeps today's diagnostic when no message is a parseable envelope", () => {
    expect(() => selectCheckpointTurnFromAgentMessages([opening], options)).toThrow(
      expect.objectContaining({
        code: "CHECKPOINT_PROTOCOL_INVALID",
        message: "Checkpoint result must be exactly one JSON object without prose or fences."
      })
    );
    expect(() => selectCheckpointTurnFromAgentMessages([opening, "Still just prose."], options)).toThrow(
      expect.objectContaining({
        code: "CHECKPOINT_PROTOCOL_INVALID",
        message: "Checkpoint result must be exactly one JSON object without prose or fences."
      })
    );
  });
});
