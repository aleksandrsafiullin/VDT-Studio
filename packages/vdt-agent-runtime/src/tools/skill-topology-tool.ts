import { readExecutableSkillTopology } from "@vdt-studio/vdt-agent";
import { activateRunSkill, loadRunSkillLibrary } from "./run-skill-library";
import type { VdtChangeSet } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { proposeAndMaybeApplyMutation } from "../mutation-pipeline";
import { AgentToolError, type AgentTool } from "../tool-registry";
import { cloneBuilder, combineChangeSets, requireBuilder, requireChangeSet } from "./builder-mutation-utils";

/** Explicit library selection, not host domain routing. The artifact supplies
 * formulas; the actor chooses the skill and every accepted reference default. */
export const skillSeedTopologyTool: AgentTool = {
  name: "skill.seed_topology",
  description: "Instantiate a complete executable topology from an explicitly selected/read skill on a blank root. Select illustrative reference defaults with defaults:{inputId:true}; all other numeric inputs remain unknown.",
  inputSchema: z.object({
    skillId: z.string().min(1).max(160),
    defaults: z.record(z.literal(true)).refine((value) => Object.keys(value).length <= 24, "Select at most 24 illustrative defaults.")
  }).strict(),
  outputSchema: z.record(z.unknown()), mutatesProject: true, requiresDraftProject: true, phase: "building_graph",
  async run(context, input) {
    const library = await loadRunSkillLibrary(context);
    const skill = library.byId.get(input.skillId);
    if (!skill) throw new AgentToolError("SKILL_NOT_FOUND", `Skill "${input.skillId}" was not found.`);
    const topology = readExecutableSkillTopology(skill);
    if (!topology) throw new AgentToolError("EXECUTABLE_TOPOLOGY_NOT_FOUND", "The selected skill has no complete executable topology. Read its guidance and choose another public builder tool.");
    const builder = requireBuilder(context.builder); const project = builder.getProject();
    const root = project.graph.nodes.find((node) => node.id === project.rootNodeId);
    if (!root || project.graph.nodes.length !== 1 || root.formula?.trim() || Number.isFinite(root.baselineValue ?? root.value))
      throw new AgentToolError("TOPOLOGY_REQUIRES_BLANK_ROOT", "Executable topology seeding requires a blank root; existing work must be edited with builder tools.");
    const period = context.getRun().request.input.timePeriod;
    if ((root.unit && root.unit !== topology.rootUnit) || (period && period.toLowerCase() !== topology.timePeriod.toLowerCase()))
      throw new AgentToolError("TOPOLOGY_SCOPE_MISMATCH", `This topology calculates ${topology.rootUnit} over ${topology.timePeriod}; preserve the user's requested unit and period and choose a matching model.`);
    if (topology.nodes.some((node) => node.id === root.id)) throw new AgentToolError("TOPOLOGY_ID_COLLISION", "A topology node ID collides with the existing root.");
    const selectedDefaults = Object.keys(input.defaults);
    if (selectedDefaults.length && context.getRun().request.options?.continueWithAssumptions !== true)
      throw new AgentToolError("ASSUMPTIONS_NOT_AUTHORIZED", "Illustrative reference defaults require permission to continue with explicit assumptions.");
    const byId = new Map(topology.nodes.map((node) => [node.id, node]));
    for (const nodeId of selectedDefaults) if (!byId.get(nodeId)?.illustrativeDefault)
      throw new AgentToolError("UNKNOWN_REFERENCE_DEFAULT", `No illustrative reference default exists for "${nodeId}".`);
    const preview = cloneBuilder(context); const changes: VdtChangeSet[] = [];
    const remaining = [...topology.nodes]; const added = new Set<string>();
    while (remaining.length) {
      const index = remaining.findIndex((node) => node.parentId === "$root" || added.has(node.parentId));
      if (index < 0) throw new AgentToolError("INVALID_EXECUTABLE_TOPOLOGY", "Topology parents cannot be ordered.");
      const node = remaining.splice(index, 1)[0]!;
      const estimate = input.defaults[node.id] ? node.illustrativeDefault : undefined;
      const result = preview.addDriver({
        parentNodeId: node.parentId === "$root" ? root.id : node.parentId,
        nodeId: node.id, name: node.name, unit: node.unit, type: node.type,
        ...(estimate ? { baselineValue: estimate.value, assumptions: [estimate.note] } : {})
      });
      changes.push(requireChangeSet(result.changeSet)); added.add(node.id);
      if (node.type === "input") changes.push(requireChangeSet(preview.updateNode({ nodeId: node.id, patch: estimate ? {
        valueStatus: "default_assumption", valueSource: {
          sourceTier: "illustrative_skill_reference", confidence: "draft", catalogRef: `${skill.id}@${skill.frontmatter.version ?? 1}:${node.id}`,
          editableInDialog: true, acceptedByUserInDialog: false, note: estimate.note
        }
      } : { valueStatus: "unknown" } }).changeSet));
    }
    for (const node of topology.nodes) if (node.formula)
      changes.push(requireChangeSet(preview.setFormula({ nodeId: node.id, formula: node.formula }).changeSet));
    changes.push(requireChangeSet(preview.setFormula({ nodeId: root.id, formula: topology.rootFormula }).changeSet));
    const state = context.store.getState(context.runId);
    if (!state.selectedSkills.some((entry) => entry.id === skill.id)) activateRunSkill(context, skill, "Executable topology explicitly selected by the agent.");
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Executable skill topology selected", summary: `Instantiated ${topology.nodes.length} drivers from ${skill.id}; explicitly selected ${selectedDefaults.length} illustrative defaults.`,
      changeSet: combineChangeSets(changes, context), targetNodeId: root.id, allowSkillDefinedDepth: true
    });
    return { skillId: skill.id, rootNodeId: root.id, addedNodeIds: [...added], selectedDefaultInputIds: selectedDefaults,
      remainingInputIds: topology.nodes.filter((node) => node.type === "input" && !input.defaults[node.id]).map((node) => node.id),
      revision: mutation.revision, validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status } };
  }
};
