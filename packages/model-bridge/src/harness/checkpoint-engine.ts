import { createHash } from "node:crypto";
import { HarnessRpcSession, createHarnessSession, harnessEnvironment } from "./rpc-session";
import type { HarnessDefinition } from "./catalog";
import { ResumeCheckpointEngine, type ResumeCheckpointEngineOptions, type ResumeCheckpointSegmentInput, type ResumeCheckpointTransport } from "../agent-engines/resume-checkpoint-engine-core";
import { VDT_CHECKPOINT_TURN_PROTOCOL_VERSION } from "../agent-engines/persistent-cli-checkpoint-canaries";
import { selectCheckpointTurnFromAgentMessages } from "../agent-engines/checkpoint-turn";

export class HarnessCheckpointTransport implements ResumeCheckpointTransport {
  readonly sessions = new Map<string, HarnessRpcSession>();
  constructor(readonly definition: HarnessDefinition, readonly executable: string, readonly validatedCliVersion: string) {}
  async executeSegment(input: ResumeCheckpointSegmentInput, allowedToolNames: readonly string[]) {
    const { environment } = input;
    let session = this.sessions.get(environment.environmentId);
    const controller = new AbortController(), abort = () => controller.abort();
    input.signal.addEventListener("abort", abort, { once: true }); if (input.signal.aborted) abort();
    const timer = setTimeout(abort, this.definition.timeoutMs ?? 180_000);
    try {
      let sessionId = input.expectedSessionId;
      if (!session) {
        session = createHarnessSession(this.definition, { executable: this.executable, cwd: environment.privateWorkspacePath, environment: harnessEnvironment(this.definition) });
        this.sessions.set(environment.environmentId, session);
        const opened = await session.open(controller.signal, input.expectedSessionId);
        sessionId = opened.sessionId;
        await session.selectModel(input.model, controller.signal);
      }
      const text = await session.prompt(input.prompt, controller.signal);
      const turn = selectCheckpointTurnFromAgentMessages([text], { protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION, allowedToolNames, errorPrefix: "HARNESS_CHECKPOINT" });
      const hash = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
      return { sessionId: sessionId!, inputHash: hash(input.prompt), outputHash: hash(text), turn, processSpawnCount: input.mode === "open" ? 1 : 0 };
    } catch (e) {
      if ((e as { code?: string })?.code !== "CLEANUP_UNCONFIRMED" && controller.signal.aborted && !input.signal.aborted) throw Object.assign(new Error("Harness agent segment timed out."), { code: "TIMEOUT" });
      throw e;
    } finally { clearTimeout(timer); input.signal.removeEventListener("abort", abort); }
  }
  async closeEnvironment(id: string): Promise<void> { const s = this.sessions.get(id); await s?.close(); this.sessions.delete(id); }
}
export function harnessEngineAdapterId(h: HarnessDefinition): string { return `${h.id}-${h.transport}-checkpoint-v1`; }
export function createHarnessCheckpointEngine(options: Omit<ResumeCheckpointEngineOptions, "descriptor" | "transport" | "cliVersion"> & { definition: HarnessDefinition; executable: string; cliVersion: string; transport: HarnessCheckpointTransport }) {
  const h = options.definition;
  return new ResumeCheckpointEngine({ ...options, descriptor: {
    engineId: `${h.id}-checkpoint`, engineAdapterId: harnessEngineAdapterId(h), backendId: h.backendId, cliName: h.id, sessionSlug: h.id,
    protocolVersion: `${h.transport}-checkpoint-v1`, turnProtocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION, errorPrefix: "HARNESS_CHECKPOINT", cliLabel: h.name,
    supportsUsageMetrics: false, securityConstraint: "Use only ActionBatch JSON and the VDT tools executed by the host Gateway. Native tools, filesystem, commands, MCP, plugins, hooks, memory and delegation are unavailable in this VDT profile."
  } });
}
