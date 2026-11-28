import { describe, expect, it } from "vitest";
import type { MessageRecord } from "@vdt-studio/storage";
import { agentStartRequestSchema } from "@vdt-studio/vdt-agent-runtime";
import { confirmConversationDecisionProposal, CONFIRM_DECISION_OPTION } from "./conversation-context-decisions";
import { deriveConversationContext } from "./conversation-context";

function message(position: number, input: Pick<MessageRecord, "role" | "content" | "runContext">, agentRunId = "run_first"): MessageRecord {
  return { ...input, id: `message_${position}`, conversationId: "test", agentRunId, position, createdAt: "2026-11-24T00:00:00.000Z" };
}

describe("conversation context", () => {
  it("cites submitted answers and tracks later corrections and unresolved questions", () => {
    const messages = [
      message(1, {
        role: "assistant", content: "How do you define the output?", runContext: {
          kind: "question", questions: [{ id: "output", question: "How do you define the output?", options: ["saleable tonnes"] }]
        }
      }),
      message(2, {
        role: "user", content: "saleable tonnes", runContext: { kind: "answer", answers: [{ questionId: "output", selectedOptionIds: ["saleable tonnes"] }] }
      }),
      message(3, {
        role: "assistant", content: "Output means total processed volume.", runContext: { kind: "assistant_message" }
      }),
      message(4, {
        role: "assistant", content: "Which period?", runContext: { kind: "question", questions: [{ id: "period", question: "Which period?" }] }
      }),
      message(5, {
        role: "user", content: "Actually, use run-of-mine tonnes as the output.", runContext: { kind: "instruction" }
      }, "run_second")
    ];
    expect(deriveConversationContext(messages)).toMatchObject({
      decisions: [{ topic: "output", value: "run-of-mine tonnes", source: { messageId: "message_5", runId: "run_second" },
        supersedes: { messageId: "message_2", runId: "run_first" } }],
      unresolvedQuestions: [{ id: "period", text: "Which period?", source: { messageId: "message_4", runId: "run_first" } }]
    });
  });

  it("does not carry speculative instructions, credentials or cross-run answers", () => {
    expect(deriveConversationContext([
      message(1, { role: "user", content: "Check whether output means saleable tonnes?", runContext: { kind: "instruction" } }),
      message(2, { role: "user", content: "api_key = test-abc-hidden", runContext: { kind: "instruction" } }),
      message(3, { role: "user", content: "Definition = https://private.source", runContext: { kind: "instruction" } }),
      message(4, { role: "assistant", content: "Which period?", runContext: { kind: "question", questions: [{ id: "period", question: "Which period?" }] } }),
      message(5, { role: "user", content: "Quarter", runContext: { kind: "answer", answers: [{ questionId: "period", freeText: "Quarter" }] } }, "other_run"),
      message(6, { role: "user", content: "Output formula = [Old volume] * [Old yield]", runContext: { kind: "instruction" } })
    ])).toMatchObject({ decisions: [], unresolvedQuestions: [{ id: "period" }] });
  });

  it("bounds recent decisions and rejects client-authored context", () => {
    const messages = Array.from({ length: 200 }, (_, index) => message(index, {
      role: "user", content: `Scope ${index} = ${"量".repeat(390)}`, runContext: { kind: "instruction" }
    }));
    const context = deriveConversationContext(messages);
    expect(context?.decisions.at(-1)?.topic).toBe("scope 199");
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThanOrEqual(8_192);
    expect(agentStartRequestSchema.safeParse({
      mode: "continue_project",
      input: { prompt: "Summarize the graph." },
      providerId: "test",
      workspace: { projectId: "project", vdtId: "vdt" },
      conversationContext: context
    }).success).toBe(false);
  });
});

