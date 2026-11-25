import { z } from "zod";
import {
  applyDecompositionAssumptionOperation, decompositionAssumptionLimits, readDecompositionAssumptions,
  type DecompositionAssumptionEvidence
} from "@vdt-studio/vdt-core";
import { proposeAndMaybeApplyMutation } from "../mutation-pipeline";
import { AgentToolError, type AgentTool } from "../tool-registry";
import type { AgentChatMessage } from "../types";
import { cloneBuilder, requireBuilder, requireChangeSet } from "./builder-mutation-utils";

const nodeId = z.string().min(1).max(160);
const line = z.string().trim().min(1).max(decompositionAssumptionLimits.text).regex(/^[^\r\n]+$/u);
const writeInput = z.object({
  nodeId,
  statement: line,
  changesConclusionWhen: line,
  sourceMessageId: z.string().min(1).max(decompositionAssumptionLimits.sourceId).nullable(),
  previousNote: z.string().min(1).max(decompositionAssumptionLimits.note).nullable()
}).strict();

export function createDecompositionAssumptionTools(): AgentTool[] {
  return [readAssumptions, recordAssumption];
}

const readAssumptions: AgentTool<{ nodeId: string }> = {
  name: "vdt.read_decomposition_assumptions",
  description: "Read relationship assumptions and recent user source IDs. Cite the source for a confirmed relationship.",
  inputSchema: z.object({ nodeId }).strict(),
  outputSchema: z.record(z.string(), z.unknown()),
  requiresDraftProject: true,
  phase: "planning_decomposition",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const node = builder.getProject().graph.nodes.find(candidate => candidate.id === input.nodeId);
    if (!node) throw new AgentToolError("NODE_NOT_FOUND", "Select an existing node.");
    const { chatMessages } = context.store.getState(context.runId);
    return {
      nodeId: node.id,
      revision: builder.getRevision(),
      assumptions: readDecompositionAssumptions(node).slice(-20),
      recentUserSources: chatMessages.filter(message => message.role === "user").slice(-12)
        .map(message => ({
          id: message.id,
          kind: message.kind,
          excerpt: (message.text ?? "").slice(0, 600),
          ...(message.kind === "answer" ? {
            exactStatements: answerStatements(chatMessages, chatMessages.indexOf(message))
              .filter(statement => line.safeParse(statement).success)
              .slice(0, 3)
          } : {})
        }))
    };
  }
};

const recordAssumption: AgentTool<z.infer<typeof writeInput>> = {
  name: "vdt.record_decomposition_assumption",
  description: "Record a relationship and when it could change. For confirmed facts, cite the user source ID and its complete sentence or answer label. Use null for provisional facts. Ask or show conditional outcomes for unresolved choices. Use previousNote to revise.",
  inputSchema: writeInput,
  outputSchema: z.record(z.string(), z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "planning_decomposition",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    const state = context.store.getState(context.runId);
    let evidence: DecompositionAssumptionEvidence = { kind: "provisional" };
    if (input.sourceMessageId) {
      if (!hasUserConfirmation(state.chatMessages, input.sourceMessageId, input.statement)) {
        throw new AgentToolError("ASSUMPTION_SOURCE_UNCONFIRMED", "Use an exact supporting sentence from the user or a submitted answer from vdt.read_decomposition_assumptions, or record the assumption as provisional.");
      }
      evidence = { kind: "user_confirmed", sourceId: input.sourceMessageId, quote: input.statement };
    }

    const operation = applyDecompositionAssumptionOperation(project, {
      nodeId: input.nodeId,
      statement: input.statement,
      changesConclusionWhen: input.changesConclusionWhen,
      evidence,
      previousNote: input.previousNote ?? undefined
    }, { operationId: `decomposition_assumption_${context.runId}_${builder.getRevision()}`, now: new Date().toISOString() });
    if (operation.status === "error") throw new AgentToolError(operation.code, operation.message);
    if (operation.project === project) return { ...operation.result, revision: builder.getRevision() };

    const preview = cloneBuilder(context).updateNode({ nodeId: input.nodeId, patch: operation.patch });
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Decomposition assumption",
      summary: operation.result.note,
      changeSet: requireChangeSet(preview.changeSet),
      targetNodeId: input.nodeId
    });
    return {
      ...operation.result, revision: mutation.revision,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};

function hasUserConfirmation(messages: AgentChatMessage[], sourceId: string, statement: string): boolean {
  const index = messages.findIndex(message => message.id === sourceId && message.role === "user");
  const source = messages[index];
  if (!source) return false;
  if (source.kind === "instruction") return sentences(source.text).includes(statement);
  return source.kind === "answer" && answerStatements(messages, index).includes(statement);
}

function answerStatements(messages: AgentChatMessage[], index: number): string[] {
  const questions = messages.slice(0, index).reverse().flatMap(message =>
    message.role === "assistant" && message.kind === "question" ? message.questions ?? [] : []
  );
  return (messages[index]?.answers ?? []).flatMap(answer => {
    const question = questions.find(candidate => candidate.id === answer.questionId);
    const labels = question?.options?.flatMap(option => {
      const optionId = typeof option === "string" ? option : option.id;
      return answer.selectedOptionIds?.includes(optionId) ? [typeof option === "string" ? option : option.label] : [];
    }) ?? [];
    const fields = Object.values(answer.fields ?? {}).filter(value => typeof value === "string");
    return [...labels, ...sentences(answer.freeText), ...fields];
  });
}

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });

function sentences(text: string | undefined): string[] {
  return text ? Array.from(sentenceSegmenter.segment(text), ({ segment }) => segment.trim()) : [];
}
