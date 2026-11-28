import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentToolOperationReceiptV2, VdtAgentRunSnapshot } from "@vdt-studio/vdt-agent-runtime";
import type { VdtRevisionHeadV2 } from "@vdt-studio/storage";
import { EditorHandoffController } from "@/lib/editor-handoff-controller";
import { editorHandoffSchema } from "@/lib/editor-handoff";
import { describe, expect, it } from "vitest";

type OfferEvidence = {
  pid: number;
  artifacts: NonNullable<VdtAgentRunSnapshot["artifacts"]>;
  receipts: AgentToolOperationReceiptV2[];
};
type IssueEvidence = OfferEvidence & { runId: string; head: VdtRevisionHeadV2 };
type SmartEvidence = OfferEvidence & {
  operationId: string;
  prior: Omit<OfferEvidence, "pid">;
  posts: string[];
  committed: { head: VdtRevisionHeadV2; revision: { id: string; vdtId: string } }[];
  recovered?: boolean;
  staleSave?: { status: number; body: unknown };
  revisions: { head: VdtRevisionHeadV2; revisions: { id: string }[] };
  editorNodeIds: string[];
};

function acrossProcess<T>(directory: string, phase: "issue" | "commit" | "recover", runId?: string): T {
  const child = spawnSync(process.execPath, [
    "--import", "tsx",
    path.resolve("apps/web/app/api/agent/runs/fixtures/editor-handoff-restart-child.ts"),
    phase, ...(runId ? [runId] : [])
  ], {
    encoding: "utf8", timeout: 15_000,
    env: { ...process.env, VDT_DATA_DIR: directory, VDT_APP_MODE: "desktop",
      TSX_TSCONFIG_PATH: path.resolve("apps/web/tsconfig.json") }
  });
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.status, child.stdout + child.stderr).toBe(0);
  return JSON.parse(child.stdout) as T;
}