it("keeps supersession evidence after a topic leaves the bounded active projection", () => {
  const instructions = [
    "Output means saleable tonnes.",
    ...Array.from({ length: 12 }, (_, i) => `Scope ${i} = Calendar year`),
    "Actually, use all run-of-mine tonnes as output."
  ].map((content, index) => message(index, { role: "user", content, runContext: { kind: "instruction" } }));

  expect(deriveConversationContext(instructions)?.decisions).toHaveLength(8);
  expect(deriveConversationContext(instructions)?.decisions.at(-1)).toMatchObject({
    topic: "output", supersedes: { messageId: "message_0", runId: "run_first" }
  });
});

it("requires a submitted choice for an ambiguous, verbatim decision proposal and preserves zero", () => {
  const text = "I might use zero backlog as the service cutoff.";
  const source = { id: "instruction_1", runId: "run_first", role: "user", kind: "instruction", text } as const;
  const input = { topic: "service cutoff", value: "zero backlog", evidenceQuote: "zero backlog as the service cutoff" };
  expect(confirmConversationDecisionProposal(source, { ...input, value: "ten tickets" }, "en")).toBeUndefined();
  expect(confirmConversationDecisionProposal({ ...source, role: "assistant" }, input, "en")).toBeUndefined();
  expect(confirmConversationDecisionProposal({ ...source, text: undefined }, input, "en")).toBeUndefined();
  expect(confirmConversationDecisionProposal({ ...source, kind: "answer" }, input, "en")).toBeUndefined();
  expect(confirmConversationDecisionProposal({ ...source, kind: "answer", answers: [{ questionId: "scope", freeText: text }] }, input, "en"))
    .toMatchObject({ question: "How do you define service cutoff?" });

  const structured = { ...source, kind: "answer" as const, text: undefined,
    answers: [{ questionId: "cutoff", fields: { answer: "The threshold is 0." } }] };
  const zero = { topic: "threshold", value: "0", evidenceQuote: "threshold is 0." };
  expect(confirmConversationDecisionProposal(structured, zero, "en"))
    .toMatchObject({ options: [expect.objectContaining({ label: "0" }), expect.anything()] });
  expect(confirmConversationDecisionProposal({
    ...structured, answers: [{ questionId: "cutoff", fields: { answer: 0 } }]
  }, zero, "en")).toBeUndefined();
  const question = confirmConversationDecisionProposal(source, input, "en")!;
  expect(question.question).toBe("How do you define service cutoff?");
  expect(confirmConversationDecisionProposal(source, input, "en")).toEqual(question);
  const start = message(1, { role: "user", content: text, runContext: { kind: "instruction" } });
  const asked = message(2, { role: "assistant", content: question.question, runContext: { kind: "question", questions: [question] } });
  expect(deriveConversationContext([start, asked])).toMatchObject({ decisions: [], unresolvedQuestions: [{ id: question.id }] });
  const answer = (option: string) => message(3, {
    role: "user", content: option, runContext: { kind: "answer", answers: [{ questionId: question.id, selectedOptionIds: [option] }] }
  });
  expect(deriveConversationContext([start, asked, answer("reject_decision")])).toBeUndefined();
  expect(deriveConversationContext([start, asked, answer(CONFIRM_DECISION_OPTION)]))
    .toMatchObject({ decisions: [{ topic: "service cutoff", value: "zero backlog", confirmedBy: "submitted_answer", source: { messageId: "message_3" } }] });
  expect(deriveConversationContext([
    message(4, { role: "user", content: "Cutoff = 0", runContext: { kind: "instruction" } })
  ])?.decisions).toMatchObject([{ topic: "cutoff", value: "0" }]);
});

it("keeps mentioned file content and speculative definitions out of decisions", () => {
  const inputs = [
    "The workbook says output means shipped tonnes.",
    "I think output means shipped tonnes.",
    "Output means maybe saleable tonnes.",
    "Под выпуском понимаем товарную продукцию?",
    "Под выпуском понимаем скорее товарную продукцию."
  ];
  expect(deriveConversationContext(inputs.map((content, i) => message(i, {
    role: "user", content, runContext: { kind: "instruction" }
  })))).toBeUndefined();
});
