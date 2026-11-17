import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { CURSOR_CLI_EGRESS_HOSTS, startCursorCliEgress, type CursorEgressEvent } from "../../web/lib/cursor-cli-egress";
import { createMacCursorIsolationRunner } from "../../../packages/model-bridge/src/agent-engines/cursor-macos-isolation";
import type {
  CursorCheckpointIsolationIdentity,
  CursorCheckpointIsolationRunner,
  CursorCheckpointQualificationEvidence,
  CursorResumeCheckpointEnvironmentFactory
} from "../../../packages/model-bridge/src/agent-engines/cursor-resume-checkpoint-engine";
import { createCursorModelActivations, type CursorActivationEvidence } from "./activation-profile";

type MacCursorProfile = CursorActivationEvidence & {
  readonly privateRoot: string;
  readonly payloadMount: string;
  readonly dedicatedOAuthFile: string;
  readonly qaEgressDiagnostics?: true;
};

// The private packaging input replaces this literal with the reviewed local
// profile. The ordinary package has no digest or compiled activation resource.
declare const __VDT_MAC_CURSOR_PROFILE__: MacCursorProfile;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

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
  return createCursorModelActivations(profile, evidence => createActivation(profile, evidence));
}

async function createActivation(profile: MacCursorProfile, evidence: CursorCheckpointQualificationEvidence) {
  const { privateRoot, payloadMount, dedicatedOAuthFile } = profile;
  const executable = path.join(payloadMount, "cursor-agent");
  const supervisorExecutable = path.resolve(__dirname, "../Helpers/vdt-cursor-macos-supervisor");
  const egressPolicyHash = `sha256:${hash(JSON.stringify(CURSOR_CLI_EGRESS_HOSTS))}`;
  await assertOwnedDirectory(privateRoot);
  function createRunner(egressPort: number) {
    return createMacCursorIsolationRunner({
      executable, payloadMount, supervisorExecutable, privateRoot, egressPort, egressPolicyHash,
      modelId: evidence.modelId,
      dedicatedOAuthFile
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
      const pending = scope.runner.runQualified(request, identity);
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
      const diagnostics = profile.qaEgressDiagnostics === true
        ? { id: randomUUID(), events: [] as CursorEgressEvent[], segment: 0, omitted: 0 }
        : undefined;
      broker = await startCursorCliEgress(undefined, diagnostics && (event => {
        if (diagnostics.events.length < 128) diagnostics.events.push(event);
        else diagnostics.omitted++;
      }));
      signal.throwIfAborted();
      if (activeScopes.has(workspace)) throw new Error("The packaged Cursor session already has a live scope.");
      const sessionBroker = broker;
      const scope: ActiveScope = {
        runner: createRunner(sessionBroker.port), closing: false, ...(diagnostics ? { diagnostics } : {})
      };
      activeScopes.set(workspace, scope);
      let cleanup: Promise<void> | undefined;
      return {
        environmentId,
        privateWorkspacePath: workspace,
        privateStatePath: state,
        preauthorizeEmptyWorkspace: true,
        forbiddenRoots: [payloadMount, path.dirname(dedicatedOAuthFile), __dirname],
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
    } catch (error) {
      await broker?.close();
      if (ownsNewScope) {
        await assertOwnedDirectory(scopePath);
        await rm(scopePath, { recursive: true });
      }
      throw error;
    }
  };
  return Object.freeze({ evidence, executable, runner, sessionEnvironmentFactory });
}
