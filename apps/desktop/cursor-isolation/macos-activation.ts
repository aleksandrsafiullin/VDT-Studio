import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { CURSOR_CLI_EGRESS_HOSTS, startCursorCliEgress, type CursorEgressEvent } from "../../web/lib/cursor-cli-egress";
import { createMacCursorIsolationRunner, measureMacCursorPolicyIdentity } from "../../../packages/model-bridge/src/agent-engines/cursor-macos-isolation";
import type {
  CursorCheckpointIsolationIdentity,
  CursorCheckpointIsolationRunner,
  CursorCheckpointQualificationEvidence,
  CursorResumeCheckpointEnvironmentFactory
} from "../../../packages/model-bridge/src/agent-engines/cursor-resume-checkpoint-engine";
import { createCursorModelActivations, type CursorActivationEvidence } from "./activation-profile";
import { provisionMacCursorProfile, type MacCursorAuthStatus, type MacCursorProvisionedProfile } from "./macos-provisioning";

type MacCursorLocations = {
  readonly privateRoot: string;
  readonly payloadMount: string;
  readonly dedicatedOAuthFile: string;
  readonly qaEgressDiagnostics?: true;
};

type MacCursorPrivateProfile = CursorActivationEvidence & MacCursorLocations;
type MacCursorStandardProfile = {
  readonly standard: true;
  readonly evidences: readonly CursorCheckpointQualificationEvidence[];
};

declare const __VDT_MAC_CURSOR_PROFILE__: MacCursorPrivateProfile | MacCursorStandardProfile;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const supervisorExecutable = path.resolve(__dirname, "../Helpers/vdt-cursor-macos-supervisor");
const egressPolicyHash = `sha256:${hash(JSON.stringify(CURSOR_CLI_EGRESS_HOSTS))}`;

async function assertOwnedDirectory(directory: string): Promise<void> {
  if (!path.isAbsolute(directory) || await realpath(directory) !== directory) {
    throw new Error("The packaged Cursor work directory is not canonical.");
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
    throw new Error("The packaged Cursor work directory is not private.");
  }
}

export async function createPackagedCursorActivation() {
  const profile = __VDT_MAC_CURSOR_PROFILE__;
  if ("standard" in profile) return createStandardActivation(profile);
  return createCursorModelActivations(profile, evidence => createActivation(profile, evidence));
}

