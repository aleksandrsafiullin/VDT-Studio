import { z } from "zod";
import { extractFormulaReferences, type VdtChangeSet, type VdtNodePatch } from "@vdt-studio/vdt-core";
import { proposeAndMaybeApplyMutation } from "../mutation-pipeline";
import { AgentToolError, type AgentTool } from "../tool-registry";
import { cloneBuilder, combineChangeSets, requireChangeSet } from "./builder-mutation-utils";

const edgeRelationSchema = z.enum([
  "positive_driver",
  "negative_driver",
  "multiplicative_driver",
  "divisive_driver",
  "additive_component",
  "subtractive_component",
  "contextual_influence",
  "formula_dependency"
]);

export function createRepairTools(): AgentTool[] {
  return [repairMissingFormulaReferenceTool, repairOrphanNodeTool, repairDuplicateNodeIdTool];
}

const repairMissingFormulaReferenceTool: AgentTool = {
  name: "vdt.repair_missing_formula_reference",
  description: "Repair one missing formula reference by renaming, creating an input node, or neutralizing the reference.",
  inputSchema: z.object({
    nodeId: z.string().min(1).max(160),
    missingReference: z.string().min(1).max(160),
    strategy: z.enum(["rename_to_existing", "create_input_node", "remove_reference"]),
    replacementNodeId: z.string().max(160).optional(),
    newNode: z.object({
      parentNodeId: z.string().min(1).max(160),
      nodeId: z.string().min(1).max(160),
      name: z.string().min(1).max(200),
      unit: z.string().max(80).optional(),
      baselineValue: z.number().finite().optional()
    }).optional()
  }),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "repairing_graph",
  run(context, input) {
    const builder = context.builder;
    if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
    let project = builder.getProject();
    const node = project.graph.nodes.find((candidate) => candidate.id === input.nodeId);
    if (!node) throw new AgentToolError("NODE_NOT_FOUND", `Node "${input.nodeId}" was not found.`);
    if (!node.formula) throw new AgentToolError("FORMULA_NOT_FOUND", `Node "${input.nodeId}" does not have a formula.`);

    let formula = node.formula;
    let addedNodeId: string | undefined;
    const previewBuilder = cloneBuilder(context);
    const changeSets: VdtChangeSet[] = [];
    if (input.strategy === "rename_to_existing") {
      if (!input.replacementNodeId) {
        throw new AgentToolError("REPLACEMENT_REQUIRED", "replacementNodeId is required for rename_to_existing.");
      }
      if (!project.graph.nodes.some((candidate) => candidate.id === input.replacementNodeId)) {
        throw new AgentToolError("REPLACEMENT_NOT_FOUND", `Replacement node "${input.replacementNodeId}" was not found.`);
      }
      formula = renameReference(formula, input.missingReference, input.replacementNodeId);
    } else if (input.strategy === "create_input_node") {
      if (!input.newNode) throw new AgentToolError("NEW_NODE_REQUIRED", "newNode is required for create_input_node.");
      if (!project.graph.nodes.some((candidate) => candidate.id === input.newNode!.parentNodeId)) {
        throw new AgentToolError("PARENT_NOT_FOUND", `Parent node "${input.newNode.parentNodeId}" was not found.`);
      }
      if (!project.graph.nodes.some((candidate) => candidate.id === input.newNode!.nodeId)) {
        const added = previewBuilder.addDriver({
          parentNodeId: input.newNode.parentNodeId,
          nodeId: input.newNode.nodeId,
          name: input.newNode.name,
          type: "input",
          unit: input.newNode.unit,
          relation: "formula_dependency",
          baselineValue: input.newNode.baselineValue
        });
        changeSets.push(requireChangeSet(added.changeSet));
        addedNodeId = added.changeSet?.additions[0]?.nodeId ?? input.newNode.nodeId;
      }
      formula = input.newNode.nodeId === input.missingReference
        ? formula
        : renameReference(formula, input.missingReference, input.newNode.nodeId);
    } else {
      formula = renameReference(formula, input.missingReference, "1");
    }

    project = previewBuilder.getProject();
    const available = new Set(project.graph.nodes.map((candidate) => candidate.id));
    const stillMissing = extractFormulaReferences(formula).filter((reference) => !available.has(reference));
    if (stillMissing.length > 0) {
      throw new AgentToolError("MISSING_FORMULA_REFERENCES", `Repair still leaves missing references: ${stillMissing.join(", ")}.`, {
        missingReferences: stillMissing
      });
    }

    const result = previewBuilder.setFormula({ nodeId: input.nodeId, formula });
    changeSets.push(requireChangeSet(result.changeSet));
    context.emit({
      type: "repair_started",
      phase: "repairing_graph",
      title: "Formula reference repaired",
      message: `Repaired missing reference "${input.missingReference}" on "${input.nodeId}".`,
      metadata: { strategy: input.strategy, nodeId: input.nodeId, addedNodeId }
    });
    const mutation = proposeAndMaybeApplyMutation(context, {
      source: "repair",
      title: "Formula repair applied",
      summary: result.event.message,
      changeSet: combineChangeSets(changeSets, context),
      targetNodeId: input.nodeId
    });
    return {
      repaired: true,
      strategy: input.strategy,
      nodeId: input.nodeId,
      formula,
      addedNodeId,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};

const repairOrphanNodeTool: AgentTool = {
  name: "vdt.repair_orphan_node",
  description: "Attach an orphan node to an existing node with a new edge.",
  inputSchema: z.object({
    nodeId: z.string().min(1).max(160),
    attachToNodeId: z.string().min(1).max(160),
    relation: edgeRelationSchema
  }),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "repairing_graph",
  run(context, input) {
    const builder = context.builder;
    if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
    const previewBuilder = cloneBuilder(context);
    const result = previewBuilder.addEdge({
      sourceNodeId: input.attachToNodeId,
      targetNodeId: input.nodeId,
      relation: input.relation
    });
    const mutation = proposeAndMaybeApplyMutation(context, {
      source: "repair",
      title: "Orphan node attached",
      summary: result.event.message,
      changeSet: requireChangeSet(result.changeSet),
      targetNodeId: input.attachToNodeId
    });
    return {
      repaired: true,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};

const repairDuplicateNodeIdTool: AgentTool = {
  name: "vdt.repair_duplicate_node_id",
  description: "Rename one node id and optionally update formula references.",
  inputSchema: z.object({
    nodeId: z.string().min(1).max(160),
    newNodeId: z.string().min(1).max(160),
    updateFormulaReferences: z.boolean().optional()
  }),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "repairing_graph",
  run(context, input) {
    const builder = context.builder;
    if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
    const project = builder.getProject();
    if (!project.graph.nodes.some((node) => node.id === input.nodeId)) {
      throw new AgentToolError("NODE_NOT_FOUND", `Node "${input.nodeId}" was not found.`);
    }
    if (project.graph.nodes.some((node) => node.id === input.newNodeId)) {
      throw new AgentToolError("NODE_ID_EXISTS", `Node "${input.newNodeId}" already exists.`);
    }
    const target = project.graph.nodes.find((node) => node.id === input.nodeId)!;
    const previewBuilder = cloneBuilder(context);
    const changeSets: VdtChangeSet[] = [];
    const deleted = previewBuilder.deleteNode({ nodeId: input.nodeId, cascadeEdges: true });
    changeSets.push(requireChangeSet(deleted.changeSet));
    const parentEdge = project.graph.edges.find((edge) => edge.targetNodeId === input.nodeId);
    const parentNodeId = parentEdge?.sourceNodeId ?? project.rootNodeId;
    const added = previewBuilder.addDriver({
      parentNodeId,
      nodeId: input.newNodeId,
      name: target.name,
      type: target.type,
      unit: target.unit,
      relation: parentEdge?.relation ?? "positive_driver",
      formula: target.formula,
      baselineValue: target.baselineValue,
      description: target.description,
      assumptions: target.assumptions
    });
    changeSets.push(requireChangeSet(added.changeSet));
    if (input.updateFormulaReferences === true) {
      for (const node of previewBuilder.getProject().graph.nodes) {
        if (!node.formula?.includes(input.nodeId)) continue;
        const updated = previewBuilder.updateNode({
          nodeId: node.id,
          patch: { formula: renameReference(node.formula, input.nodeId, input.newNodeId) } as VdtNodePatch
        });
        changeSets.push(requireChangeSet(updated.changeSet));
      }
    }
    const mutation = proposeAndMaybeApplyMutation(context, {
      source: "repair",
      title: "Duplicate node id repaired",
      summary: `Renamed "${input.nodeId}" to "${input.newNodeId}".`,
      changeSet: combineChangeSets(changeSets, context),
      targetNodeId: parentNodeId
    });
    return {
      repaired: true,
      oldNodeId: input.nodeId,
      newNodeId: input.newNodeId,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};

function renameReference(formula: string, from: string, to: string): string {
  return formula.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, "g"), to);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
