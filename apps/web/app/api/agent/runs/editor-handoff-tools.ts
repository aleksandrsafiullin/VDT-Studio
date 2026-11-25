import { AgentToolError, type AgentToolContext, type ToolRegistry } from "@vdt-studio/vdt-agent-runtime";
import { z } from "zod";
import { editorHandoffSchema, type EditorHandoff } from "@/lib/editor-handoff";
import { smartKpiTargetIds } from "@/lib/smart-kpi-targets";
import { toProviderJsonSchema } from "./provider-json-schema";

const nodeId = z.string().min(1).max(160);
const definitions = [
  { name: "vdt.open_suggested_kpis", action: "suggested_kpis", schema: z.object({ nodeId }).strict(),
    description: "Open Suggested KPI review for an input. The user selects and applies the layer." },
  { name: "data.open_file_import", action: "file_import", schema: z.object({ nodeId: nodeId.optional() }).strict(),
    description: "Open the file chooser and mapping review for a KPI. The user applies the mapping." },
  { name: "vdt.open_export_formats", action: "vdt_export", schema: z.object({}).strict(),
    description: "Open local JSON and Markdown export controls. The user chooses a format to download the current editor model." },
  { name: "project.open_workspace", action: "project_workspace", schema: z.object({}).strict(),
    description: "Open the scoped workspace to manage models, duplicate a VDT, choose an example, or import JSON." }
] as const;

export const EDITOR_HANDOFF_TOOL_NAMES = definitions.map(({ name }) => name);

export function registerEditorHandoffTools(registry: ToolRegistry) {
  for (const entry of definitions) {
    if (registry.has(entry.name)) continue;
    registry.register<{ nodeId?: string | undefined }, { action: EditorHandoff["action"]; status: "user_action_available" }>({
      name: entry.name,
      description: entry.description,
      inputSchema: entry.schema,
      inputJsonSchema: toProviderJsonSchema(entry.schema),
      outputSchema: z.object({ action: z.enum(["suggested_kpis", "file_import", "vdt_export", "project_workspace"]), status: z.literal("user_action_available") }),
      requiresDraftProject: true,
      run(context, args) {
        const input = "nodeId" in args ? args.nodeId : undefined;
        return presentEditorHandoff(context, entry.action, input);
      }
    });
  }
}

function presentEditorHandoff(context: AgentToolContext, action: EditorHandoff["action"], nodeId: string | undefined) {
  const run = context.getRun();
  const scope = run.request.workspace;
  if (!scope?.vdtId || !context.builder || !context.invocation) {
    throw new AgentToolError("EDITOR_HANDOFF_UNAVAILABLE", "Open a saved VDT in the editor to use this control.");
  }
  const project = context.builder.getProject();
  const node = nodeId ? project.graph.nodes.find(candidate => candidate.id === nodeId) : undefined;
  if (nodeId && !node) throw new AgentToolError("NODE_NOT_FOUND", "Choose a KPI in the current VDT.");
  if (action === "suggested_kpis" && (!node || !smartKpiTargetIds(project).has(node.id))) {
    throw new AgentToolError("SUGGESTED_KPI_NOT_AVAILABLE", "Choose an undecomposed input to review Suggested KPIs.");
  }
  const payload = editorHandoffSchema.parse({
    action, projectId: scope.projectId, vdtId: scope.vdtId, ...(nodeId ? { nodeId } : {})
  });
  const { operationId: id, reservedAt: createdAt } = context.invocation;
  const artifacts = run.artifacts ?? [];
  if (!artifacts.some(artifact => artifact.id === id)) {
    context.updateRun({ artifacts: [
      ...artifacts.filter(artifact => artifact.type !== "editor_handoff"),
      ...artifacts.filter(artifact => artifact.type === "editor_handoff").slice(-7),
      { id, runId: context.runId, type: "editor_handoff", summary: "Editor control", payload, createdAt }
    ] });
  }
  return { action, status: "user_action_available" as const };
}
