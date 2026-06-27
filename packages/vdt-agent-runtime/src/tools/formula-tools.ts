import { z } from "zod";
import { extractFormulaReferences, parseFormula } from "@vdt-studio/vdt-core";
import type { AgentTool } from "../tool-registry";

export function createFormulaTools(): AgentTool[] {
  return [
    formulaParseTool,
    formulaExtractReferencesTool,
    formulaCheckReferencesTool,
    formulaRenameReferenceTool,
    formulaSuggestReferenceRepairTool
  ];
}

const formulaParseTool: AgentTool = {
  name: "formula.parse",
  description: "Parse a formula and return references or a parse error.",
  inputSchema: z.object({ formula: z.string().min(1).max(500) }),
  outputSchema: z.record(z.unknown()),
  phase: "validating_graph",
  run(_context, input) {
    try {
      parseFormula(input.formula);
      return { valid: true, references: extractFormulaReferences(input.formula) };
    } catch (error) {
      return {
        valid: false,
        references: [],
        error: error instanceof Error ? error.message : "Formula could not be parsed."
      };
    }
  }
};

const formulaExtractReferencesTool: AgentTool = {
  name: "formula.extract_references",
  description: "Extract formula references from a parser-valid formula.",
  inputSchema: z.object({ formula: z.string().min(1).max(500) }),
  outputSchema: z.record(z.unknown()),
  phase: "validating_graph",
  run(_context, input) {
    try {
      return { references: extractFormulaReferences(input.formula) };
    } catch {
      return { references: [] };
    }
  }
};

const formulaCheckReferencesTool: AgentTool = {
  name: "formula.check_references",
  description: "Check formula references against the current draft node ids.",
  inputSchema: z.object({
    formula: z.string().min(1).max(500),
    nodeId: z.string().max(160).optional()
  }),
  outputSchema: z.record(z.unknown()),
  phase: "validating_graph",
  run(context, input) {
    const project = context.builder?.getProject() ?? context.store.getSnapshot(context.runId).draftProject;
    const availableNodeIds = project?.graph.nodes.map((node) => node.id) ?? [];
    let references: string[] = [];
    let parseError: string | undefined;
    try {
      references = extractFormulaReferences(input.formula);
    } catch (error) {
      parseError = error instanceof Error ? error.message : "Formula could not be parsed.";
    }
    const available = new Set(availableNodeIds);
    const missingReferences = references.filter((reference) => !available.has(reference));
    return {
      valid: !parseError && missingReferences.length === 0,
      references,
      missingReferences,
      availableNodeIds,
      similarNodeIds: Object.fromEntries(missingReferences.map((reference) => [reference, similarNodeIds(reference, availableNodeIds)])),
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(parseError ? { error: parseError } : {})
    };
  }
};

const formulaRenameReferenceTool: AgentTool = {
  name: "formula.rename_reference",
  description: "Rename one formula reference token deterministically.",
  inputSchema: z.object({
    formula: z.string().min(1).max(500),
    from: z.string().min(1).max(160),
    to: z.string().min(1).max(160)
  }),
  outputSchema: z.record(z.unknown()),
  phase: "repairing_graph",
  run(_context, input) {
    const pattern = new RegExp(`\\b${escapeRegExp(input.from)}\\b`, "g");
    const formula = input.formula.replace(pattern, input.to);
    return { formula, changed: formula !== input.formula };
  }
};

const formulaSuggestReferenceRepairTool: AgentTool = {
  name: "formula.suggest_reference_repair",
  description: "Suggest existing node ids for a missing formula reference using deterministic string similarity.",
  inputSchema: z.object({
    missingReference: z.string().min(1).max(160),
    availableNodeIds: z.array(z.string().max(160)).max(200).optional()
  }),
  outputSchema: z.record(z.unknown()),
  phase: "repairing_graph",
  run(context, input) {
    const project = context.builder?.getProject() ?? context.store.getSnapshot(context.runId).draftProject;
    const availableNodeIds = input.availableNodeIds ?? project?.graph.nodes.map((node) => node.id) ?? [];
    return {
      suggestions: similarNodeIds(input.missingReference, availableNodeIds).map((nodeId) => ({
        nodeId,
        confidence: similarity(input.missingReference, nodeId),
        reason: `Node id is similar to missing reference "${input.missingReference}".`
      }))
    };
  }
};

function similarNodeIds(reference: string, availableNodeIds: string[]): string[] {
  return availableNodeIds
    .map((nodeId) => ({ nodeId, score: similarity(reference, nodeId) }))
    .filter((entry) => entry.score > 0.2)
    .sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId))
    .slice(0, 5)
    .map((entry) => entry.nodeId);
}

function similarity(left: string, right: string): number {
  if (left === right) return 1;
  const leftParts = new Set(left.toLowerCase().split(/[_\W]+/).filter(Boolean));
  const rightParts = new Set(right.toLowerCase().split(/[_\W]+/).filter(Boolean));
  const intersection = [...leftParts].filter((part) => rightParts.has(part)).length;
  const union = new Set([...leftParts, ...rightParts]).size || 1;
  const tokenScore = intersection / union;
  const prefixScore = right.startsWith(left) || left.startsWith(right) ? 0.5 : 0;
  return Math.max(tokenScore, prefixScore);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
