import type {
  AgentEngineCheckpoint,
  AgentEngineHost,
  AgentEngineStart,
  AgentRunSession,
  ExternalCliAgentEngine
} from "@vdt-studio/vdt-agent-runtime";
import { VDT_CHECKPOINT_TURN_PROTOCOL_VERSION } from "./persistent-cli-checkpoint-canaries";
import {
  CODEX_CHECKPOINT_PROTOCOL_VERSION,
  CodexResumeCheckpointTransport,
  type CodexResumeCheckpointEnvironment
} from "./codex-resume-checkpoint-transport";
import {
  ResumeCheckpointEngine,
  resumeCheckpointCapabilityHash,
  type ResumeCheckpointEnvironmentFactory,
  type ResumeCheckpointEnvironmentFactoryInput,
  type ResumeCheckpointProviderDescriptor
} from "./resume-checkpoint-engine-core";
import { SAFE_HASH } from "./checkpoint-transport-common";

const CODEX_DESCRIPTOR: ResumeCheckpointProviderDescriptor = Object.freeze({
  engineId: "codex-resume-checkpoint",
  engineAdapterId: "codex-resume-checkpoint-v1",
  backendId: "codex_subscription",
  cliName: "codex",
  sessionSlug: "codex",
  protocolVersion: CODEX_CHECKPOINT_PROTOCOL_VERSION,
  turnProtocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
  errorPrefix: "CODEX_CHECKPOINT",
  cliLabel: "Codex",
  supportsUsageMetrics: true,
  securityConstraint: "Do not use Codex shell, file, Git, browser, MCP, or approval bypass modes. Native web search is allowed; write numbers from it with valueStatus default_assumption and valueSource.sourceTier native_web_search, never as user_provided_value or research.search_web citations. Use only the returned ActionBatch JSON protocol and VDT tools executed by the host gateway."
});

export type CodexResumeCheckpointEnvironmentFactory = (
  input: ResumeCheckpointEnvironmentFactoryInput
) => CodexResumeCheckpointEnvironment | Promise<CodexResumeCheckpointEnvironment>;

export interface CodexResumeCheckpointEngineOptions {
  readonly transport: CodexResumeCheckpointTransport;
  readonly cliVersion: string;
  readonly toolCatalogHash: string;
  readonly allowedToolNames: readonly string[];
  readonly sessionEnvironmentFactory: CodexResumeCheckpointEnvironmentFactory;
  readonly resolveBinding: (checkpoint: AgentEngineCheckpoint) => import("@vdt-studio/vdt-agent-runtime").AgentSessionBinding | Promise<import("@vdt-studio/vdt-agent-runtime").AgentSessionBinding>;
  readonly enableUnverifiedCanary?: boolean;
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly maxSegments?: number;
}

export function codexResumeCheckpointCapabilityHash(
  capability: CodexResumeCheckpointEngine["capability"]
): string {
  return resumeCheckpointCapabilityHash(capability);
}

export class CodexResumeCheckpointEngine implements ExternalCliAgentEngine {
  readonly capability;
  readonly #engine: ResumeCheckpointEngine;

  constructor(options: CodexResumeCheckpointEngineOptions) {
    this.#engine = new ResumeCheckpointEngine({
      descriptor: CODEX_DESCRIPTOR,
      transport: options.transport,
      cliVersion: options.cliVersion,
      toolCatalogHash: options.toolCatalogHash,
      allowedToolNames: options.allowedToolNames,
      sessionEnvironmentFactory: options.sessionEnvironmentFactory as ResumeCheckpointEnvironmentFactory,
      resolveBinding: options.resolveBinding,
      ...(options.enableUnverifiedCanary !== undefined ? { enableUnverifiedCanary: options.enableUnverifiedCanary } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.idFactory ? { idFactory: options.idFactory } : {}),
      ...(options.maxSegments !== undefined ? { maxSegments: options.maxSegments } : {}),
      isCheckpointHash: (value) => SAFE_HASH.test(value)
    });
    this.capability = this.#engine.capability;
  }

  openSession(start: AgentEngineStart, host: AgentEngineHost): Promise<AgentRunSession> {
    return this.#engine.openSession(start, host);
  }

  resumeSession(checkpoint: AgentEngineCheckpoint, host: AgentEngineHost): Promise<AgentRunSession> {
    return this.#engine.resumeSession(checkpoint, host);
  }
}
