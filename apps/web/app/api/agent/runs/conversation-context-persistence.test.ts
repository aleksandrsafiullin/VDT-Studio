import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AgentRunStore, type VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";
import { openVdtDatabase } from "@vdt-studio/storage";
import { createStorageWriteActor } from "../../vdt/storage-write-adapter";
import { confirmConversationDecisionProposal, CONFIRM_DECISION_OPTION } from "./conversation-context-decisions";
import { bindStartConversation } from "./conversation-context";
import { createSqliteAgentRunPersistence } from "./persistence";

it.each([
  ["For this tree, count only saleable tonnes.", "Actually, use all run-of-mine tonnes as output.", "all run-of-mine tonnes"],
  ["Под выпуском понимаем только товарную продукцию", "Теперь под выпуском понимаем весь объём добычи.", "весь объём добычи"]
])("reopens and supersedes the bilingual definition on a different binding (%s)", (initial, correction, expected) => {
  const root = mkdtempSync(join(tmpdir(), "vdt-r02-"));
  const open = () => openVdtDatabase(root, { dataDir: root });
  let database = open();
  try {
    const { id: projectId } = database.createProject({ id: "project_r02", name: "Synthetic project" });
    const { id: vdtId } = database.createVdt({ id: "vdt_r02", projectId, name: "Throughput", rootKpi: "Output" });
    const { id: otherVdtId } = database.createVdt({ id: "vdt_other", projectId, name: "Other", rootKpi: "Output" });
    const workspace = { projectId, vdtId };
    const first: VdtAgentStartRequest = { workspace, mode: "continue_project", input: {}, providerId: "mock", executionBindingId: "original" };
    bindStartConversation(database, first);
    const persistence = createSqliteAgentRunPersistence(database, { actorFactory: id => createStorageWriteActor(id, { env: { VDT_APP_MODE: "development_web" } }) });
    const store = new AgentRunStore({ persistence });
    const run = store.createRun(first);
    persistence.updateRun(store.appendChatMessage(run.runId, { role: "user", kind: "instruction", text: initial }));
    const conversationId = first.conversationId!;
    const source = database.listMessages(conversationId).find(row => row.content === initial)!;
    expect(source.runContext?.decision).toMatchObject({ version: "conversation_instruction_decision.v1", topic: "output" });

    for (let index = 0; index < 170; index++) {
      database.appendMessage({
        id: `message_filler_${index}`, conversationId, agentRunId: run.runId, role: "user",
        content: `Please inspect current inputs ${index}.`, runContext: { kind: "instruction" }
      });
    }
    database.appendMessage({
      id: "message_assistant", conversationId, agentRunId: run.runId, role: "assistant",
      content: "Output means stockpiled tonnes.", runContext: { kind: "assistant_message" }
    });
    database.appendMessage({
      id: "message_attachment", conversationId, agentRunId: run.runId, role: "user",
      content: "Attachment added.", attachments: [{ cell: "Output means shipped tonnes." }], runContext: { kind: "instruction" }
    });
    expect(database.listScopedConversationMessages({ ...workspace, conversationId }, 160).some(row => row.id === source.id)).toBe(false);
    database.close();
    database = open();

    const switched: VdtAgentStartRequest = { ...first, conversationId: undefined, priorConversationRunId: run.runId, executionBindingId: "replacement" };
    bindStartConversation(database, switched);
    expect(switched.conversationContext).toMatchObject({
      scope: { ...workspace, conversationId },
      decisions: [{ topic: "output", source: { messageId: source.id, runId: run.runId }, confirmedBy: "instruction" }]
    });
    const continued = createSqliteAgentRunPersistence(database, { actorFactory: id => createStorageWriteActor(id, { env: { VDT_APP_MODE: "development_web" } }) });
    const nextStore = new AgentRunStore({ persistence: continued });
    const nextRun = nextStore.createRun(switched);
    continued.updateRun(nextStore.appendChatMessage(nextRun.runId, { role: "user", kind: "instruction", text: correction }));
    const proposalSource = nextStore.appendChatMessage(nextRun.runId, {
      role: "user", kind: "instruction", text: "Could zero backlog be our service cutoff?"
    }).chatMessages.at(-1)!;
    const confirmation = confirmConversationDecisionProposal(proposalSource, {
      topic: "service cutoff", value: "zero backlog", evidenceQuote: "zero backlog be our service cutoff"
    }, "en")!;
    nextStore.appendChatMessage(nextRun.runId, { role: "assistant", kind: "question", questions: [confirmation] });
    const pending: VdtAgentStartRequest = { ...switched, priorConversationRunId: nextRun.runId };
    bindStartConversation(database, pending);
    expect(pending.conversationContext).toMatchObject({ unresolvedQuestions: [{ id: confirmation.id }] });
    expect(pending.conversationContext?.decisions.some(decision => decision.topic === "service cutoff")).toBe(false);
    nextStore.appendChatMessage(nextRun.runId, {
      role: "user", kind: "answer", answers: [{ questionId: confirmation.id, selectedOptionIds: [CONFIRM_DECISION_OPTION] }]
    });

    database.close();
    database = open();
    const reopened: VdtAgentStartRequest = { ...switched, priorConversationRunId: nextRun.runId };
    bindStartConversation(database, reopened);
    expect(reopened.conversationContext?.decisions).toEqual([
      expect.objectContaining({
        topic: "output", value: expected, supersedes: { messageId: source.id, runId: run.runId },
        source: expect.objectContaining({ runId: nextRun.runId })
      }),
      expect.objectContaining({
        topic: "service cutoff", value: "zero backlog", confirmedBy: "submitted_answer",
        source: expect.objectContaining({ runId: nextRun.runId })
      })
    ]);
    expect(reopened.conversationContext?.unresolvedQuestions).toEqual([]);
    expect(database.getAgentRun(run.runId)?.request.executionBindingId).toBe("original");
    expect(database.getAgentRun(nextRun.runId)?.request.executionBindingId).toBe("replacement");
    expect(() => bindStartConversation(database, { ...switched, workspace: { projectId, vdtId: otherVdtId } }))
      .toThrowError(expect.objectContaining({ code: "VDT_NOT_FOUND" }));
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
