import { agentQuestionSchema } from "@vdt-studio/vdt-agent-runtime";
import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_MISSING_EVIDENCE,
  checkpointEventTypeLabel,
  checkpointMissingEvidence,
  codexItemDiagnosticText,
  omittedCheckpointStreamEvidence,
  questionSchemaIssueSummary,
  resolveCodexItemType,
  safeProtocolLabel,
  summarizeCodexItemDiagnostics,
  summarizeDroppedQuestionKeys
} from "./checkpoint-protocol-reporting";

describe("safeProtocolLabel", () => {
  it("passes through safe protocol identifiers", () => {
    expect(safeProtocolLabel("foreign_tool")).toBe("foreign_tool");
    expect(safeProtocolLabel("item.type_v2")).toBe("item.type_v2");
  });

  it("replaces hostile or oversized discriminators with <unrecognized>", () => {
    expect(safeProtocolLabel("a".repeat(65))).toBe("<unrecognized>");
    expect(safeProtocolLabel('evil"\nvalue')).toBe("<unrecognized>");
    expect(safeProtocolLabel(42)).toBe("<unrecognized>");
    expect(safeProtocolLabel(null)).toBe("<unrecognized>");
  });
});

describe("resolveCodexItemType", () => {
  it("prefers a single present discriminator", () => {
    expect(resolveCodexItemType({ type: "error" })).toEqual({ agreed: true, type: "error" });
    expect(resolveCodexItemType({ item_type: "error" })).toEqual({ agreed: true, type: "error" });
    expect(resolveCodexItemType({ type: "error", item_type: "error" })).toEqual({ agreed: true, type: "error" });
  });

  it("flags disagreeing type and item_type without preferring either", () => {
    expect(resolveCodexItemType({ type: "error", item_type: "web_search" })).toEqual({
      agreed: false,
      type: undefined
    });
  });
});

describe("codexItemDiagnosticText", () => {
  it("names the item type and payload size without echoing stream text", () => {
    const text = "Skill descriptions were shortened to fit the 2% skills context budget.";
    expect(codexItemDiagnosticText({ type: "error", text })).toBe(`error bytes=${Buffer.byteLength(text, "utf8")}`);
    expect(codexItemDiagnosticText({ type: "error", text })).not.toContain("Skill");
    expect(codexItemDiagnosticText({
      type: "error",
      message: "x".repeat(300)
    })).toBe("error bytes=300");
  });
});

describe("summarizeCodexItemDiagnostics", () => {
  it("joins bounded diagnostic summaries", () => {
    expect(summarizeCodexItemDiagnostics([
      "error bytes=40",
      "error bytes=28"
    ])).toBe("error bytes=40 | error bytes=28");
  });
});

describe("summarizeDroppedQuestionKeys", () => {
  it("reports dropped key names without echoing model output", () => {
    expect(summarizeDroppedQuestionKeys([
      { index: 0, keys: ["responseType", "label"] },
      { index: 1, keys: ["responseType"] }
    ])).toBe("0 (dropped_keys: responseType|label), 1 (dropped_keys: responseType)");
  });

  it("filters hostile dropped key names", () => {
    expect(summarizeDroppedQuestionKeys([
      { index: 0, keys: [`evil"\nkey`, "a".repeat(80), "responseType"] }
    ])).toBe("0 (dropped_keys: responseType)");
  });
});

