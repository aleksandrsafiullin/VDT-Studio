import type { PublicAgentExecutionBindingSummary } from "./agent-client";
import { appleIsExpected, type AppleFirstLaunchStatus } from "./apple-first-launch";
import type { ExecutionSettings } from "./execution-mode-catalog";
import { resolveExecutionSettings } from "./execution-mode-resolver";
import { skillAuthorTimeoutMs } from "./skill-author-deadline";
import { getVdtSkillContext, skillsChanged, type VdtSkillContext } from "./skills-client";
import { taskExecutionAssertion } from "./task-execution-expectation";

interface Preview {
  binding: PublicAgentExecutionBindingSummary;
  settings: ExecutionSettings;
}

export function captureSkillAuthorRequest(
  settings: ExecutionSettings, key: string, apple?: PublicAgentExecutionBindingSummary, launch?: AppleFirstLaunchStatus
) {
  const admission = apple?.admission;
  if (apple && (apple.backendId !== "apple_foundation_models" || admission?.mode !== "local"
    || admission.providerId !== apple.backendId || admission.modelId !== apple.modelId || !apple.appleIdentity?.locale)) {
    throw new Error("The selected Apple on-device model changed. Reconnect it before preparing the Skill.");
  }
  if (!apple && appleIsExpected(settings.analyticalSourceChoice, launch)) {
    throw new Error("The selected Apple on-device model is unavailable. Reconnect it before preparing the Skill.");
  }
  const execution = apple ? { providerId: apple.backendId, providerConfig: { bindingId: apple.bindingId } } : resolveExecutionSettings(settings);
  const expectedExecution = admission ? {
    mode: admission.mode, profileVersion: admission.profileVersion, providerId: admission.providerId,
    modelId: admission.modelId, modelRevision: admission.modelRevision
  } : undefined;
  const preparation = { key, providerId: execution.providerId, startedAt: Date.now(), timeoutMs: skillAuthorTimeoutMs(execution.providerId) };
  return {
    execution, preparation, expectedExecution,
    requestProvider: {
      providerId: execution.providerId, providerConfig: execution.providerConfig ?? {},
      ...(expectedExecution ? { expectedExecution } : taskExecutionAssertion(execution.providerId, execution.providerConfig))
    }
  };
}

export function captureCurrentSkillAuthorRequest(
  state: { executionSettings: ExecutionSettings; appleNativePreview?: Preview | undefined; appleFirstLaunch?: AppleFirstLaunchStatus | undefined },
  key: string
) {
  const { executionSettings, appleNativePreview, appleFirstLaunch } = state;
  const binding = appleNativePreview?.settings === executionSettings ? appleNativePreview.binding : undefined;
  return captureSkillAuthorRequest(executionSettings, key, binding, appleFirstLaunch);
}

export function skillContextIdentity(context: VdtSkillContext | undefined): string {
  return JSON.stringify([context?.skill?.id ?? null, context?.skill?.version ?? null,
    context?.skill?.contentHash ?? null, context?.selection?.revision ?? null, Boolean(context?.needsReselection)]);
}

export async function revalidateSkillWorkflowContext(input: {
  projectId: string; vdtId: string; rootKpi: string;
  context: VdtSkillContext | undefined; stillCurrent: () => boolean;
}): Promise<VdtSkillContext> {
  const fresh = await getVdtSkillContext(input.projectId, input.vdtId, input.rootKpi);
  if (!input.stillCurrent()) throw new Error("The tree changed. Prepare the draft again from the current Context.");
  if (skillContextIdentity(fresh) !== skillContextIdentity(input.context)) {
    skillsChanged();
    throw new Error("The selected skill changed. Context is refreshing; prepare the draft again after it updates.");
  }
  return fresh;
}
