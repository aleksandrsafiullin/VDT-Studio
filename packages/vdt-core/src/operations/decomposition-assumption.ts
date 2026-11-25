import { applyNodePatch } from "../changeset/node-patch";
import type { VdtNode, VdtProject } from "../types";
import type { OperationContext } from "./context";

export const decompositionAssumptionLimits = { text: 400, sourceId: 160, note: 3600 } as const;

export type DecompositionAssumptionEvidence =
  | { kind: "provisional" }
  | { kind: "user_confirmed"; sourceId: string; quote: string };

export interface DecompositionAssumptionCommand {
  nodeId: string;
  statement: string;
  changesConclusionWhen: string;
  /** Confirmed evidence is verified by the host in the current project. */
  evidence: DecompositionAssumptionEvidence;
  /** Exact note from the observed draft. Omit to add a new assumption. */
  previousNote?: string | undefined;
}

export type DecompositionAssumption = Omit<DecompositionAssumptionCommand, "nodeId" | "previousNote"> & {
  note: string;
};

export type DecompositionAssumptionResult =
  | {
    status: "ok";
    project: VdtProject;
    patch: { assumptions: string[] };
    result: DecompositionAssumption & { nodeId: string; operationId: string };
  }
  | { status: "error"; code: "NODE_NOT_FOUND" | "INVALID_ASSUMPTION" | "STALE_ASSUMPTION"; message: string };

const statementPrefix = "Decomposition assumption: ";
const changePrefix = "Reconsider if: ";
const confirmedPrefix = "Confirmed user source: ";
const provisional = "Evidence: Provisional";

export function readDecompositionAssumptions(node: Pick<VdtNode, "assumptions">): DecompositionAssumption[] {
  return (node.assumptions ?? []).flatMap((note) => {
    const [statement, change, source, ...extra] = note.split("\n");
    if (extra.length || !statement?.startsWith(statementPrefix) || !change?.startsWith(changePrefix)) return [];
    const relationship = statement.slice(statementPrefix.length);
    const changesConclusionWhen = change.slice(changePrefix.length);
    const evidence = readEvidence(source);
    if (!evidence || !validLine(relationship) || !validLine(changesConclusionWhen)) return [];
    return [{ note, statement: relationship, changesConclusionWhen, evidence }];
  });
}

export function applyDecompositionAssumptionOperation(
  project: VdtProject, command: DecompositionAssumptionCommand, context: OperationContext
): DecompositionAssumptionResult {
  const { nodeId, previousNote, evidence } = command;
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return { status: "error", code: "NODE_NOT_FOUND", message: `Node "${nodeId}" was not found.` };

  const statement = command.statement.trim();
  const changesConclusionWhen = command.changesConclusionWhen.trim();
  if (!validLine(statement) || !validLine(changesConclusionWhen) || !validEvidence(evidence)) {
    return { status: "error", code: "INVALID_ASSUMPTION", message: "Provide a relationship, when the conclusion would change, and confirmed evidence or provisional status." };
  }

  const assumptions = node.assumptions ?? [];
  const previousIndex = previousNote === undefined ? -1 : assumptions.indexOf(previousNote);
  if (previousNote !== undefined
    && (previousIndex < 0 || !readDecompositionAssumptions({ assumptions: [previousNote] }).length)) {
    return { status: "error", code: "STALE_ASSUMPTION", message: "The assumption changed. Read the current assumption before revising it." };
  }

  const source = evidence.kind === "provisional"
    ? provisional
    : confirmedPrefix + JSON.stringify([evidence.sourceId, evidence.quote]);
  const note = [statementPrefix + statement, changePrefix + changesConclusionWhen, source].join("\n");
  if (note.length > decompositionAssumptionLimits.note) {
    return { status: "error", code: "INVALID_ASSUMPTION", message: "The assumption evidence is too long." };
  }

  const nextAssumptions = [...assumptions];
  if (previousIndex >= 0 && assumptions[previousIndex] !== note) {
    nextAssumptions.splice(previousIndex, 1, ...(assumptions.includes(note) ? [] : [note]));
  } else if (!assumptions.includes(note)) {
    nextAssumptions.push(note);
  }
  const patch = { assumptions: nextAssumptions };
  const changed = assumptions.length !== nextAssumptions.length || assumptions.some((existing, index) => existing !== nextAssumptions[index]);
  return {
    status: "ok",
    project: changed ? {
      ...project,
      updatedAt: context.now,
      graph: {
        ...project.graph,
        nodes: project.graph.nodes.map((candidate) => candidate.id === nodeId ? applyNodePatch(candidate, patch, context.now) : candidate)
      }
    } : project,
    patch,
    result: { operationId: context.operationId, nodeId, note, statement, changesConclusionWhen, evidence }
  };
}

function validLine(text: string): boolean {
  return !!text.trim() && text.length <= decompositionAssumptionLimits.text && !/[\r\n]/u.test(text);
}

function validEvidence(evidence: DecompositionAssumptionEvidence): boolean {
  return evidence.kind === "provisional" || (evidence.kind === "user_confirmed"
    && !!evidence.sourceId.trim() && evidence.sourceId.length <= decompositionAssumptionLimits.sourceId
    && !!evidence.quote.trim() && evidence.quote.length <= decompositionAssumptionLimits.text);
}

function readEvidence(source: string | undefined): DecompositionAssumptionEvidence | undefined {
  if (source === provisional) return { kind: "provisional" };
  if (!source?.startsWith(confirmedPrefix)) return undefined;
  try {
    const fields: unknown = JSON.parse(source.slice(confirmedPrefix.length));
    if (!Array.isArray(fields) || fields.length !== 2) return undefined;
    const [sourceId, quote] = fields;
    if (typeof sourceId !== "string" || typeof quote !== "string") return undefined;
    const evidence = { kind: "user_confirmed", sourceId, quote } as const;
    return validEvidence(evidence) ? evidence : undefined;
  } catch {
    return undefined;
  }
}
