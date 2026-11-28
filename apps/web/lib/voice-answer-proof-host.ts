import { createHash, randomUUID } from "node:crypto";
import type { AgentAnswerCapture, AgentQuestionExpectation, VdtAgentRunState } from "@vdt-studio/vdt-agent-runtime";
import { openAgentRunPersistenceDatabase } from "../app/api/agent/runs/persistence";
import { questionMatches, requiresNumericReadback, spokenReviewIntent } from "./voice-confirmation";

interface PackagedCaptureFence {
  revision: string;
  bridge: AbortSignal;
  isActive: () => Promise<boolean>;
}

interface Capture {
  target: AgentAnswerCapture;
  expiresAt: number;
  jobId?: string;
  receipt?: { token: string; textHash: string; expiresAt: number };
  packaged?: PackagedCaptureFence;
}

type Builder = NonNullable<VdtAgentRunState["builder"]>;
const host = globalThis as typeof globalThis & {
  __vdtVoiceAnswerCaptures?: Map<string, Capture>;
  __vdtVoiceAnswerBuilders?: WeakMap<Builder, string>;
};
const captures = host.__vdtVoiceAnswerCaptures ??= new Map();
const builders = host.__vdtVoiceAnswerBuilders ??= new WeakMap();
const textHash = (text: string) => createHash("sha256").update(text.trim(), "utf8").digest("hex");

/** Compare the live durable head as well as the run's in-memory draft. */
export function packagedVoiceAnswerRevision(state: VdtAgentRunState): string | undefined {
  const workspace = state.request.workspace;
  const builder = state.builder;
  if (!workspace?.vdtId || !builder) return;
  try {
    const database = openAgentRunPersistenceDatabase(process.cwd());
    try {
      const head = database.getVdtRevisionHead(workspace.vdtId);
      if (head?.projectId !== workspace.projectId || !head.activeRevisionId || head.pendingRevisionId) return;
      const runHead = state.workspaceRevision?.head;
      const expected = workspace.expectedRevision;
      if (head.activeRevisionId !== (runHead?.activeRevisionId ?? expected?.expectedActiveRevisionId)
        || head.commitGeneration !== (runHead?.commitGeneration ?? expected?.expectedCommitGeneration)) return;
      let owner = builders.get(builder);
      if (owner === undefined) { owner = randomUUID(); builders.set(builder, owner); }
      return JSON.stringify([head.activeRevisionId, head.commitGeneration, owner, builder.getRevision()]);
    } finally { database.close(); }
  } catch { return; }
}

export function reserveVoiceAnswerCapture(sessionId: string, target: AgentAnswerCapture, packaged?: PackagedCaptureFence): boolean {
  const now = Date.now();
  for (const [id, capture] of captures) if (capture.expiresAt <= now || capture.packaged?.bridge.aborted) captures.delete(id);
  if (captures.size >= 64 || captures.has(sessionId) || packaged?.bridge.aborted) return false;
  captures.set(sessionId, { target, expiresAt: now + 90_000, ...(packaged ? { packaged } : {}) });
  return true;
}

export function bindVoiceAnswerJob(sessionId: string, jobId: string): boolean {
  const capture = captures.get(sessionId);
  if (!capture) return true; // Existing manual dictation has no answer authority.
  if (capture.expiresAt <= Date.now() || capture.packaged?.bridge.aborted || capture.jobId !== undefined) return false;
  capture.jobId = jobId;
  return true;
}

export function revokeVoiceAnswerCapture(sessionId: string): void {
  captures.delete(sessionId);
}

/** Called only with a completed result from the trusted local speech runtime. */
export function issueVoiceAnswerProof(sessionId: string, jobId: string, text: string,
  packagedCurrent?: (target: AgentAnswerCapture, revision: string) => boolean): string | undefined {
  const capture = captures.get(sessionId);
  const now = Date.now();
  if (!capture || capture.jobId !== jobId || capture.expiresAt <= now || !text.trim() || text.trim().length > 2_000) return;
  if (capture.packaged) {
    if (capture.packaged.bridge.aborted || !packagedCurrent?.(capture.target, capture.packaged.revision)) {
      revokeVoiceAnswerCapture(sessionId);
      return;
    }
    if (requiresNumericReadback(text) || spokenReviewIntent(text)) return;
  }
  capture.receipt ??= { token: randomUUID(), textHash: textHash(text), expiresAt: now + 30_000 };
  return capture.receipt.expiresAt > now && capture.receipt.textHash === textHash(text) ? capture.receipt.token : undefined;
}

function matchingCapture(expected: AgentQuestionExpectation, transcript: string): Capture | undefined {
  const capture = captures.get(expected.captureSessionId);
  const receipt = capture?.receipt;
  const now = Date.now();
  if (!capture || !receipt || capture.expiresAt <= now || receipt.expiresAt <= now || capture.packaged?.bridge.aborted || receipt.token !== expected.recognitionProof
    || capture.target.turnId !== expected.turnId || !questionMatches(expected, capture.target)
    || receipt.textHash !== textHash(transcript)) return;
  return capture;
}

/** Native liveness is queried only for a matching proof, before the Supervisor
 * re-reads its current checkpoint and claims it synchronously. */
export async function verifyPackagedVoiceAnswerSession(expected: AgentQuestionExpectation, transcript: string): Promise<boolean> {
  const capture = matchingCapture(expected, transcript);
  if (!capture?.packaged) return false;
  try {
    if (await capture.packaged.isActive()) return matchingCapture(expected, transcript) === capture;
  } catch { /* Socket or native session failure revokes the proof below. */ }
  if (captures.get(expected.captureSessionId) === capture) revokeVoiceAnswerCapture(expected.captureSessionId);
  return false;
}

export function consumeVoiceAnswerProof(expected: AgentQuestionExpectation, transcript: string, packagedRevision?: string): boolean {
  const capture = matchingCapture(expected, transcript);
  if (!capture) return false;
  if (capture.packaged?.revision !== packagedRevision) {
    if (capture.packaged && packagedRevision !== undefined) revokeVoiceAnswerCapture(expected.captureSessionId);
    return false;
  }
  captures.delete(expected.captureSessionId);
  return true;
}
