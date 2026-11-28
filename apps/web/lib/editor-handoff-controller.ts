import { z } from "zod";
import type { VdtStudioState } from "@/components/vdt/vdt-store";
import type { EditorHandoff } from "./editor-handoff";

export interface EditorHandoffView {
  projectId?: string | undefined;
  vdtId?: string | undefined;
  revisionId?: string | null | undefined;
  draftGeneration: number;
}

type HandoffEffect =
  | { kind: "smart"; nodeId: string; durability: "stored" | "draft" }
  | { kind: "file"; nodeId: string; changeSetId: string }
  | { kind: "portable_download"; format: "json" | "md" }
  | { kind: "workspace_opened"; projectId: string };

type FileApplyEffect = Extract<HandoffEffect, { kind: "file" }>;
const receiptId = z.string().min(1).max(160);
const fileHandoffDraftReceiptSchema = z.object({
  version: z.literal(1),
  runId: receiptId,
  artifactId: receiptId,
  projectId: receiptId,
  vdtId: receiptId,
  revisionId: receiptId,
  graphProjectId: receiptId,
  draftGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  checkpointVersionId: receiptId,
  targetNodeId: receiptId,
  changeSetId: receiptId
}).strict();

export type FileHandoffDraftReceipt = z.infer<typeof fileHandoffDraftReceiptSchema>;

export function readFileHandoffDraftReceipt(value: unknown): FileHandoffDraftReceipt | undefined {
  const parsed = fileHandoffDraftReceiptSchema.safeParse(value);
  if (parsed.success) return parsed.data;
}

const savedSmartHandoffSchema = z.object({
  version: z.literal(1),
  runId: receiptId,
  artifactId: receiptId,
  projectId: receiptId,
  vdtId: receiptId,
  baseRevisionId: receiptId,
  targetNodeId: receiptId
}).strict();

export type SavedSmartHandoff = z.infer<typeof savedSmartHandoffSchema>;

export function readSavedSmartHandoff(value: unknown): SavedSmartHandoff | undefined {
  const parsed = savedSmartHandoffSchema.safeParse(value);
  if (parsed.success) return parsed.data;
}

type AttemptState = "pending" | "cancelled" | HandoffEffect;
type AttemptIdentity = { runId: string; id: string; handoff: EditorHandoff };
export type EditorHandoffAttempt = NonNullable<ReturnType<EditorHandoffController["start"]>>;

const effectMatches = (handoff: EditorHandoff, effect: HandoffEffect) => {
  switch (handoff.action) {
    case "suggested_kpis": return effect.kind === "smart" && effect.nodeId === handoff.nodeId;
    case "file_import": return effect.kind === "file" && effect.nodeId === handoff.nodeId && Boolean(effect.changeSetId);
    case "vdt_export": return effect.kind === "portable_download";
    case "project_workspace": return effect.kind === "workspace_opened" && effect.projectId === handoff.projectId;
  }
};

export class EditorHandoffController {
  private readonly attempts = new Map<string, { state: AttemptState }>();
  private readonly listeners = new Set<() => void>();

