import type { VdtAiTaskType } from "@vdt-studio/model-bridge";
import type { VdtAgentRun } from "@vdt-studio/vdt-agent";

export type BackendKind = "mock" | "local_http" | "subscription_cli" | "custom_cli";
export type BackendSupportLevel =
  | "supported"
  | "beta"
  | "alpha"
  | "experimental"
  | "beta-blocked"
  | "experimental-disabled";

export interface BackendManifest {
  id: string;
  label: string;
  kind: BackendKind;
  supportLevel: BackendSupportLevel;
  taskTypes: readonly VdtAiTaskType[];
  schemaIds: readonly string[];
  modelSelection: boolean;
  localHttp?: {
    baseUrl: string;
    defaultModel: string;
  };
  cli?: {
    executableAliases: readonly [string, ...string[]];
    args: readonly string[];
    versionArgs: readonly string[];
  };
  safety: {
    toolsDisabled: boolean;
    requiresOsSandbox: boolean;
    certified: boolean;
    /** Allows tool-capable provider CLIs only when VDT passes a fresh temp workspace and no repo/project cwd. */
    ephemeralWorkspaceOnly?: boolean;
    /** Allows adapter-owned --trust only because cwd is a fresh runner temp directory. */
    trustEphemeralWorkspace?: boolean;
  };
}

export interface CompletionRequest {
  requestId: string;
  backendId: string;
  taskType: VdtAiTaskType;
  schemaId: string;
  input: unknown;
  model?: string;
  timeoutMs?: number;
}

export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
export type RunProgressPhase =
  | "preparing_request"
  | "starting_backend"
  | "waiting_for_provider"
  | "validating_schema"
  | "repairing_output"
  | "building_project"
  | "complete"
  | "error"
  | "cancelled";

export interface RunProgressSnapshot {
  phase: RunProgressPhase;
  label: string;
  updatedAt: string;
}

export interface RunSnapshot {
  requestId: string;
  backendId: string;
  taskType: VdtAiTaskType;
  schemaId: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  latencyMs?: number;
  outputBytes?: number;
  schemaValid?: boolean;
  repaired?: boolean;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
  progress?: RunProgressSnapshot;
  agentRun?: VdtAgentRun;
  output?: unknown;
  error?: { code: string; message: string };
}

export interface AuditEvent {
  requestId: string;
  backendId: string;
  adapterVersion: string;
  executableVersion?: string;
  taskType: VdtAiTaskType;
  startedAt: string;
  latencyMs: number;
  exitCode?: number;
  outputBytes: number;
  schemaValid: boolean;
  repaired?: boolean;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
  errorCode?: string;
}
