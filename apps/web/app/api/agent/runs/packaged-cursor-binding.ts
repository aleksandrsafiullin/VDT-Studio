import { createHash } from "node:crypto";
import {
  createQualifiedCursorResumeCheckpointEngine,
  type QualifiedCursorResumeCheckpointOptions
} from "@vdt-studio/model-bridge/node";
import type { AgentExecutionEngine } from "@vdt-studio/vdt-agent-runtime";

/** Native packaged bootstrap supplies this before initializing Next. This
 * authority lives in the server process and is not a renderer message,
 * environment setting, user config record or discovery result. */
const defaultSegmentTimeoutMs = 180_000;
const extraHighSegmentTimeoutMs = 360_000;

const activationKey = Symbol.for("vdt-studio.packaged-cursor-isolation.activation.v1");
type PackagedCursorActivation = Pick<
  QualifiedCursorResumeCheckpointOptions,
  "evidence" | "executable" | "runner" | "sessionEnvironmentFactory"
>;

const server = globalThis as typeof globalThis & {
  readonly [activationKey]?: Readonly<PackagedCursorActivation> | {
    readonly activations: readonly Readonly<PackagedCursorActivation>[];
  };
};

export function packagedCursorActivations(): readonly Readonly<PackagedCursorActivation>[] {
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build"
    || process.env.VDT_APP_MODE !== "desktop") return [];
  const native = server[activationKey];
  if (!native) return [];
  const candidates = "activations" in native ? native.activations : [native];
  const models = candidates.map(candidate => candidate.evidence.modelId);
  return new Set(models).size === models.length ? candidates : [];
}

export async function createPackagedCursorBinding(input: {
  activation: Readonly<PackagedCursorActivation>;
  toolCatalogHash: string;
  allowedToolNames: readonly string[];
  forbiddenRoots: readonly string[];
  resolveBinding: QualifiedCursorResumeCheckpointOptions["resolveBinding"];
}): Promise<{ bindingId: string; modelId: string; engine: AgentExecutionEngine }> {
  const { executable, runner, sessionEnvironmentFactory } = input.activation;
  const evidence = structuredClone(input.activation.evidence);
  const timeoutMs = evidence.modelId === "grok-4.7-xhigh"
    ? extraHighSegmentTimeoutMs
    : defaultSegmentTimeoutMs;
  const engine = await createQualifiedCursorResumeCheckpointEngine({
    executable,
    runner,
    evidence,
    timeoutMs,
    cliVersion: evidence.cliVersion,
    toolCatalogHash: input.toolCatalogHash,
    allowedToolNames: input.allowedToolNames,
    resolveBinding: input.resolveBinding,
    sessionEnvironmentFactory: async (request) => {
      const environment = await sessionEnvironmentFactory(request);
      return {
        ...environment,
        forbiddenRoots: [...new Set([...input.forbiddenRoots, ...environment.forbiddenRoots])],
        ...(environment.close ? { close: environment.close.bind(environment) } : {})
      };
    }
  });
  const evidenceId = createHash("sha256").update(JSON.stringify([
    evidence.evidenceHash, evidence.modelId, evidence.catalogModelDisplayName, evidence.runtimeModelDisplayName,
    evidence.payloadHash, evidence.policyHash, evidence.vendorPolicyHash,
    // Existing unversioned bindings already identify the 180-second policy.
    ...(timeoutMs === defaultSegmentTimeoutMs ? [] : [timeoutMs])
  ])).digest("hex").slice(0, 32);
  return { bindingId: `cursor_desktop_${evidenceId}`, modelId: evidence.modelId, engine };
}
