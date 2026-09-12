import type {
  AgentEngineCheckpoint,
  AgentEngineHost,
  AgentEngineStart,
  AgentRunSession,
  ExternalCliAgentEngine
} from "@vdt-studio/vdt-agent-runtime";
import { VDT_CHECKPOINT_TURN_PROTOCOL_VERSION } from "./persistent-cli-checkpoint-canaries";
import {
  CLAUDE_CHECKPOINT_PROTOCOL_VERSION,
  ClaudeResumeCheckpointTransport,
  type ClaudeResumeCheckpointEnvironment
} from "./claude-resume-checkpoint-transport";
import {
  ResumeCheckpointEngine,
  resumeCheckpointCapabilityHash,
  type ResumeCheckpointEnvironmentFactory,
  type ResumeCheckpointEnvironmentFactoryInput,
  type ResumeCheckpointProviderDescriptor
} from "./resume-checkpoint-engine-core";
import { SAFE_HASH } from "./checkpoint-transport-common";

const CLAUDE_DESCRIPTOR: ResumeCheckpointProviderDescriptor = Object.freeze({
  engineId: "claude-resume-checkpoint",
  engineAdapterId: "claude-resume-checkpoint-v1",
  backendId: "claude_subscription",
  cliName: "claude",
  sessionSlug: "claude",
  protocolVersion: CLAUDE_CHECKPOINT_PROTOCOL_VERSION,
  turnProtocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
  errorPrefix: "CLAUDE_CHECKPOINT",
  cliLabel: "Claude",
  supportsUsageMetrics: false,
  securityConstraint: "Do not use Claude shell, file, Git, web, browser, MCP, or tool_use capabilities. Use only the returned ActionBatch JSON protocol and VDT tools executed by the host gateway."
});

export type ClaudeResumeCheckpointEnvironmentFactory = (
  input: ResumeCheckpointEnvironmentFactoryInput
) => ClaudeResumeCheckpointEnvironment | Promise<ClaudeResumeCheckpointEnvironment>;

export interface ClaudeResumeCheckpointEngineOptions {
  readonly transport: ClaudeResumeCheckpointTransport;
  readonly cliVersion: string;
  readonly toolCatalogHash: string;
  readonly allowedToolNames: readonly string[];
  readonly sessionEnvironmentFactory: ClaudeResumeCheckpointEnvironmentFactory;
  readonly resolveBinding: (checkpoint: AgentEngineCheckpoint) => import("@vdt-studio/vdt-agent-runtime").AgentSessionBinding | Promise<import("@vdt-studio/vdt-agent-runtime").AgentSessionBinding>;
  readonly enableUnverifiedCanary?: boolean;
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly maxSegments?: number;
}

export function claudeResumeCheckpointCapabilityHash(
  capability: ClaudeResumeCheckpointEngine["capability"]
): string {
  return resumeCheckpointCapabilityHash(capability);
}

export class ClaudeResumeCheckpointEngine implements ExternalCliAgentEngine {
  readonly capability;
  readonly #engine: ResumeCheckpointEngine;

  constructor(options: ClaudeResumeCheckpointEngineOptions) {
    this.#engine = new ResumeCheckpointEngine({
      descriptor: CLAUDE_DESCRIPTOR,
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
