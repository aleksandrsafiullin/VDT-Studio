import { describe, expect, it } from "vitest";
import type { MessageRecord } from "@vdt-studio/storage";
import { agentStartRequestSchema } from "@vdt-studio/vdt-agent-runtime";
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
