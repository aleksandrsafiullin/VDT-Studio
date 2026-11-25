import { inspectBackCalculation, prepareBackCalculationPatch, type VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { proposeAndMaybeApplyMutation } from "../mutation-pipeline";
import { AgentToolError, type AgentTool } from "../tool-registry";
import { cloneBuilder, requireBuilder, requireChangeSet } from "./builder-mutation-utils";

const nodeId = z.string().min(1).max(160);
const writeInput = z.object({
  nodeId,
  setting: z.object({ targetNodeId: nodeId, targetValue: z.number().finite() }).strict().nullable()
}).strict();

function readResult(project: VdtProject, id: string) {
  const state = inspectBackCalculation(project, id);
  if (state.status === "error") throw new AgentToolError(state.code, state.message);
  const kpi = ({ id, name, unit }: { id: string; name: string; unit?: string | undefined }) => ({ id, name, unit });
  return {
    node: kpi(state.node),
    eligible: state.eligible && !state.blockingKpi,
    blockingKpi: state.blockingKpi ? kpi(state.blockingKpi) : null,
    availableTargets: state.targets.map(kpi),
    setting: state.setting ?? null,
    target: state.target ? kpi(state.target) : null,
    baselineValue: state.value ?? null,
    targetBaseline: state.targetBaseline ?? null,
    sourceValue: state.sourceValue ?? null,
    diagnostics: state.issues.map(({ severity, type, message }) => ({ severity, type, message }))
  };
}

const read: AgentTool<{ nodeId: string }> = {
  name: "vdt.read_back_calculation",
  description: "Inspect a KPI's back-calculation setting, eligible output KPIs, current Baseline result and calculation diagnostics. A balancing result is modeled, with the stored source value retained separately. Inspect before editing or reporting an existing calibration.",
  inputSchema: z.object({ nodeId }).strict(),
  outputSchema: z.record(z.string(), z.unknown()),
  requiresDraftProject: true,
  run(context, input) {
    const builder = requireBuilder(context.builder);
    return { ...readResult(builder.getProject(), input.nodeId), revision: builder.getRevision() };
  }
};

const write: AgentTool<z.infer<typeof writeInput>> = {
  name: "vdt.set_back_calculation",
  description: "Propose setting, editing or clearing the back-calculation of one balancing KPI. Supply a stable balancing KPI ID and an eligible output KPI ID with the actual target value in the output KPI's unit. Use setting null to clear it and resume the stored source value or formula. Ask for any missing choice or actual value. Report whether the proposed Baseline solved or has diagnostics and whether approval is pending.",
  inputSchema: writeInput,
  outputSchema: z.record(z.string(), z.unknown()),
  requiresDraftProject: true,
  mutatesProject: true,
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    const operation = prepareBackCalculationPatch(project, input);
    if (operation.status === "error") throw new AgentToolError(operation.code, operation.message);
    if (!operation.changed) return { ...readResult(project, input.nodeId), revision: builder.getRevision(), changed: false };

    const preview = cloneBuilder(context).updateNode({ nodeId: input.nodeId, patch: operation.patch });
    const result = readResult(preview.project, input.nodeId);
    const unit = result.target?.unit ? ` ${result.target.unit}` : "";
    const summary = input.setting
      ? `Balance “${result.node.name}” to an actual output of ${input.setting.targetValue}${unit} for “${result.target?.name ?? input.setting.targetNodeId}”.`
      : `Clear back-calculation for “${result.node.name}” and resume its source value or formula.`;
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: input.setting ? "Set back-calculation" : "Clear back-calculation",
      summary,
      changeSet: requireChangeSet(preview.changeSet),
      targetNodeId: input.nodeId
    });
    return {
      revision: mutation.revision,
      ...(mutation.applied ? { ...result, changed: true } : { preview: result, changed: false }),
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};

export function createBackCalculationTools(): AgentTool[] {
  return [read, write];
}
