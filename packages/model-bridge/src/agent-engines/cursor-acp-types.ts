export type CursorAcpJsonRpcId = string | number;

export interface CursorAcpJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: CursorAcpJsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface CursorAcpJsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

export interface CursorAcpJsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: CursorAcpJsonRpcId;
  readonly result: unknown;
}

export interface CursorAcpJsonRpcFailure {
  readonly jsonrpc: "2.0";
  readonly id: CursorAcpJsonRpcId | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export type CursorAcpJsonRpcMessage =
  | CursorAcpJsonRpcRequest
  | CursorAcpJsonRpcNotification
  | CursorAcpJsonRpcSuccess
  | CursorAcpJsonRpcFailure;

export interface CursorAcpRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Transport port used by the engine. Tests and future ACP transports can implement it without spawning a process. */
export interface CursorAcpTransport {
  start(): Promise<void>;
  request(method: string, params: unknown, options?: CursorAcpRequestOptions): Promise<unknown>;
  notify(method: string, params: unknown): Promise<void>;
  respond(id: CursorAcpJsonRpcId, result: unknown): Promise<void>;
  respondError(id: CursorAcpJsonRpcId, code: number, message: string, data?: unknown): Promise<void>;
  onMessage(listener: (message: CursorAcpJsonRpcRequest | CursorAcpJsonRpcNotification) => void): () => void;
  onClose(listener: (error?: Error) => void): () => void;
  stderrTail(): string;
  close(): Promise<void>;
}

export interface CursorAcpMcpEnvironmentEntry {
  readonly name: string;
  readonly value: string;
}

/** Server-owned configuration for the only MCP server admitted to this canary session. */
export interface CursorAcpVdtMcpServer {
  readonly name: "vdt-tool-gateway";
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: readonly CursorAcpMcpEnvironmentEntry[];
}

export type CursorAcpQualificationStatus = "unverified" | "hard_verified";
export type CursorAcpToolIsolation = "unverified" | "hard_verified";

export interface CursorAcpQualificationEvidence {
  readonly status: "hard_verified";
  readonly cliVersion: string;
  readonly protocolVersion: 1;
  readonly platform: string;
  readonly testedAt: string;
  readonly evidenceHash: string;
  readonly toolCatalogHash: string;
}

/**
 * Cursor-specific form of AgentCapabilityProfile. It intentionally remains
 * unverified unless a trusted qualification record is supplied by the host.
 */
export interface CursorAcpCapabilityProfile {
  readonly engine: "cursor_acp";
  readonly profile: "external_cli_agent";
  readonly backend: "cursor";
  readonly cliVersion?: string;
  readonly protocolVersion: "acp-v1";
  readonly sessionStrategy: "native";
  readonly supportsNativeSession: true;
  readonly supportsResume: true;
  readonly supportsStructuredEvents: true;
  readonly supportsToolBridge: true;
  readonly supportsQuestions: true;
  readonly supportsCancellation: true;
  readonly supportsUsageMetrics: false;
  readonly toolIsolation: CursorAcpToolIsolation;
  readonly qualificationStatus: CursorAcpQualificationStatus;
  readonly platform?: string;
  readonly testedAt?: string;
  readonly evidenceHash?: string;
}

export interface CursorAcpEngineStart {
  readonly runId: string;
  readonly engineBindingId: string;
  readonly sessionEpoch: number;
  /** Server-owned root reserved for private per-run ACP workspaces. */
  readonly trustedPrivateWorkspaceRoot: string;
  readonly privateWorkspacePath: string;
  readonly initialPrompt: string;
  readonly model?: string;
  readonly backendSettingsHash: string;
  readonly toolCatalogHash: string;
  readonly allowedToolNames: readonly string[];
  readonly vdtMcpServer: CursorAcpVdtMcpServer;
  /** Canonical Supervisor adapter uses this to persist a prepared exchange
   * before any provider prompt or tool activity starts. */
  readonly deferInitialPrompt?: boolean;
}

export interface CursorAcpEngineResume {
  readonly checkpoint: CursorAcpEngineCheckpoint;
  /** Server-owned root reserved for private per-run ACP workspaces. */
  readonly trustedPrivateWorkspaceRoot: string;
  readonly privateWorkspacePath: string;
  readonly backendSettingsHash: string;
  readonly toolCatalogHash: string;
  readonly allowedToolNames: readonly string[];
  readonly vdtMcpServer: CursorAcpVdtMcpServer;
  /** Finish recovery cannot use history-only session/load because doing so
   * would require a new prompt to obtain the missing final message. */
  readonly requireNativeResume?: boolean;
}

export interface CursorAcpSessionBinding {
  readonly executionProfile: "external_cli_agent";
  readonly engineAdapterId: "cursor-acp";
  readonly backendId: "cursor";
  readonly runId: string;
  readonly engineBindingId: string;
  readonly externalSessionId: string;
  readonly sessionEpoch: number;
  readonly model?: string;
  readonly backendSettingsHash: string;
  readonly toolCatalogHash: string;
  readonly capabilityEvidenceHash?: string;
}

export type CursorAcpSessionState =
  | "idle"
  | "running"
  | "waiting_question"
  | "cancelling"
  | "failed"
  | "closed";

export interface CursorAcpActiveExchangeCheckpoint {
  readonly turnId: string;
  readonly inputHash: string;
  readonly state: "in_flight" | "waiting_question";
}

export interface CursorAcpEngineCheckpoint {
  readonly schemaVersion: 1;
  readonly engineAdapterId: "cursor-acp";
  readonly runId: string;
  readonly engineBindingId: string;
  readonly externalSessionId: string;
  readonly sessionEpoch: number;
  readonly protocolVersion: 1;
  readonly cliVersion?: string;
  readonly model?: string;
  readonly backendSettingsHash: string;
  readonly toolCatalogHash: string;
  readonly mcpServerFingerprint: string;
  readonly capabilityEvidenceHash?: string;
  readonly eventSequence: number;
  readonly state: CursorAcpSessionState;
  readonly lastConfirmedInputHash?: string;
  readonly lastConfirmedOutputHash?: string;
  readonly activeExchange?: CursorAcpActiveExchangeCheckpoint;
  readonly createdAt: string;
}

export interface CursorAcpQuestionOption {
  readonly id: string;
  readonly label: string;
}

export interface CursorAcpQuestionItem {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly CursorAcpQuestionOption[];
  readonly allowMultiple: boolean;
}

export interface CursorAcpQuestionAnswer {
  readonly questionId: string;
  readonly selectedOptionIds: readonly string[];
}

export type CursorAcpHumanInput =
  | {
      readonly type: "message";
      readonly text: string;
    }
  | {
      readonly type: "question_answer";
      readonly requestId: CursorAcpJsonRpcId;
      readonly answers: readonly CursorAcpQuestionAnswer[];
    }
  | {
      readonly type: "question_skipped";
      readonly requestId: CursorAcpJsonRpcId;
      readonly reason?: string;
    };

interface CursorAcpSessionEventBase {
  readonly sequence: number;
  readonly timestamp: string;
  readonly sessionId: string;
  readonly turnId?: string;
}

export type CursorAcpSessionEvent =
  | (CursorAcpSessionEventBase & {
      readonly type: "assistant_message";
      readonly source: "external_agent";
      readonly phase: "delta" | "completed";
      readonly text: string;
      readonly messageId?: string;
    })
  | (CursorAcpSessionEventBase & {
      readonly type: "question";
      readonly source: "external_agent";
      readonly requestId: CursorAcpJsonRpcId;
      readonly title?: string;
      readonly questions: readonly CursorAcpQuestionItem[];
    })
  | (CursorAcpSessionEventBase & {
      readonly type: "runtime_status";
      readonly source: "runtime";
      readonly status: "session_started" | "session_resumed" | "turn_started" | "turn_cancelled" | "session_closed";
    })
  | (CursorAcpSessionEventBase & {
      readonly type: "checkpoint";
      readonly source: "runtime";
      readonly stopReason: string;
      readonly inputHash: string;
      readonly outputHash?: string;
    })
  | (CursorAcpSessionEventBase & {
      readonly type: "warning";
      readonly source: "runtime";
      readonly code: string;
      readonly message: string;
    })
  | (CursorAcpSessionEventBase & {
      readonly type: "error";
      readonly source: "runtime";
      readonly code: string;
      readonly message: string;
    });

/** Non-authoritative ACP observations. They must never be projected as Gateway tool events. */
export type CursorAcpObservation =
  | {
      readonly kind: "vdt_tool_reported";
      readonly sessionId: string;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly status?: string;
      readonly timestamp: string;
    }
  | {
      readonly kind: "vdt_tool_updated";
      readonly sessionId: string;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly status?: string;
      readonly timestamp: string;
    };

export interface CursorAcpRunSession {
  readonly binding: CursorAcpSessionBinding;
  /** Starts a previously deferred provider turn. Canonical Supervisor callers
   * invoke it only after persisting the prepared exchange checkpoint. */
  launchPrompt(text: string, preparedTurnId?: string): void;
  events(): AsyncIterable<CursorAcpSessionEvent>;
  submit(input: CursorAcpHumanInput): Promise<void>;
  checkpoint(): Promise<CursorAcpEngineCheckpoint>;
  cancel(reason: string): Promise<void>;
  close(): Promise<void>;
}
