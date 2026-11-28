import { createHash } from "node:crypto";
import { z } from "zod";
import {
  applyDecompositionAssumptionOperation, decompositionAssumptionLimits,
  decompositionRelationshipOperands, hasTypedDecompositionRelationship, readDecompositionAssumptions,
  type DecompositionAssumptionEvidence, type DecompositionRelationship, type VdtNode
} from "@vdt-studio/vdt-core";
import { proposeAndMaybeApplyMutation } from "../mutation-pipeline";
import { AgentToolError, type AgentTool } from "../tool-registry";
import type { AgentChatMessage } from "../types";
import { cloneBuilder, requireBuilder, requireChangeSet } from "./builder-mutation-utils";

const nodeId = z.string().min(1).max(160);
const line = z.string().trim().min(1).max(decompositionAssumptionLimits.text).regex(/^[^\r\n]+$/u);
const unit = z.string().trim().min(1).max(decompositionAssumptionLimits.unit);
const relationshipFields = { operandNodeIds: z.tuple([nodeId, nodeId]), unit };
const relationshipInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["serial_capacity", "independent_additive"]), ...relationshipFields }).strict(),
  z.object({ kind: z.literal("quantity_rate"), ...relationshipFields, operandUnits: z.tuple([unit, unit]) }).strict()
]).nullish();

const writeInput = z.object({
  nodeId,
  statement: line,
  changesConclusionWhen: line,
  sourceMessageId: z.string().min(1).max(decompositionAssumptionLimits.sourceId).nullable(),
  previousNote: z.string().min(1).max(decompositionAssumptionLimits.note).nullable(),
  relationship: relationshipInput
}).strict();

export function createDecompositionAssumptionTools(): AgentTool[] {
  return [readAssumptions, recordAssumption];
}

const readInput = z.object({ nodeId, relationship: writeInput.shape.relationship }).strict();

