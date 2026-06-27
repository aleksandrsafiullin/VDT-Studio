import {
  VDT_OUTPUT_SCHEMA_IDS,
  VDT_SCHEMA_IDS,
  schemaTasks,
  type VdtAiTaskType
} from "@vdt-studio/model-bridge";
import type { BackendManifest } from "../cli/types";

/** All canonical VDT AI task types (one per output schema). */
export const ALL_VDT_TASK_TYPES = VDT_OUTPUT_SCHEMA_IDS.map((schemaId) => schemaTasks[schemaId]) as readonly VdtAiTaskType[];

/** All registered schema IDs (output schemas + connection-test-v1). */
export const ALL_VDT_SCHEMA_IDS = VDT_SCHEMA_IDS;

export const BUILTIN_BACKEND_MANIFESTS: readonly BackendManifest[] = Object.freeze([
  {
    id: "mock",
    label: "Safe Mock",
    kind: "mock",
    supportLevel: "supported",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: false,
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "ollama",
    label: "Ollama",
    kind: "local_http",
    supportLevel: "supported",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    localHttp: { baseUrl: "http://127.0.0.1:11434/v1", defaultModel: "qwen3" },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "lm_studio",
    label: "LM Studio",
    kind: "local_http",
    supportLevel: "supported",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    localHttp: { baseUrl: "http://127.0.0.1:1234/v1", defaultModel: "local-model" },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "vllm",
    label: "vLLM",
    kind: "local_http",
    supportLevel: "beta",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    localHttp: { baseUrl: "http://127.0.0.1:8000/v1", defaultModel: "local-model" },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "cursor_subscription",
    label: "Cursor Agent",
    kind: "subscription_cli",
    supportLevel: "beta",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    cli: {
      executableAliases: ["agent", "cursor-agent", "cursor"],
      args: ["--print", "--output-format", "stream-json", "--stream-partial-output", "--mode", "ask"],
      versionArgs: ["--version"]
    },
    safety: {
      toolsDisabled: false,
      requiresOsSandbox: false,
      certified: true,
      ephemeralWorkspaceOnly: true,
      trustEphemeralWorkspace: true
    }
  },
  {
    id: "codex_subscription",
    label: "Codex CLI",
    kind: "subscription_cli",
    supportLevel: "alpha",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    cli: {
      executableAliases: ["codex"],
      args: [
        "exec",
        "--ephemeral",
        "--json",
        "--color",
        "never",
        "--skip-git-repo-check",
        "--ignore-rules",
        "--sandbox",
        "workspace-write",
        "-c",
        "sandbox_workspace_write.network_access=true",
        "-c",
        "service_tier=\"fast\""
      ],
      versionArgs: ["--version"]
    },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "claude_subscription",
    label: "Claude Code",
    kind: "subscription_cli",
    supportLevel: "alpha",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    cli: {
      executableAliases: ["claude"],
      args: [
        "-p",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--tools",
        "",
        "--disallowedTools",
        "*",
        "--strict-mcp-config"
      ],
      versionArgs: ["--version"]
    },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "gemini_subscription",
    label: "Gemini CLI",
    kind: "subscription_cli",
    supportLevel: "experimental",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    cli: {
      executableAliases: ["gemini"],
      args: ["--output-format", "json", "--approval-mode", "default"],
      versionArgs: ["--version"]
    },
    safety: {
      toolsDisabled: true,
      requiresOsSandbox: false,
      certified: true
    }
  },
  {
    id: "copilot_subscription",
    label: "GitHub Copilot CLI",
    kind: "subscription_cli",
    supportLevel: "experimental",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    cli: {
      executableAliases: ["copilot"],
      args: [
        "--output-format=json",
        "--stream=off",
        "--available-tools=",
        "--disable-builtin-mcps",
        "--no-custom-instructions",
        "--no-ask-user",
        "--no-auto-update"
      ],
      versionArgs: ["--version"]
    },
    safety: {
      toolsDisabled: true,
      requiresOsSandbox: false,
      certified: true
    }
  }
]);

export function createManifestRegistry(additional: readonly BackendManifest[] = []): ReadonlyMap<string, BackendManifest> {
  const registry = new Map<string, BackendManifest>();
  for (const manifest of [...BUILTIN_BACKEND_MANIFESTS, ...additional]) {
    if (registry.has(manifest.id)) throw new Error(`Duplicate backend manifest: ${manifest.id}`);
    registry.set(manifest.id, Object.freeze({ ...manifest }));
  }
  return registry;
}

export function publicManifest(manifest: BackendManifest) {
  const unavailable =
    manifest.supportLevel === "beta-blocked" || manifest.supportLevel === "experimental-disabled";
  return {
    id: manifest.id,
    backendId: manifest.id,
    label: manifest.label,
    kind: manifest.kind,
    mode: manifest.kind === "mock" ? "local_http" : manifest.kind,
    supportLevel: manifest.supportLevel,
    status: unavailable ? "unavailable" : "available",
    ...(unavailable ? { message: "Backend is present but not enabled for normal execution." } : {}),
    taskTypes: manifest.taskTypes,
    schemaIds: manifest.schemaIds,
    modelSelection: manifest.modelSelection,
    safety: {
      toolsDisabled: manifest.safety.toolsDisabled,
      requiresOsSandbox: manifest.safety.requiresOsSandbox,
      certified: manifest.safety.certified,
      ...(manifest.safety.ephemeralWorkspaceOnly === true ? { ephemeralWorkspaceOnly: true as const } : {})
    }
  };
}
