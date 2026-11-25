import { z } from "zod";

const safeId = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const scope = z.object({ projectId: safeId, vdtId: safeId }).strict();
const nodeId = z.string().min(1).max(160);

export const editorHandoffSchema = z.discriminatedUnion("action", [
  scope.extend({ action: z.literal("suggested_kpis"), nodeId }),
  scope.extend({ action: z.literal("file_import"), nodeId: nodeId.optional() }),
  scope.extend({ action: z.literal("vdt_export") }),
  scope.extend({ action: z.literal("project_workspace") })
]);

export type EditorHandoff = z.infer<typeof editorHandoffSchema>;