const readAssumptions: AgentTool<z.infer<typeof readInput>> = {
  name: "vdt.read_decomposition_assumptions",
  description: "Read relationship assumptions and recent user source IDs. Supply an optional proposed typed relationship to receive the exact user confirmation choice. Offer the choice in a normal question when the topology needs confirmation. For quantity_rate, list the quantity first and the rate second in both operandNodeIds and operandUnits. The unit is the output unit.",
  inputSchema: readInput,
  outputSchema: z.record(z.string(), z.unknown()),
  requiresDraftProject: true,
  phase: "planning_decomposition",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const nodes = new Map(builder.getProject().graph.nodes.map(node => [node.id, node]));
    const node = nodes.get(input.nodeId);
    if (!node) throw new AgentToolError("NODE_NOT_FOUND", "Select an existing node.");
    const assumptions = readDecompositionAssumptions(node);
    const decodedNotes = new Set(assumptions.map(assumption => assumption.note));
    const invalidTypedNote = (node.assumptions ?? []).some(note => hasTypedDecompositionRelationship(note) && !decodedNotes.has(note));
    if (input.relationship && invalidTypedNote) {
      throw new AgentToolError("INVALID_ASSUMPTION", "Repair the invalid saved relationship manually before requesting a new confirmation.");
    }
    const choices = input.relationship && relationshipChoices(node, input.relationship, nodes, builder.getRevision());
    if (input.relationship && !choices) {
      throw new AgentToolError("INVALID_ASSUMPTION", "Choose two distinct existing KPIs with the required units and a valid confirmation label.");
    }
    const { chatMessages } = context.store.getState(context.runId);
    return {
      nodeId: node.id,
      revision: builder.getRevision(),
      assumptions: assumptions.slice(-20),
      ...(invalidTypedNote && { invalidTypedNote: true }),
      ...(choices && { confirmationChoices: choices }),
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
  description: "Record a relationship and when it could change. For confirmed facts, cite the user source ID and its complete sentence or answer label. Use null for provisional facts. Ask or show conditional outcomes for unresolved choices. Use previousNote to revise. A typed relationship needs the user's submitted choice with exact participating KPIs, roles and units. Obtain the wording with vdt.read_decomposition_assumptions on the same relationship.",
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
    const target = project.graph.nodes.find(node => node.id === input.nodeId);
    const previous = input.previousNote && target
      ? readDecompositionAssumptions(target).find(assumption => assumption.note === input.previousNote)
      : undefined;
    if (previous?.relationship && !input.relationship) {
      throw new AgentToolError("ASSUMPTION_SOURCE_UNCONFIRMED", "A confirmed typed relationship can only be replaced by another confirmed typed relationship.");
    }
    if (input.relationship) {
      const nodes = new Map(project.graph.nodes.map(node => [node.id, node]));
      const choices = target && relationshipChoices(target, input.relationship, nodes, builder.getRevision());
      const priorSource = previous?.evidence.kind === "user_confirmed" ? previous.evidence.sourceId : undefined;
      const priorIndex = priorSource ? state.chatMessages.findIndex(message => message.id === priorSource) : -1;
      const sourceIndex = state.chatMessages.findIndex(message => message.id === input.sourceMessageId);
      const staleQuantityRateAnswer = input.relationship.kind === "quantity_rate" && (
        state.chatMessages[sourceIndex]?.runId !== context.runId
        || state.chatMessages.some((message, index) => index > sourceIndex && message.runId === context.runId
          && message.role === "user" && (message.kind === "instruction" || message.kind === "answer"))
      );
      if (!input.sourceMessageId || !choices || sourceIndex < priorIndex || staleQuantityRateAnswer || !hasRelationshipConfirmation(
        state.chatMessages, sourceIndex, input.statement, choices
      )) {
        throw new AgentToolError("ASSUMPTION_SOURCE_UNCONFIRMED", "Ask the user to select the exact current relationship for these KPIs and its unit before recording it.");
      }
    }
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
      relationship: input.relationship ?? undefined,
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

interface RelationshipChoice {
  id: string;
  label: string;
  value: string;
}

function relationshipChoices(
  target: VdtNode, relationship: DecompositionRelationship, nodes: ReadonlyMap<string, VdtNode>, revision: number
): Record<"en" | "ru", RelationshipChoice> | undefined {
  const operands = decompositionRelationshipOperands(target, relationship, nodes);
  if (!operands) return;
  const name = (node: VdtNode) => `${node.name} [${node.id}]`;
  const [first, second] = operands.map(name);
  const output = name(target);
  const unit = relationship.unit;
  const confirm = (label: string, id: string = relationship.kind): RelationshipChoice => ({
    id, label, value: relationship.kind
  });
  if (relationship.kind === "quantity_rate") {
    const [quantityUnit, rateUnit] = relationship.operandUnits;
    // The ordered equation shows the exact roles while the choice ID binds the
    // current draft revision. Changing a basis requires a new user answer.
    const readable = `${output} (${unit}) = ${first} (${quantityUnit}) × ${second} (${rateUnit})`;
    const compact = (node: VdtNode, basis: string) => `${node.name}[${node.id}](${basis})`;
    const label = readable.length <= 160 ? readable
      : `${compact(target, unit)}=${compact(operands[0], quantityUnit)}×${compact(operands[1], rateUnit)}`;
    if (label.length > 160 || !line.safeParse(label).success) return;
    const identity = createHash("sha256").update(JSON.stringify([
      revision, target.id, relationship.operandNodeIds, relationship.operandUnits, unit
    ])).digest("hex");
    const choice = confirm(label, `quantity_rate_${identity}`);
    return { en: choice, ru: choice };
  }
  const labels = relationship.kind === "serial_capacity" ? {
    en: `${output} in ${unit} is limited by the lower capacity of ${first} and ${second}: the same flow passes through both in series without a bypass in the same reporting period.`,
    ru: `${output} в ${unit} ограничен меньшей мощностью ${first} и ${second}: один поток проходит обе стадии последовательно, без обхода, за один отчётный период.`
  } : {
    en: `${output} in ${unit} is the sum of ${first} and ${second}: these flows are independent, do not overlap and use the same reporting period.`,
    ru: `${output} в ${unit} равен сумме ${first} и ${second}: потоки независимы, не пересекаются и относятся к одному отчётному периоду.`
  };
  if (!Object.values(labels).every(label => line.safeParse(label).success)) return;
  return {
    en: confirm(labels.en),
    ru: confirm(labels.ru)
  };
}

function hasRelationshipConfirmation(
  messages: AgentChatMessage[], index: number, statement: string, choices: Record<"en" | "ru", RelationshipChoice>
): boolean {
  const source = messages[index];
  if (source?.role !== "user" || source.kind !== "answer") return false;
  const choice = Object.values(choices).find(candidate => candidate.label === statement);
  if (!choice) return false;
  const questions = priorQuestions(messages, index);
  return (source.answers ?? []).some(answer => {
    if (answer.selectedOptionIds?.length !== 1 || answer.selectedOptionIds[0] !== choice.id) return false;
    const question = questions.find(candidate => candidate.id === answer.questionId);
    return question?.options?.some(option => typeof option !== "string" && option.id === choice.id
      && option.label === choice.label && (choice.value !== "quantity_rate" || option.value === choice.value)) === true;
  });
}

function hasUserConfirmation(messages: AgentChatMessage[], sourceId: string, statement: string): boolean {
  const index = messages.findIndex(message => message.id === sourceId && message.role === "user");
  const source = messages[index];
  if (!source) return false;
  if (source.kind === "instruction") return sentences(source.text).includes(statement);
  return source.kind === "answer" && answerStatements(messages, index).includes(statement);
}

function answerStatements(messages: AgentChatMessage[], index: number): string[] {
  const questions = priorQuestions(messages, index);
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

function priorQuestions(messages: AgentChatMessage[], index: number) {
  return messages.slice(0, index).reverse().flatMap(message =>
    message.role === "assistant" && message.kind === "question" ? message.questions ?? [] : []
  );
}

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });

function sentences(text: string | undefined): string[] {
  return text ? Array.from(sentenceSegmenter.segment(text), ({ segment }) => segment.trim()) : [];
}
