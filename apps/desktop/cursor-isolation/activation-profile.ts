import type { CursorCheckpointQualificationEvidence } from "../../../packages/model-bridge/src/agent-engines/cursor-resume-checkpoint-engine";

export type CursorActivationEvidence =
  | { readonly evidence: CursorCheckpointQualificationEvidence; readonly evidences?: never }
  | { readonly evidence?: never; readonly evidences: readonly CursorCheckpointQualificationEvidence[] };

/** Each exact model keeps its own policy, runner and private session scope. */
export async function createCursorModelActivations<T>(
  profile: CursorActivationEvidence,
  create: (evidence: CursorCheckpointQualificationEvidence) => Promise<T>
): Promise<T | { readonly activations: readonly T[] }> {
  if (!profile.evidences) return create(profile.evidence);
  const modelIds = profile.evidences.map(evidence => evidence.modelId);
  if (modelIds.length === 0 || new Set(modelIds).size !== modelIds.length) {
    throw new Error("The packaged Cursor profile must supply unique model evidence.");
  }
  const activations = await Promise.all(profile.evidences.map(create));
  return Object.freeze({ activations: Object.freeze(activations) });
}