describe("scoped editor handoff offers and existing revision receipts across process restart", () => {
  it("retains pending offers, reconciles the exact Smart save once and fences later callbacks", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "vdt-editor-handoff-restart-"));
    try {
      const issued = acrossProcess<IssueEvidence>(directory, "issue");
      expect(issued.artifacts).toHaveLength(4);
      expect(issued.receipts).toHaveLength(4);
      const offers = issued.artifacts.map((artifact) => {
        expect(artifact).toMatchObject({ runId: issued.runId, type: "editor_handoff" });
        const handoff = editorHandoffSchema.parse(artifact.payload);
        expect(handoff.revisionId).toBe(issued.head.activeRevisionId);
        expect(issued.receipts.find((receipt) => receipt.replayResult?.payload &&
          (receipt.replayResult.payload as { output?: { controlId?: string } }).output?.controlId === artifact.id))
          .toMatchObject({ state: "completed", replayResult: { status: "succeeded",
            payload: { projectChanged: false, output: { status: "user_action_available", controlId: artifact.id } } } });
        return { runId: issued.runId, id: artifact.id, handoff };
      });
      const smart = offers.find(({ handoff }) => handoff.action === "suggested_kpis")!;
      const { projectId, vdtId, revisionId } = smart.handoff;
      const origin = { projectId, vdtId, revisionId, draftGeneration: 1 };
      const current = new EditorHandoffController();
      for (const offer of offers) {
        expect(current.state(offer.runId, offer.id)).toBeUndefined();
        expect(current.start(offer, origin)).toBeDefined();
        expect(current.state(offer.runId, offer.id)).toBe("pending");
      }
      expect(current.start(smart, { ...origin, projectId: "other-project" })).toBeUndefined();
      expect(current.start(smart, { ...origin, vdtId: "other-vdt" })).toBeUndefined();
      const cancelled = current.start(smart, origin)!;
      cancelled.cancel();
      const retry = current.start(smart, origin)!;
      expect(current.state(smart.runId, smart.id)).toBe("pending");

      const committed = acrossProcess<SmartEvidence>(directory, "commit", issued.runId);
      const recovered = acrossProcess<SmartEvidence>(directory, "recover", issued.runId);
      expect(new Set([issued.pid, committed.pid, recovered.pid]).size).toBe(3);
      expect(committed.prior).toEqual({ artifacts: issued.artifacts, receipts: issued.receipts });
      expect(committed.artifacts).toEqual(issued.artifacts);
      expect(recovered.artifacts).toEqual(issued.artifacts);
      expect(recovered.receipts).toEqual(issued.receipts);
      expect(committed.posts).toHaveLength(1);
      expect(recovered.posts).toEqual(committed.posts);
      expect(recovered.operationId).toBe(committed.operationId);
      expect(JSON.parse(committed.posts[0]!)).toMatchObject({
        idempotencyKey: `smart-add:${vdtId}:${recovered.operationId}`,
        expectedHead: { activeRevisionId: revisionId }
      });
      expect(recovered.recovered).toBe(true);
      expect(recovered.committed).toEqual(committed.committed);
      expect(recovered.committed[0]?.revision).toEqual(expect.objectContaining({ vdtId,
        id: recovered.revisions.head.activeRevisionId }));
      expect(recovered.staleSave).toMatchObject({ status: 409, body: { error: { code: "REVISION_CONFLICT" } } });
      expect(recovered.revisions.revisions).toHaveLength(2);
      expect(recovered.revisions.head).toEqual(committed.revisions.head);
      expect(recovered.editorNodeIds.filter((id) => id.startsWith(recovered.operationId))).toHaveLength(2);

      const saved = { ...origin, draftGeneration: 2, revisionId: recovered.revisions.head.activeRevisionId };
      expect(saved.revisionId).not.toBe(revisionId);
      const storedEffect = { kind: "smart", durability: "stored", nodeId: "unplanned_downtime" } as const;
      expect(cancelled.complete(origin, saved, storedEffect)).toBe(false);
      expect(retry.complete(origin, saved, { ...storedEffect, nodeId: "other-kpi" })).toBe(false);
      expect(retry.complete({ ...origin, draftGeneration: 2 }, saved, storedEffect)).toBe(false);
      expect(retry.complete(origin, saved, storedEffect)).toBe(true);
      expect(current.state(smart.runId, smart.id)).toEqual(storedEffect);

      const restarted = new EditorHandoffController();
      for (const offer of offers) {
        expect(restarted.state(offer.runId, offer.id)).toBeUndefined();
        expect(restarted.start(offer, saved)).toBeUndefined();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("accepts only scoped file drafts, project arrival and portable download initiation", () => {
    const scope = { projectId: "project", vdtId: "vdt", revisionId: "revision" };
    const origin = { ...scope, draftGeneration: 4 };
    const controller = new EditorHandoffController();
    const start = (handoff: ReturnType<typeof editorHandoffSchema.parse>, id: string) =>
      controller.start({ runId: "run", id, handoff }, origin)!;

    const file = start({ ...scope, action: "file_import", nodeId: "input" }, "file");
    const mapped = { kind: "file", nodeId: "input", changeSetId: "reviewed-change-set" } as const;
    expect(file.complete(origin, origin, mapped)).toBe(false);
    expect(file.complete(origin, { ...origin, draftGeneration: 5 }, { ...mapped, nodeId: "other" })).toBe(false);
    expect(file.complete(origin, { ...origin, draftGeneration: 5, revisionId: "other" }, mapped)).toBe(false);
    expect(file.complete(origin, { ...origin, draftGeneration: 5 }, mapped)).toBe(true);

    const workspace = start({ ...scope, action: "project_workspace" }, "workspace");
    expect(workspace.complete(origin, { projectId: "other", draftGeneration: 4 },
      { kind: "workspace_opened", projectId: "other" })).toBe(false);
    expect(workspace.complete(origin, { projectId: scope.projectId, draftGeneration: 4 },
      { kind: "workspace_opened", projectId: scope.projectId })).toBe(true);

    for (const format of ["json", "md"] as const) {
      const download = start({ ...scope, action: "vdt_export" }, format);
      const effect = { kind: "portable_download", format } as const;
      expect(controller.state("run", format)).toBe("pending");
      expect(download.complete(origin, { ...origin, draftGeneration: 5 }, effect)).toBe(false);
      expect(download.complete(origin, origin, effect)).toBe(true);
      expect(controller.state("run", format)).toEqual(effect);
    }
  });
});