function createStandardActivation(profile: MacCursorStandardProfile) {
  if (process.platform !== "darwin" || process.arch !== "arm64" || !profile.evidences.length
    || new Set(profile.evidences.map(entry => entry.modelId)).size !== profile.evidences.length
    || profile.evidences.some(entry => entry.cliVersion !== profile.evidences[0]?.cliVersion
      || entry.payloadHash !== profile.evidences[0]?.payloadHash || entry.platform.os !== process.platform
      || entry.platform.arch !== process.arch || entry.platform.runtimeVersion !== process.version)) {
    throw new Error("The packaged Mac Cursor profile does not match this runtime.");
  }

  type Activation = Awaited<ReturnType<typeof createActivation>>;
  type Qualified = { readonly locations: MacCursorProvisionedProfile; readonly activations: readonly Activation[] };
  let owned: MacCursorProvisionedProfile | undefined;
  let pending: Promise<Qualified> | undefined;
  const shutdown = new AbortController();

  async function qualify(): Promise<Qualified> {
    shutdown.signal.throwIfAborted();
    const evidence = profile.evidences[0]!;
    const appData = process.env.VDT_DATA_DIR;
    if (!appData) throw new Error("The native Cursor data directory is unavailable.");
    pending ??= (async () => {
      const measured = await Promise.all(profile.evidences.map(async entry => {
        const policy = await measureMacCursorPolicyIdentity(supervisorExecutable, egressPolicyHash, entry.modelId);
        return policy.policyHash === entry.policyHash && policy.vendorPolicyHash === entry.vendorPolicyHash ? entry : null;
      }));
      const admitted = measured.filter(entry => entry !== null);
      if (!admitted.length) throw new Error("This macOS isolation policy is outside the reviewed release.");
      const locations = await provisionMacCursorProfile(appData, evidence, shutdown.signal);
      owned = locations;
      try {
        const candidates = await Promise.allSettled(admitted.map(async entry => {
          const activation = await createActivation(locations, entry, true, shutdown.signal);
          await activation.runner.measureIdentity(activation.executable);
          return activation;
        }));
        const activations = candidates.flatMap(candidate => candidate.status === "fulfilled" ? [candidate.value] : []);
        if (!activations.length) throw new Error("The installed Cursor payload is not qualified.");
        return { locations, activations: Object.freeze(activations) };
      } catch (error) {
        await locations.dispose();
        owned = undefined;
        throw error;
      }
    })().catch(error => {
      if (!owned) pending = undefined;
      throw error;
    });
    const qualified = await pending;
    await qualified.locations.verifyOfficialIdentity();
    return qualified;
  }

  return Object.freeze({
    async getActivations(): Promise<readonly Activation[]> {
      const { locations, activations } = await qualify();
      return await locations.checkAuth() === "ready" ? activations : [];
    },
    async authStatus(): Promise<MacCursorAuthStatus> {
      try {
        return await (await qualify()).locations.checkAuth();
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "CURSOR_NOT_INSTALLED" ? "not_installed" : "unsupported";
      }
    },
    async signIn(): Promise<void> {
      try {
        const { locations, activations } = await qualify();
        const activation = activations[0]!;
        await activation.runner.measureIdentity(activation.executable);
        await locations.signIn();
      } catch {
        throw new Error("Cursor sign-in requires a supported official Cursor Agent CLI and an approved browser session.");
      }
    },
    async dispose(): Promise<void> {
      shutdown.abort();
      const qualified = await pending?.catch(() => undefined);
      try {
        if (qualified) await Promise.all(qualified.activations.map(activation => activation.dispose()));
        await owned?.dispose();
      } catch {
        console.error("Cursor could not confirm macOS payload cleanup. Its owned staging directory was retained.");
      }
    }
  });
}

