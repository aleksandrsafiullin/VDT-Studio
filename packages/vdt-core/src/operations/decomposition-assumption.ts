import { parseValidationUnit } from "../formula/unit-validation";
import { applyNodePatch } from "../changeset/node-patch";
import type { VdtNode, VdtProject } from "../types";
import type { OperationContext } from "./context";

export const decompositionAssumptionLimits = { text: 400, sourceId: 160, note: 3600, unit: 80 } as const;

export type DecompositionAssumptionEvidence =
  | { kind: "provisional" }
  | { kind: "user_confirmed"; sourceId: string; quote: string };

const sameUnitRelationshipKinds = ["serial_capacity", "independent_additive"] as const;
export const decompositionRelationshipKinds = [...sameUnitRelationshipKinds, "quantity_rate"] as const;

export interface SameUnitDecompositionRelationship {
  kind: typeof sameUnitRelationshipKinds[number];
  operandNodeIds: [string, string];
  unit: string;
}

export interface QuantityRateDecompositionRelationship {
  kind: "quantity_rate";
  /** The quantity ID is first and the per-item rate ID is second. */
  operandNodeIds: [string, string];
  operandUnits: [string, string];
  unit: string;
}

export type DecompositionRelationship = SameUnitDecompositionRelationship | QuantityRateDecompositionRelationship;

export interface DecompositionAssumptionCommand {
  nodeId: string;
  statement: string;
  changesConclusionWhen: string;
  /** Confirmed evidence is verified by the host in the current project. */
  evidence: DecompositionAssumptionEvidence;
  relationship?: DecompositionRelationship | undefined;
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
const relationshipPrefix = "Decomposition relationship v1: ";
const quantityRatePrefix = "Decomposition relationship v2: ";

export function hasTypedDecompositionRelationship(note: string): boolean {
  return /^Decomposition relationship v\d+:/mu.test(note);
}

/** A determinate two-KPI relationship uses the same numerical basis throughout. */
export function decompositionRelationshipUnit(unit: string | undefined): string | undefined {
  const text = unit?.normalize("NFKC").trim();
  if (!text) return undefined;
  // Retain case for custom symbols such as MW and mW. For lowercase units,
  // share the formula parser's aliases and keep differing scales distinct.
  const parsed = text === text.toLowerCase() ? parseValidationUnit(text, true) : undefined;
  return parsed ? JSON.stringify(parsed) : text;
}

function parseQuantityRateUnit(unit: string | undefined) {
  // USD is a known currency symbol. Other uppercase terms may encode scale.
  const text = unit?.normalize("NFKC").trim().replace(/\bUSD\b/gu, "usd");
  return text && text === text.toLowerCase() ? parseValidationUnit(text, true, { requireKnownFiniteBasis: true }) : undefined;
}

function hasQuantityRateBasis(quantityUnit: string, rateUnit: string, outputUnit: string): boolean {
  const quantity = parseQuantityRateUnit(quantityUnit);
  const rate = parseQuantityRateUnit(rateUnit);
  const output = parseQuantityRateUnit(outputUnit);
  return !!quantity && Object.keys(quantity).length === 1 && Object.hasOwn(quantity, "count") && quantity.count === 1
    && !!rate && Object.hasOwn(rate, "count") && rate.count === -1
    && !!output && !Object.hasOwn(output, "count") && Object.keys(rate).length === Object.keys(output).length + 1
    && Object.entries(output).every(([term, power]) => Object.hasOwn(rate, term) && rate[term] === power);
}

export function decompositionRelationshipOperands(
  node: VdtNode, relationship: DecompositionRelationship, nodes: ReadonlyMap<string, VdtNode>
): [VdtNode, VdtNode] | undefined {
  const [first, second] = relationship.operandNodeIds.map(id => nodes.get(id));
  if (!first || !second || first.id === second.id || first.id === node.id || second.id === node.id
    || [node, first, second].some(item => item.status === "rejected")) return undefined;

  if (relationship.kind === "quantity_rate") {
    const [quantityUnit, rateUnit] = relationship.operandUnits;
    if (!hasQuantityRateBasis(quantityUnit, rateUnit, relationship.unit)) return undefined;
    const sameBasis = (live: string | undefined, captured: string) => {
      const basis = parseQuantityRateUnit(live);
      return basis !== undefined && JSON.stringify(basis) === JSON.stringify(parseQuantityRateUnit(captured));
    };
    if (!sameBasis(first.unit, quantityUnit) || !sameBasis(second.unit, rateUnit) || !sameBasis(node.unit, relationship.unit)) return undefined;
  } else if ([node, first, second].some(item =>
    decompositionRelationshipUnit(item.unit) !== decompositionRelationshipUnit(relationship.unit))) return undefined;
  return [first, second];
}

function validRelationshipUnit(value: unknown): value is string {
  return typeof value === "string" && value.length <= decompositionAssumptionLimits.unit && validLine(value);
}

function readRelationship(value: unknown): DecompositionRelationship | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { kind, operandNodeIds, unit, operandUnits } = value as Record<string, unknown>;
  if (!validRelationshipUnit(unit) || !Array.isArray(operandNodeIds) || operandNodeIds.length !== 2) return undefined;
  const validId = (id: unknown): id is string =>
    typeof id === "string" && id.length <= decompositionAssumptionLimits.sourceId && validLine(id);
  const [firstId, secondId] = operandNodeIds;
  if (!validId(firstId) || !validId(secondId) || firstId === secondId) return undefined;
  const operands: [string, string] = [firstId, secondId];
  if ((kind === "serial_capacity" || kind === "independent_additive") && Object.keys(value).length === 3) {
    return { kind, operandNodeIds: operands, unit };
  }
  if (kind !== "quantity_rate" || Object.keys(value).length !== 4 || !Array.isArray(operandUnits) || operandUnits.length !== 2) return undefined;
  const [quantityUnit, rateUnit] = operandUnits;
  if (!validRelationshipUnit(quantityUnit) || !validRelationshipUnit(rateUnit)
    || !hasQuantityRateBasis(quantityUnit, rateUnit, unit)) return undefined;
  return { kind, operandNodeIds: operands, operandUnits: [quantityUnit, rateUnit], unit };
}

