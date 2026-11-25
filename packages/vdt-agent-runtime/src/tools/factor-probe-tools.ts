import { probeFactor } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { AgentToolError, type AgentTool } from "../tool-registry";
import { requireBuilder } from "./builder-mutation-utils";

const inputSchema = z.object({
  nodeId: z.string().min(1).max(160),
  value: z.number().finite()
}).strict();

const probe: AgentTool<z.infer<typeof inputSchema>> = {
  name: "vdt.probe_factor",
  description: "Run a read-only one-factor what-if against the current model baseline, independently of saved scenario overrides. Resolve the KPI to its stable ID and provide the absolute new value in its modeled unit. Explain the returned baseline, simulated root and delta with units, using the calculation and relevant assumption evidence. Label the result modeled sensitivity. Operational achievability requires separate evidence. If the baseline, simulated result or relationship is unresolved, explain what is missing or ask a focused question.",
  inputSchema,
  outputSchema: z.record(z.string(), z.unknown()),
  requiresDraftProject: true,
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const result = probeFactor(builder.getProject(), input);
    if (result.status === "error") throw new AgentToolError(result.code, result.message);
    return { ...result.result, revision: builder.getRevision() };
  }
};

export function createFactorProbeTools(): AgentTool[] {
  return [probe];
}
