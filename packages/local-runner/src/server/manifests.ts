import type { BackendManifest } from "../cli/types";

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
  ...[
    ["cursor_subscription", "Cursor Agent", ["agent", "cursor-agent", "cursor"]],
    ["codex_subscription", "Codex CLI", ["codex"]],
    ["claude_subscription", "Claude Code", ["claude"]],
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

export function publicManifest(manifest: BackendManifest) {
  return {
    id: manifest.id,
    label: manifest.label,
    kind: manifest.kind,
    supportLevel: manifest.supportLevel,
    taskTypes: manifest.taskTypes,
    schemaIds: manifest.schemaIds,
    modelSelection: manifest.modelSelection,
    safety: manifest.safety
  };
}
