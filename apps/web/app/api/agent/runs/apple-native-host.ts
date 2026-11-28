import {
  AppleFoundationModelsTransport,
  AppleTransportError,
  type AppleCompletion,
  type AppleCompletionRequest,
  type AppleGuidedField,
  type AppleModelCapability
} from "@vdt-studio/local-runner/apple-foundation-models";
import { formatRepairDecision, type AppleFormatIssue } from "./apple-native-format-repair";

export const APPLE_NATIVE_PROVIDER_ID = "apple_foundation_models";
const MAX_ADMITTED_CONTEXT = 8_192;

interface AppleNativeEnvironment extends Readonly<Record<string, string | undefined>> {
  readonly VDT_APP_MODE?: string;
  readonly VDT_APPLE_FOUNDATION_MODELS_ENABLED?: string;
  readonly VDT_APPLE_FOUNDATION_MODELS_HELPER_PATH?: string;
  readonly VDT_APPLE_FOUNDATION_MODELS_HELPER_SHA256?: string;
}

export type AppleNativePort = Pick<AppleFoundationModelsTransport, "discover" | "complete">;
export type AppleNativeSurface = "agent_run" | "suggested_kpi" | "chat_starters" | "skill_author" | "file_analysis" | "bounded_task";

export const APPLE_NATIVE_SURFACES: Readonly<Record<AppleNativeSurface, "adapter_ready" | "requires_registration">> = {
  agent_run: "adapter_ready",
  suggested_kpi: "adapter_ready",
  chat_starters: "adapter_ready",
  skill_author: "adapter_ready",
  file_analysis: "adapter_ready",
  bounded_task: "requires_registration"
};

let owner: AppleNativePort | undefined;

/** Called only by the trusted packaged-web host once release activation is
 * approved. No browser configuration or alternate inference routes are read. */
export function packagedAppleNativePort(env: AppleNativeEnvironment = process.env): AppleNativePort | null {
  if (process.platform !== "darwin" || process.arch !== "arm64" || env.VDT_APP_MODE !== "desktop"
    || env.VDT_APPLE_FOUNDATION_MODELS_ENABLED !== "true") return null;
  const helperPath = env.VDT_APPLE_FOUNDATION_MODELS_HELPER_PATH;
  const helperSha256 = env.VDT_APPLE_FOUNDATION_MODELS_HELPER_SHA256;
  if (!helperPath || !helperSha256) throw new AppleTransportError("helper_identity");
  return owner ??= new AppleFoundationModelsTransport({ helperPath, helperSha256 });
}

export async function discoverAppleNativeCapability(port: AppleNativePort, locale: string, signal?: AbortSignal): Promise<AppleModelCapability> {
  const capability = await port.discover(locale, signal);
  if (!capability.tokenBudgetVerified) throw new AppleTransportError("token_api_unavailable");
  if (capability.contextSize !== MAX_ADMITTED_CONTEXT) throw new AppleTransportError("stale_identity");
  return capability;
}

export async function revalidateAppleNativeCapability(port: AppleNativePort, pinned: AppleModelCapability, signal?: AbortSignal): Promise<void> {
  const current = await discoverAppleNativeCapability(port, pinned.locale, signal);
  if (current.contextSize !== pinned.contextSize
    || current.identity.model !== pinned.identity.model
    || current.identity.osBuild !== pinned.identity.osBuild
    || current.identity.profile !== pinned.identity.profile
    || current.identity.modelRevision !== pinned.identity.modelRevision) throw new AppleTransportError("stale_identity");
}

export type AppleNativeTaskShape = Pick<AppleCompletionRequest, "schema" | "maxOutputTokens" | "timeoutMs">;

export interface AppleNativeBoundedTask<TInput, TOutput> extends AppleNativeTaskShape {
  /** Registered by the host per task and version. Receives bounded canonical input. */
  readonly buildPrompt: (input: TInput) => string;
  /** Use the existing registered canonical validator for this analytical task. */
  readonly validateCanonical: (proposal: unknown) => TOutput;
}

/** Shared by future registered Smart, file and bounded routes. Native output
 * is never executable authority. This module does not register any tasks. */
export async function completeAppleNativeBoundedTask<TInput, TOutput>(options: {
  port: AppleNativePort;
  pinned: AppleModelCapability;
  task: AppleNativeBoundedTask<TInput, TOutput>;
  input: TInput;
  signal?: AbortSignal | undefined;
}): Promise<AppleCompletion<TOutput>> {
  const { pinned, port, task, input, signal } = options;
  await revalidateAppleNativeCapability(port, pinned, signal);
  const result = await port.complete({
    locale: pinned.locale,
    expectedIdentity: pinned.identity,
    prompt: task.buildPrompt(input),
    schema: task.schema,
    maxOutputTokens: task.maxOutputTokens,
    timeoutMs: task.timeoutMs,
    ...(signal ? { signal } : {})
  }, task.validateCanonical);
  if (result.context.contextSize !== pinned.contextSize) throw new AppleTransportError("stale_identity");
  return result;
}


/** The canonical validator explicitly marks a mechanically repairable fragment.
 * A semantic hold must remain a normal result. */
export class AppleFragmentFormatRejection {
  constructor(
    readonly issues: readonly AppleFormatIssue[],
    readonly fields: readonly AppleGuidedField[],
    readonly preserved: Readonly<Record<string, unknown>>
  ) {}
}

export async function completeAppleNativeRepairableTask<TInput, TOutput>(options: {
  port: AppleNativePort;
  pinned: AppleModelCapability;
  task: AppleNativeBoundedTask<TInput, TOutput | AppleFragmentFormatRejection | undefined>;
  input: TInput;
  signal?: AbortSignal | undefined;
  onRepair?: () => void;
}): Promise<TOutput | undefined> {
  const { value } = await completeAppleNativeBoundedTask(options);
  if (!(value instanceof AppleFragmentFormatRejection)) return value;
  options.onRepair?.();
  const { task } = options;
  const required = value.fields.map(field => field.name);
  const { value: corrected } = await completeAppleNativeBoundedTask({
    ...options,
    task: {
      ...task,
      schema: { kind: "object", fields: [formatRepairDecision, ...(required.length ? [{
        name: "fragment", optional: true, shape: { kind: "object", fields: value.fields }
      } as const] : [])] },
      buildPrompt: input => JSON.stringify({
        instruction: "The prior response failed format validation and was not accepted. Review formatFeedback. Choose repair to approve the retained fields and supply only the requested replacement fields, if any. Choose decline if this cannot represent the decision. Never invent user evidence.",
        formatFeedback: { issues: value.issues, preserved: value.preserved, replaceFields: required },
        originalTask: task.buildPrompt(input)
      }),
      validateCanonical: proposal => {
        if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) return;
        const response = proposal as Record<string, unknown>;
        if (response.repairDecision !== "repair" || Object.keys(response).length !== (required.length ? 2 : 1)) return;
        const fragment = response.fragment;
        if (required.length && (!fragment || typeof fragment !== "object" || Array.isArray(fragment)
          || Object.keys(fragment).length !== required.length || !required.every(key => Object.hasOwn(fragment, key)))) return;
        const result = task.validateCanonical({ ...value.preserved, ...(required.length ? fragment as object : {}) });
        return result instanceof AppleFragmentFormatRejection ? undefined : result;
      }
    }
  });
  return corrected;
}