  private key(runId: string, id: string) { return JSON.stringify([runId, id]); }
  state(runId: string, id: string) { return this.attempts.get(this.key(runId, id))?.state; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { for (const listener of this.listeners) listener(); }

  start({ runId, id, handoff }: AttemptIdentity, origin: EditorHandoffView) {
    if (handoff.projectId !== origin.projectId || handoff.vdtId !== origin.vdtId ||
      handoff.revisionId !== undefined && handoff.revisionId !== origin.revisionId) return undefined;
    const key = this.key(runId, id);
    const entry: { state: AttemptState } = { state: "pending" };
    const set = (state: AttemptState) => { entry.state = state; this.emit(); };
    const pending = () => this.attempts.get(key) === entry && entry.state === "pending";
    const matchesOrigin = (view: EditorHandoffView) => pending() && origin.projectId === view.projectId
      && origin.vdtId === view.vdtId && origin.revisionId === view.revisionId && origin.draftGeneration === view.draftGeneration;
    const matchesSmartTarget = (view: EditorHandoffView, targetNodeId: string) =>
      matchesOrigin(view) && handoff.action === "suggested_kpis" && handoff.nodeId === targetNodeId;
    this.attempts.delete(key);
    this.attempts.set(key, entry);
    if (this.attempts.size > 64) this.attempts.delete(this.attempts.keys().next().value!);
    this.emit();
    return {
      matchesOrigin,
      matchesSmartTarget,
      savedSmartHandoff: (before: EditorHandoffView, targetNodeId: string) => {
        if (!matchesSmartTarget(before, targetNodeId)) return;
        return readSavedSmartHandoff({
          version: 1, runId, artifactId: id, projectId: origin.projectId, vdtId: origin.vdtId,
          baseRevisionId: origin.revisionId, targetNodeId
        });
      },
      fileDraftReceipt: (before: EditorHandoffView, effect: FileApplyEffect, graphProjectId: string, checkpointVersionId: string) => {
        if (!matchesOrigin(before) || !effectMatches(handoff, effect)) return;
        return readFileHandoffDraftReceipt({
          version: 1, runId, artifactId: id, projectId: origin.projectId, vdtId: origin.vdtId,
          revisionId: origin.revisionId, graphProjectId, draftGeneration: origin.draftGeneration + 1,
          checkpointVersionId, targetNodeId: effect.nodeId, changeSetId: effect.changeSetId
        });
      },
      cancel: () => { if (pending()) set("cancelled"); },
      complete: (before: EditorHandoffView, after: EditorHandoffView, effect: HandoffEffect) => {
        if (!matchesOrigin(before) || !effectMatches(handoff, effect)) return false;
        if (effect.kind === "workspace_opened" ? after.projectId !== handoff.projectId
          : after.projectId !== origin.projectId || after.vdtId !== origin.vdtId) return false;
        if (effect.kind === "file" || (effect.kind === "smart" && effect.durability === "draft")) {
          if (after.draftGeneration <= origin.draftGeneration || after.revisionId !== origin.revisionId) return false;
        }
        if (effect.kind === "smart" && effect.durability === "stored"
          && (!after.revisionId || after.revisionId === origin.revisionId || after.draftGeneration <= origin.draftGeneration)) return false;
        if (effect.kind === "portable_download" && !matchesOrigin(after)) return false;
        set(effect);
        return true;
      }
    };
  }
}

export const editorHandoffController = new EditorHandoffController();

export function editorHandoffView(state: Pick<VdtStudioState, "projectRevision" | "workspace">): EditorHandoffView {
  const { activeProjectId: projectId, activeVdtId: vdtId, draftRevisionBase, projectSummaries } = state.workspace;
  const record = projectSummaries.find(entry => entry.project.id === projectId)?.vdts.find(entry => entry.vdt.id === vdtId);
  const head = draftRevisionBase?.projectId === projectId && draftRevisionBase?.vdtId === vdtId
    ? draftRevisionBase?.expectedHead : record?.head;
  return { projectId, vdtId, revisionId: head ? head.activeRevisionId : record?.vdt.activeRevisionId, draftGeneration: state.projectRevision };
}

/** Browser-local projection of a real draft Apply. It confers no execution or saved-revision authority. */
export function matchingFileHandoffDraftReceipt(
  state: Pick<VdtStudioState, "fileHandoffDraftReceipt" | "project" | "projectRevision" | "workspace">,
  { runId, id, handoff }: AttemptIdentity
): FileHandoffDraftReceipt | undefined {
  const receipt = state.fileHandoffDraftReceipt;
  if (!receipt || state.workspace.draftRevisionBase === null || handoff.action !== "file_import" || receipt.runId !== runId || receipt.artifactId !== id
    || receipt.projectId !== handoff.projectId || receipt.vdtId !== handoff.vdtId
    || (handoff.revisionId !== undefined && receipt.revisionId !== handoff.revisionId)
    || (handoff.nodeId !== undefined && receipt.targetNodeId !== handoff.nodeId)) return;
  const view = editorHandoffView(state);
  const savedVdt = state.workspace.projectSummaries.find(summary => summary.project.id === receipt.projectId)
    ?.vdts.find(entry => entry.vdt.id === receipt.vdtId);
  const savedRevisionId = savedVdt?.head ? savedVdt.head.activeRevisionId : savedVdt?.vdt.activeRevisionId;
  if (savedRevisionId !== receipt.revisionId) return;
  if (view.projectId === receipt.projectId && view.vdtId === receipt.vdtId && view.revisionId === receipt.revisionId
    && view.draftGeneration === receipt.draftGeneration && state.project.id === receipt.graphProjectId
    && state.project.versions.some(version => version.id === receipt.checkpointVersionId)
    && state.project.graph.nodes.some(node => node.id === receipt.targetNodeId)) return receipt;
}