async function createActivation(
  profile: MacCursorLocations | MacCursorProvisionedProfile,
  evidence: CursorCheckpointQualificationEvidence,
  standard = false,
  shutdown?: AbortSignal
) {
  const { privateRoot, payloadMount, dedicatedOAuthFile } = profile;
  const executable = path.join(payloadMount, "cursor-agent");
  await assertOwnedDirectory(privateRoot);
  function createRunner(egressPort: number) {
    return createMacCursorIsolationRunner({
      executable, payloadMount, supervisorExecutable, privateRoot, egressPort, egressPolicyHash,
      modelId: evidence.modelId,
      dedicatedOAuthFile,
      ...(standard ? { expectedIdentity: evidence } : {}),
      ...(shutdown ? { shutdown } : {})
    });
  }

  type ActiveScope = {
    readonly runner: CursorCheckpointIsolationRunner;
    readonly diagnostics?: {
      readonly id: string;
      readonly events: CursorEgressEvent[];
      segment: number;
      omitted: number;
    };
    pending?: Promise<unknown> | undefined;
    closing: boolean;
    close(): Promise<void>;
  };
  const activeScopes = new Map<string, ActiveScope>();
  const runner: CursorCheckpointIsolationRunner = {
    async measureIdentity(target) {
      const broker = await startCursorCliEgress();
      try {
        return await createRunner(broker.port).measureIdentity(target);
      } finally {
        await broker.close();
      }
    },
    async runQualified(request, identity: CursorCheckpointIsolationIdentity) {
      const scope = activeScopes.get(request.cwd);
      if (!scope || scope.closing || scope.pending) {
        throw new Error("The packaged Cursor process has no exclusive live session scope.");
      }
      const pending = (async () => {
        const signal = shutdown ? AbortSignal.any([request.signal, shutdown]) : request.signal;
        signal.throwIfAborted();
        if ("verifyOfficialIdentity" in profile) await profile.verifyOfficialIdentity(true);
        return scope.runner.runQualified({ ...request, signal }, identity);
      })();
      const started = performance.now();
      const diagnostics = scope.diagnostics;
      let status: number | "stopped" | null = "stopped";
      let networkError: string | undefined;
      scope.pending = pending;
      try {
        const result = await pending;
        if (diagnostics) {
          status = result.exitCode;
          networkError = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].find(code =>
            result.stderr.includes(code) || result.stdout.includes(code)
          );
        }
        return result;
      } finally {
        if (diagnostics) {
          process.stderr.write("[cursor-egress] " + JSON.stringify({
            traceId: diagnostics.id,
            segment: ++diagnostics.segment,
            mode: request.args.includes("--resume") ? "resume" : "open",
            durationMs: Math.round(performance.now() - started),
            status, networkError, omitted: diagnostics.omitted, events: diagnostics.events
          }) + "\n");
          diagnostics.events.length = 0;
          diagnostics.omitted = 0;
        }
        scope.pending = undefined;
      }
    }
  };

  const sessionEnvironmentFactory: CursorResumeCheckpointEnvironmentFactory = async ({ binding, recovery, signal }) => {
    signal.throwIfAborted();
    shutdown?.throwIfAborted();
    const environmentId = `m-${hash(binding.runId).slice(0, 32)}`;
    const scopePath = path.join(privateRoot, environmentId);
    const workspace = path.join(scopePath, "w");
    const state = path.join(scopePath, "s");
    if (activeScopes.has(workspace)) throw new Error("The packaged Cursor session already has a live scope.");
    let ownsNewScope = false;
    let broker: Awaited<ReturnType<typeof startCursorCliEgress>> | undefined;
    try {
      if (!recovery) {
        await mkdir(scopePath, { mode: 0o700 });
        ownsNewScope = true;
        await mkdir(workspace, { mode: 0o700 });
        await mkdir(state, { mode: 0o700 });
      }
      await Promise.all([scopePath, workspace, state].map(assertOwnedDirectory));
      const diagnostics = "qaEgressDiagnostics" in profile && profile.qaEgressDiagnostics === true
        ? { id: randomUUID(), events: [] as CursorEgressEvent[], segment: 0, omitted: 0 }
        : undefined;
      broker = await startCursorCliEgress(undefined, diagnostics && (event => {
        if (diagnostics.events.length < 128) diagnostics.events.push(event);
        else diagnostics.omitted++;
      }));
      signal.throwIfAborted();
      shutdown?.throwIfAborted();
      if (activeScopes.has(workspace)) throw new Error("The packaged Cursor session already has a live scope.");
      const sessionBroker = broker;
      let cleanup: Promise<void> | undefined;
      const scope: ActiveScope = {
        runner: createRunner(sessionBroker.port), closing: false, ...(diagnostics ? { diagnostics } : {}),
        close() {
          scope.closing = true;
          cleanup ??= (async () => {
            if (scope.pending) await Promise.allSettled([scope.pending]);
            await sessionBroker.close();
            await assertOwnedDirectory(scopePath);
            await rm(scopePath, { recursive: true });
            activeScopes.delete(workspace);
          })();
          return cleanup;
        }
      };
      activeScopes.set(workspace, scope);
      return {
        environmentId,
        privateWorkspacePath: workspace,
        privateStatePath: state,
        preauthorizeEmptyWorkspace: true,
        forbiddenRoots: [payloadMount, path.dirname(dedicatedOAuthFile), __dirname],
        close: scope.close
      };
    } catch (error) {
      await broker?.close();
      if (ownsNewScope) {
        await assertOwnedDirectory(scopePath);
        await rm(scopePath, { recursive: true });
      }
      throw error;
    }
  };
  return Object.freeze({
    evidence, executable, runner, sessionEnvironmentFactory,
    async dispose() {
      await Promise.all([...activeScopes.values()].map(scope => scope.close()));
    }
  });
}