describe("questionSchemaIssueSummary", () => {
  const livePayloadQuestions = [
    {
      id: "fleet-topology",
      question: "Should the fleet be split into two branches?",
      reason: "Truck classes differ materially.",
      required: true,
      label: "Should the fleet be split into two branches?",
      type: "choice"
    },
    {
      id: "reporting-period",
      question: "Which reporting period should anchor the root KPI?",
      reason: "The root formula needs one time basis.",
      required: true,
      label: "Which reporting period should anchor the root KPI?",
      type: "choice"
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

  it("names label and type unrecognized keys for the live Codex payload shape", () => {
    const parsed = agentQuestionSchema.strict().array().safeParse(livePayloadQuestions);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const summary = questionSchemaIssueSummary(parsed.error.issues);
    expect(summary).toContain("0 (unrecognized_keys: label|type)");
    expect(summary).toContain("1 (unrecognized_keys: label|type)");
    expect(summary).toContain("2 (unrecognized_keys: label|type)");
    expect(summary).not.toContain("Should the fleet");
    expect(summary).not.toContain("reporting period");
  });

  it("filters hostile unrecognized key names instead of echoing model output", () => {
    const parsed = agentQuestionSchema.strict().safeParse({
      id: "q1",
      question: "Safe question text?",
      reason: "Because.",
      required: true,
      [`evil"\nkey`]: "do not echo",
      ["a".repeat(80)]: "also hidden"
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const summary = questionSchemaIssueSummary(parsed.error.issues);
    expect(summary).not.toContain("do not echo");
    expect(summary).not.toContain('evil"\nkey');
    expect(summary).not.toContain("a".repeat(80));
  });
});

describe("checkpointEventTypeLabel", () => {
  it("joins safe type and subtype without echoing hostile discriminators", () => {
    expect(checkpointEventTypeLabel({ type: "system", subtype: "init" })).toBe("system.init");
    expect(checkpointEventTypeLabel({ type: "thread.started" })).toBe("thread.started");
    expect(checkpointEventTypeLabel({ type: 'evil"\nvalue', subtype: "init" })).toBe("<unrecognized>");
  });
});

describe("omittedCheckpointStreamEvidence", () => {
  const requiredPresent = { init: true, terminal: true, session: true };

  it("names empty_stdout alone even when every other flag is also missing", () => {
    expect(checkpointMissingEvidence(true, {
      init: false,
      terminal: false,
      session: false,
      agentMessage: false
    })).toEqual([CHECKPOINT_MISSING_EVIDENCE.emptyStdout]);

    const omitted = omittedCheckpointStreamEvidence({
      cliLabel: "Cursor",
      observation: {
        parsedLineCount: 0,
        eventTypeSequence: [],
        stdoutEmpty: true,
        exitCode: 0,
        signal: null
      },
      required: { init: false, terminal: false, session: false }
    });
    expect(omitted.missingEvidence).toEqual(["empty_stdout"]);
    expect(omitted.message).toContain("(empty_stdout)");
    expect(omitted.message).not.toContain("missing_init");
    expect(omitted.message).toContain("parsed_lines=0");
    expect(omitted.message).toContain("event_types=<none>");
    expect(omitted.message).toContain("stdout_empty=true");
    expect(omitted.message).toContain("exit=0");
    expect(omitted.message).toContain("signal=none");
  });

  it("names missing_init, missing_terminal, missing_session, and missing_agent_message distinctly", () => {
    expect(omittedCheckpointStreamEvidence({
      cliLabel: "Claude",
      observation: {
        parsedLineCount: 2,
        eventTypeSequence: ["assistant", "result.success"],
        stdoutEmpty: false,
        exitCode: 0,
        signal: null
      },
      required: { init: false, terminal: true, session: true }
    }).missingEvidence).toEqual(["missing_init"]);

    expect(omittedCheckpointStreamEvidence({
      cliLabel: "Claude",
      observation: {
        parsedLineCount: 1,
        eventTypeSequence: ["system.init"],
        stdoutEmpty: false,
        exitCode: 0,
        signal: null
      },
      required: { init: true, terminal: false, session: true }
    }).missingEvidence).toEqual(["missing_terminal"]);

    expect(omittedCheckpointStreamEvidence({
      cliLabel: "Cursor",
      observation: {
        parsedLineCount: 2,
        eventTypeSequence: ["assistant", "thinking.delta"],
        stdoutEmpty: false,
        exitCode: 0,
        signal: null
      },
      required: { init: true, terminal: true, session: false }
    }).missingEvidence).toEqual(["missing_session"]);

    expect(omittedCheckpointStreamEvidence({
      cliLabel: "Codex",
      observation: {
        parsedLineCount: 3,
        eventTypeSequence: ["thread.started", "turn.started", "turn.completed"],
        stdoutEmpty: false,
        exitCode: 0,
        signal: null
      },
      required: { ...requiredPresent, agentMessage: false }
    }).missingEvidence).toEqual(["missing_agent_message"]);
  });

  it("sanitizes hostile labels, stores the sanitised signal, and keeps exit/signal when bounding", () => {
    const omitted = omittedCheckpointStreamEvidence({
      cliLabel: "Cursor",
      observation: {
        parsedLineCount: 2,
        eventTypeSequence: [`evil"\n${"x".repeat(80)}`, "assistant"],
        stdoutEmpty: false,
        exitCode: 0,
        signal: "SIGTERM"
      },
      required: { init: false, terminal: true, session: true }
    });
    expect(omitted.details.eventTypes).toBe("<unrecognized>,assistant");
    expect(omitted.details.signal).toBe("SIGTERM");
    expect(omitted.message).toContain("event_types=<unrecognized>,assistant");
    expect(omitted.message).toContain("signal=SIGTERM");
    expect(omitted.message).not.toContain("evil");
    expect(omitted.message).not.toContain("x".repeat(80));

    const hostile = omittedCheckpointStreamEvidence({
      cliLabel: "Cursor",
      observation: {
        parsedLineCount: 40,
        eventTypeSequence: Array.from({ length: 40 }, (_, index) => `event_${index}`),
        stdoutEmpty: false,
        exitCode: 0,
        signal: `evil"\n${"x".repeat(80)}`
      },
      required: { init: false, terminal: true, session: true }
    });
    expect(hostile.details.signal).toBe("<unrecognized>");
    expect(hostile.message.length).toBeLessThanOrEqual(480);
    expect(hostile.message).toContain("exit=0");
    expect(hostile.message).toContain("signal=<unrecognized>");
    expect(hostile.message).not.toContain("evil");
  });
});
