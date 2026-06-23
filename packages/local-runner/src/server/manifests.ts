import {
  VDT_OUTPUT_SCHEMA_IDS,
  VDT_SCHEMA_IDS,
  schemaTasks,
  type VdtAiTaskType
} from "@vdt-studio/model-bridge";
import type { BackendManifest } from "../cli/types";

/** All 12 canonical VDT AI task types (one per output schema). */
export const ALL_VDT_TASK_TYPES = VDT_OUTPUT_SCHEMA_IDS.map((schemaId) => schemaTasks[schemaId]) as readonly VdtAiTaskType[];

/** All 13 registered schema IDs (12 output schemas + connection-test-v1). */
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
    supportLevel: "beta-blocked",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    cli: {
      executableAliases: ["agent", "cursor-agent", "cursor"],
      args: ["--print", "--output-format", "stream-json", "--stream-partial-output", "--mode", "ask", "--sandbox", "enabled", "--trust"],
      versionArgs: ["--version"]
    },
    safety: {
      toolsDisabled: false,
      requiresOsSandbox: true,
      certified: true,
      sandboxProfile: "darwin-v1",
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
      args: ["exec", "--json", "--color", "never", "--ephemeral", "--sandbox", "read-only"],
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
      requiresOsSandbox: true,
      certified: true,
      sandboxProfile: "darwin-v1"
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
      requiresOsSandbox: true,
      certified: true,
      sandboxProfile: "darwin-v1"
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

function isPublicSandboxCertified(manifest: BackendManifest): boolean {
  const profile = manifest.safety.sandboxProfile;
  if (!manifest.safety.requiresOsSandbox || profile === undefined) return false;
  if (profile === "darwin-v1") return process.platform === "darwin";
  return false;
}

export function publicManifest(manifest: BackendManifest) {
  const sandboxCertified = isPublicSandboxCertified(manifest);
  return {
    id: manifest.id,
    label: manifest.label,
    kind: manifest.kind,
    supportLevel: manifest.supportLevel,
    taskTypes: manifest.taskTypes,
    schemaIds: manifest.schemaIds,
    modelSelection: manifest.modelSelection,
    safety: {
      toolsDisabled: manifest.safety.toolsDisabled,
      requiresOsSandbox: manifest.safety.requiresOsSandbox,
      certified: manifest.safety.certified,
      ...(sandboxCertified ? { sandboxCertified: true as const } : {})
    }
  };
}