function decodeRelationship(line: string): DecompositionRelationship | undefined {
  const isQuantityRate = line.startsWith(quantityRatePrefix);
  const prefix = isQuantityRate ? quantityRatePrefix : relationshipPrefix;
  if (!line.startsWith(prefix)) return undefined;
  try {
    const relationship = readRelationship(JSON.parse(line.slice(prefix.length)));
    return relationship && (relationship.kind === "quantity_rate") === isQuantityRate ? relationship : undefined;
  } catch {
    return undefined;
  }
}

export function readDecompositionAssumptions(node: Pick<VdtNode, "assumptions">): DecompositionAssumption[] {
  return (node.assumptions ?? []).flatMap((note) => {
    const [statement, change, source, typed, ...extra] = note.split("\n");
    if (extra.length || !statement?.startsWith(statementPrefix) || !change?.startsWith(changePrefix)) return [];
    const relationship = statement.slice(statementPrefix.length);
    const changesConclusionWhen = change.slice(changePrefix.length);
    const evidence = readEvidence(source);
    if (!evidence || !validLine(relationship) || !validLine(changesConclusionWhen)) return [];
    const typedRelationship = typed !== undefined && note.length <= decompositionAssumptionLimits.note ? decodeRelationship(typed) : undefined;
    if (typed !== undefined && (!typedRelationship || evidence.kind !== "user_confirmed")) return [];
    return [{ note, statement: relationship, changesConclusionWhen, evidence, ...(typedRelationship && { relationship: typedRelationship }) }];
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

  const relationship = readRelationship(command.relationship);
  if (command.relationship !== undefined && (!relationship || evidence.kind !== "user_confirmed"
    || !decompositionRelationshipOperands(node, relationship, new Map(project.graph.nodes.map(candidate => [candidate.id, candidate]))))) {
    const message = command.relationship?.kind === "quantity_rate"
      ? "Confirm the relationship and choose a quantity and per-item rate on the output's numerical basis."
      : "Confirm the relationship and choose two distinct existing KPIs on the same unit basis as the output.";
    return { status: "error", code: "INVALID_ASSUMPTION", message };
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
  const lines = [statementPrefix + statement, changePrefix + changesConclusionWhen, source];
  if (relationship) lines.push((relationship.kind === "quantity_rate" ? quantityRatePrefix : relationshipPrefix) + JSON.stringify(relationship));
  const note = lines.join("\n");
  if (note.length > decompositionAssumptionLimits.note) {
    return { status: "error", code: "INVALID_ASSUMPTION", message: "The assumption evidence is too long." };
  }

  if (relationship && assumptions.some((existing, index) =>
    index !== previousIndex && existing !== note && hasTypedDecompositionRelationship(existing))) {
    return { status: "error", code: "INVALID_ASSUMPTION", message: "Revise the existing typed relationship for this KPI." };
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
    result: { operationId: context.operationId, nodeId, note, statement, changesConclusionWhen, evidence,
      ...(relationship && { relationship }) }
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
