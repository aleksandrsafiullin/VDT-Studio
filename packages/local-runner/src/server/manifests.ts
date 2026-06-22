import type { BackendManifest } from "../cli/types";

const isDarwin = process.platform === "darwin";
const cursorSupportLevel = isDarwin ? ("supported" as const) : ("beta" as const);

const generateTasks = ["generate_tree", "deepen_node", "review_model"] as const;
const schemas = ["connection-test-v1", "generate-tree-v1", "deepen-node-v1", "review-model-v1"] as const;

export const BUILTIN_BACKEND_MANIFESTS: readonly BackendManifest[] = Object.freeze([
  {
    id: "mock",
    label: "Safe Mock",
    kind: "mock",
    supportLevel: "supported",
    taskTypes: generateTasks,
    schemaIds: schemas,
    modelSelection: false,
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "ollama",
    label: "Ollama",
    kind: "local_http",
    supportLevel: "supported",
    taskTypes: generateTasks,
    schemaIds: schemas,
    modelSelection: true,
    localHttp: { baseUrl: "http://127.0.0.1:11434/v1", defaultModel: "qwen3" },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "lm_studio",
    label: "LM Studio",
    kind: "local_http",
    supportLevel: "supported",
    taskTypes: generateTasks,
    schemaIds: schemas,
    modelSelection: true,
    localHttp: { baseUrl: "http://127.0.0.1:1234/v1", defaultModel: "local-model" },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "vllm",
    label: "vLLM",
    kind: "local_http",
    supportLevel: "beta",
    taskTypes: generateTasks,
    schemaIds: schemas,
    modelSelection: true,
    localHttp: { baseUrl: "http://127.0.0.1:8000/v1", defaultModel: "local-model" },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "cursor_subscription",
    label: "Cursor Agent",
    kind: "subscription_cli",
    supportLevel: cursorSupportLevel,
    taskTypes: generateTasks,
    schemaIds: schemas,
    modelSelection: true,
    cli: {
      executableAliases: ["agent", "cursor-agent", "cursor"],
      args: ["--print", "--output-format", "stream-json", "--stream-partial-output"],
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
    id: "codex_subscription",
    label: "Codex CLI",
    kind: "subscription_cli",
    supportLevel: "supported",
    taskTypes: generateTasks,
    schemaIds: schemas,
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
    supportLevel: "supported",
    taskTypes: generateTasks,
    schemaIds: schemas,
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
  ...[
    ["gemini_subscription", "Gemini CLI", ["gemini"]],
    ["copilot_subscription", "GitHub Copilot CLI", ["copilot"]]
  ].map(([id, label, aliases]) => ({
    id: id as string,
    label: label as string,
    kind: "subscription_cli" as const,
    supportLevel: "experimental" as const,
    taskTypes: generateTasks,
    schemaIds: schemas,
    modelSelection: true,
    cli: {
      executableAliases: aliases as [string, ...string[]],
      args: [],
      versionArgs: ["--version"]
    },
    safety: { toolsDisabled: false, requiresOsSandbox: true, certified: false }
  }))
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
