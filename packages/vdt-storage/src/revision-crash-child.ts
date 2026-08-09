import path from "node:path";
import { productionVolumeProject, type VdtProject } from "@vdt-studio/vdt-core";
import { openVdtDatabase } from "./index";
import type {
  RevisionCommitFaultPoint,
  RevisionCommitInputV2
} from "./types";

const [dataDir, faultPointText] = process.argv.slice(2);
if (!dataDir || !faultPointText) {
  throw new Error("Revision crash child requires dataDir and faultPoint.");
}
const revisionFaultPoints = new Set<RevisionCommitFaultPoint>([
  "after_attempt_reserved",
  "after_stage_fsynced",
  "after_head_reserved",
  "after_final_published",
  "before_finalize"
]);
if (!revisionFaultPoints.has(faultPointText as RevisionCommitFaultPoint)) {
  throw new Error(`Unknown revision fault point: ${faultPointText}.`);
}
const faultPoint = faultPointText as RevisionCommitFaultPoint;
const db = openVdtDatabase(path.dirname(dataDir), {
  dataDir,
  revisionLeaseMs: 0,
  faultInjector(point, attempt) {
    if (
      point === faultPoint &&
      attempt.idempotencyKey === `abrupt_${faultPoint}`
    ) {
      process.kill(process.pid, "SIGKILL");
    }
  }
});
const head = db.getVdtRevisionHead("vdt_atomic");
if (!head?.activeRevisionId || !head.activeContentIdentity) {
  throw new Error("Revision crash child requires one committed parent revision.");
}
const input: RevisionCommitInputV2 = {
  projectId: "project_atomic",
  vdtId: "vdt_atomic",
  actor: {
    schemaVersion: "actor_context.v1",
    principalId: "desktop_local_principal",
    projectId: "project_atomic",
    roles: [],
    authSource: "desktop_local",
    sessionId: "abrupt_revision_child",
    issuedAt: "2026-07-23T00:00:00.000Z"
  },
  command: {
    schemaVersion: "revision_commit.v2",
    expectedActiveRevisionId: head.activeRevisionId,
    expectedActiveContentIdentity: head.activeContentIdentity,
    expectedCommitGeneration: head.commitGeneration,
    expectedRuntimeGeneration: "v1",
    expectedGenerationVersion: 1,
    idempotencyKey: `abrupt_${faultPoint}`,
    intent: {
      source: "user",
      summary: `Abrupt recovery at ${faultPoint}`,
      validation: null,
      calculation: null
    }
  },
  project: JSON.parse(JSON.stringify(productionVolumeProject)) as VdtProject
};
db.commitVdtRevision(input);
db.close();
throw new Error(`Revision fault point did not terminate the child: ${faultPoint}.`);
