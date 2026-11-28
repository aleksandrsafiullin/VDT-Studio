import { AgentToolError, type AgentToolContext, type ToolRegistry, type VdtAgentRunSnapshot, type AgentToolOperationReceiptV2 } from "@vdt-studio/vdt-agent-runtime";
import { z } from "zod";
import { editorHandoffInstructions, editorHandoffSchema, type EditorHandoff } from "@/lib/editor-handoff";
import { smartKpiTargetIds } from "@/lib/smart-kpi-targets";
import { openVdtStorageDatabase } from "../../vdt/storage-database";
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

export function registerEditorHandoffTools(registry: ToolRegistry, openDatabase = () => openVdtStorageDatabase(process.cwd())) {
  for (const entry of definitions) {
    if (registry.has(entry.name)) continue;
    registry.register<{ nodeId?: string | undefined }, { action: EditorHandoff["action"]; status: "user_action_available"; controlId: string; nextAction: string }>({
      name: entry.name,
      description: entry.description,
      inputSchema: entry.schema,
      inputJsonSchema: toProviderJsonSchema(entry.schema),
      outputSchema: z.object({ action: z.enum(["suggested_kpis", "file_import", "vdt_export", "project_workspace"]), status: z.literal("user_action_available"), controlId: z.string(), nextAction: z.string() }),
      requiresDraftProject: true,
      run(context, args) {
        const input = "nodeId" in args ? args.nodeId : undefined;
        return presentEditorHandoff(context, entry.action, input, openDatabase);
      }
    });
  }
}

function presentEditorHandoff(context: AgentToolContext, action: EditorHandoff["action"], nodeId: string | undefined, openDatabase: () => ReturnType<typeof openVdtStorageDatabase>) {
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
  const db = openDatabase();
  let revisionId: string | null = null;
  try {
    const vdt = db.getVdt(scope.vdtId);
    if (vdt?.projectId === scope.projectId) revisionId = db.getVdtRevisionHead(scope.vdtId)?.activeRevisionId ?? null;
  } finally {
    db.close();
  }
  const observedHead = run.workspaceRevision?.head.activeRevisionId ?? scope.expectedRevision?.expectedActiveRevisionId;
  if (observedHead !== undefined && observedHead !== revisionId) {
    throw new AgentToolError("EDITOR_HANDOFF_STALE", "Reopen the saved VDT before using this control.");
  }
  if (!revisionId) {
    throw new AgentToolError("EDITOR_HANDOFF_UNAVAILABLE", "Save this VDT before opening a chat handoff.");
  }
  const targetNodeId = nodeId ?? (action === "file_import" ? run.request.input.selectedNodeId ?? project.rootNodeId : undefined);
  const target = targetNodeId ? project.graph.nodes.find(candidate => candidate.id === targetNodeId) : undefined;
  if (targetNodeId && !target) throw new AgentToolError("NODE_NOT_FOUND", "Choose a KPI in the current VDT.");
  if (action === "file_import" && (!target || target.formula?.trim()
    || project.graph.edges.some(edge => edge.sourceNodeId === target.id))) {
    throw new AgentToolError("FILE_IMPORT_NOT_AVAILABLE", "Choose a KPI without a formula or incoming KPIs before reviewing file data.");
  }
  const payload = editorHandoffSchema.parse({
    action, projectId: scope.projectId, vdtId: scope.vdtId, revisionId, ...(targetNodeId ? { nodeId: targetNodeId } : {})
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
  return { action, status: "user_action_available" as const, controlId: id, nextAction: editorHandoffInstructions[action] };
}


const russianNextActions: Record<EditorHandoff["action"], string> = {
  suggested_kpis: "Откройте рекомендации для этого показателя, выберите набор и нажмите «Применить».",
  file_import: "Выберите источник, проверьте сопоставление данных и примените подготовленные изменения в редакторе.",
  vdt_export: "Откройте форматы экспорта и выберите JSON или Markdown, чтобы начать скачивание.",
  project_workspace: "Откройте рабочую область проекта и выберите нужное действие."
};

// These tools can select or describe a target for a handoff. Operations whose
// results may themselves fulfil a request (comparison, probes, exports and
// writes) stay on the normal final-answer path.
const handoffPreparationTools = new Set([
  "tools.describe", "project.get_current", "project.read_current", "project.get_selected_node",
  "project.get_node", "project.get_subtree", "scenario.list", "version.list", "data.list_sources"
]);

export function pendingEditorHandoffFinalText(
  run: Pick<VdtAgentRunSnapshot, "runId" | "request" | "chatMessages" | "artifacts">,
  receipts: readonly AgentToolOperationReceiptV2[], locale: "en" | "ru" | undefined, verifiedAt: string
): string | undefined {
  if (run.request.outcome !== "answer" || run.request.artifactIntent) return undefined;
  const instruction = run.chatMessages?.filter(message => message.runId === run.runId && message.role === "user" && message.kind === "instruction" && message.createdAt <= verifiedAt).at(-1);
  if (!instruction) return undefined;
  const current = receipts.filter(receipt => receipt.state === "completed" && receipt.startedAt >= instruction.createdAt && receipt.updatedAt <= verifiedAt);
  if (current.some(receipt => {
    if (EDITOR_HANDOFF_TOOL_NAMES.some(tool => tool === receipt.toolName)
      || receipt.toolName === "run.propose_outcome" || receipt.toolName === "run.request_finish") return false;
    const payload = receipt.replayResult?.payload;
    return !handoffPreparationTools.has(receipt.toolName)
      || !payload || typeof payload !== "object" || !("projectChanged" in payload) || payload.projectChanged !== false;
  })) return undefined;
  const actions = new Set<EditorHandoff["action"]>();
  for (const entry of run.artifacts ?? []) {
    if (entry.runId !== run.runId || entry.type !== "editor_handoff" || entry.createdAt < instruction.createdAt
      || !current.some(receipt => {
        const payload = receipt.replayResult?.payload;
        const output = payload && typeof payload === "object" && "output" in payload ? payload.output : undefined;
        return receipt.replayResult?.status === "succeeded" && EDITOR_HANDOFF_TOOL_NAMES.some(tool => tool === receipt.toolName)
          && output && typeof output === "object" && "controlId" in output && output.controlId === entry.id;
      })) continue;
    const parsed = editorHandoffSchema.safeParse(entry.payload);
    if (parsed.success) actions.add(parsed.data.action);
  }
  if (!actions.size) return undefined;
  const russian = locale === "ru" || (locale === undefined && /[А-Яа-яЁё]/u.test(instruction.text ?? ""));
  const steps = [...actions].map(action => (russian ? russianNextActions : editorHandoffInstructions)[action]);
  return [russian ? "Действие ждёт вашего подтверждения в редакторе." : "The editor control is ready for your next action.", ...steps].join("\n");
}
