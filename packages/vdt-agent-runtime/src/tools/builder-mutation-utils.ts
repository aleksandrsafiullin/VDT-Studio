import { VdtBuilderSession, type VdtChangeSet } from "@vdt-studio/vdt-core";
import { AgentToolError, type AgentToolContext } from "../tool-registry";

export function cloneBuilder(context: AgentToolContext): VdtBuilderSession {
  const builder = requireBuilder(context.builder);
  return new VdtBuilderSession({
    project: builder.getProject(),
    providerId: context.getRun().request.providerId
  });
}

export function requireBuilder(builder: VdtBuilderSession | undefined): VdtBuilderSession {
  if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
  return builder;
}

export function requireChangeSet(changeSet: VdtChangeSet | undefined): VdtChangeSet {
  if (!changeSet) throw new AgentToolError("MUTATION_CHANGESET_MISSING", "Builder operation did not produce a change set.");
  return changeSet;
}

export function combineChangeSets(changeSets: VdtChangeSet[], context: AgentToolContext): VdtChangeSet {
  if (changeSets.length === 0) {
    throw new AgentToolError("MUTATION_CHANGESET_MISSING", "Batch operation did not produce change sets.");
  }
  const first = changeSets[0]!;
  return {
    id: `changeset_${context.runId}_batch_${Date.now()}`,
    taskType: first.taskType,
    backendId: first.backendId,
    createdAt: new Date().toISOString(),
    additions: changeSets.flatMap((changeSet) => changeSet.additions),
    updates: changeSets.flatMap((changeSet) => changeSet.updates),
    deletions: changeSets.flatMap((changeSet) => changeSet.deletions),
    edgeChanges: changeSets.flatMap((changeSet) => changeSet.edgeChanges),
    assumptions: changeSets.flatMap((changeSet) => changeSet.assumptions),
    questions: changeSets.flatMap((changeSet) => changeSet.questions),
    warnings: changeSets.flatMap((changeSet) => changeSet.warnings)
  };
}
