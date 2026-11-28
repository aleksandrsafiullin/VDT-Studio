import { z } from "zod";

const safeId = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const scope = z.object({ projectId: safeId, vdtId: safeId, revisionId: safeId.nullable().optional() }).strict();
const nodeId = z.string().min(1).max(160);

export const editorHandoffSchema = z.discriminatedUnion("action", [
  scope.extend({ action: z.literal("suggested_kpis"), nodeId }),
  scope.extend({ action: z.literal("file_import"), nodeId: nodeId.optional() }),
  scope.extend({ action: z.literal("vdt_export") }),
  scope.extend({ action: z.literal("project_workspace") })
]);

export type EditorHandoff = z.infer<typeof editorHandoffSchema>;

export const editorHandoffInstructions: Record<EditorHandoff["action"], string> = {
  suggested_kpis: "Review the suggestions for this KPI, then select a layer and choose Apply.",
  file_import: "Choose a source, review its mapping, then apply the staged preview in the editor.",
  vdt_export: "Choose JSON or Markdown to start the download.",
  project_workspace: "Open the project workspace, then choose the workspace action you want."
};
