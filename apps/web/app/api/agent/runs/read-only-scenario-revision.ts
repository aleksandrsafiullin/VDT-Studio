import { validateStrictVdtProjectCommit, type VdtDatabase } from "@vdt-studio/storage";
import type { VdtAgentRunSnapshot } from "@vdt-studio/vdt-agent-runtime";
import type { VdtProject } from "@vdt-studio/vdt-core";

type ScenarioRun = Pick<VdtAgentRunSnapshot, "runId" | "request">;
type ScenarioRevisionStorage = Pick<VdtDatabase, "getAgentRun" | "getVdt" | "getProjectRuntimeState"
  | "getVdtRevisionHead" | "getVdtRevision" | "readVdtRevision">;

/** Resolve a receipt anchor on an existing storage connection. This makes no
 * workspace revision available for editor adoption or mutation. */
export function readOnlyScenarioRevision(
  database: ScenarioRevisionStorage, run: ScenarioRun, project: VdtProject
): string | undefined {
  const scope = run.request.workspace;
  const expected = scope?.expectedRevision;
  const revisionId = expected?.expectedActiveRevisionId;
  const identity = expected?.expectedActiveContentIdentity;
  if (run.request.outcome !== "answer" || !scope?.vdtId || !expected || !revisionId
    || identity?.scheme !== "vdt_revision_payload_hash.v1") return;
  const { projectId, vdtId } = scope;
  const persisted = database.getAgentRun(run.runId);
  if (persisted?.projectId !== projectId || persisted.vdtId !== vdtId
    || database.getVdt(vdtId)?.projectId !== projectId) return;

  const matchesHead = () => {
    const runtime = database.getProjectRuntimeState(projectId);
    const head = database.getVdtRevisionHead(vdtId);
    return runtime?.runtimeGeneration === expected.expectedRuntimeGeneration
      && runtime.generationVersion === expected.expectedGenerationVersion
      && head?.projectId === projectId && head.vdtId === vdtId
      && head.activeRevisionId === revisionId && head.pendingRevisionId === null
      && head.commitGeneration === expected.expectedCommitGeneration
      && head.activeContentIdentity?.scheme === identity.scheme && head.activeContentIdentity.hash === identity.hash;
  };
  if (!matchesHead()) return;
  const revision = database.getVdtRevision(revisionId);
  if (revision?.vdtId !== vdtId) return;
  try {
    const working = validateStrictVdtProjectCommit(project).contentIdentity;
    if (working.hash !== identity.hash) return;
    const saved = validateStrictVdtProjectCommit(database.readVdtRevision(revision)).contentIdentity;
    if (saved.hash === identity.hash && matchesHead()) return revisionId;
  } catch {
    // A working snapshot remains usable without claiming persisted identity.
  }
}
