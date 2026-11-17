import type { QualifiedCursorResumeCheckpointOptions } from "@vdt-studio/model-bridge/node";

const activationKey = Symbol.for("vdt-studio.packaged-cursor-isolation.activation.v1");
const hostKey = Symbol.for("vdt-studio.packaged-web-host.v1");

type PackagedCursorActivation = Pick<
  QualifiedCursorResumeCheckpointOptions,
  "evidence" | "executable" | "runner" | "sessionEnvironmentFactory"
>;

export type PackagedCursorAuthStatus = "ready" | "not_installed" | "sign_in_required" | "unsupported";

interface StandardActivation {
  getActivations(): Promise<readonly Readonly<PackagedCursorActivation>[]>;
  authStatus(): Promise<PackagedCursorAuthStatus>;
  signIn(): Promise<void>;
  dispose?(): Promise<void>;
}

const server = globalThis as typeof globalThis & {
  readonly [activationKey]?: StandardActivation | Readonly<PackagedCursorActivation> | {
    readonly activations: readonly Readonly<PackagedCursorActivation>[];
  };
  readonly [hostKey]?: true;
};

const unavailableActivation: StandardActivation = {
  getActivations: async () => [],
  authStatus: async () => "unsupported",
  signIn: async () => { throw new Error("The managed Cursor profile is unavailable."); }
};

export function standardPackagedCursorProfile(): StandardActivation | undefined {
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build"
    || process.env.VDT_APP_MODE !== "desktop") return;
  const activation = server[activationKey];
  if (activation && "getActivations" in activation) {
    if (typeof activation.getActivations === "function" && typeof activation.authStatus === "function"
      && typeof activation.signIn === "function") return activation;
    return unavailableActivation;
  }
  if (activation && ("evidence" in activation || Array.isArray(activation.activations))) return;
  if (server[hostKey] === true) return unavailableActivation;
}
