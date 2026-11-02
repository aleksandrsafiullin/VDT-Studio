/** Browser-safe descriptors. Executables and credentials are resolved by the host. */
export const BUILTIN_HARNESS_IDS = ["cursor-agent", "codex", "claude", "copilot", "opencode", "hermes", "kiro", "kimi", "vibe", "kilo", "qwen", "grok-build", "pi"] as const;
export type BuiltinHarnessId = (typeof BUILTIN_HARNESS_IDS)[number];
export type HarnessId = BuiltinHarnessId | `custom-${string}`;
export type HarnessTransport = "native" | "acp" | "vdt-jsonl" | "pi-rpc";
export interface HarnessAccessChecks {
  authentication: "verified" | "required" | "provider_managed" | "unknown";
  protocol: "verified" | "unverified" | "incompatible";
  reason?: string;
}
export interface HarnessDefinition {
  readonly id: HarnessId;
  readonly backendId: string;
  readonly name: string;
  readonly transport: HarnessTransport;
  readonly command: string;
  readonly args: readonly string[];
  readonly docsUrl: string;
  readonly installHint: string;
  readonly custom?: boolean;
  readonly defaultModel?: string;
  readonly timeoutMs?: number;
  /** Names of host environment variables, never secret values. */
  readonly environmentRefs?: Readonly<Record<string, string>>;
  readonly baseHarness?: BuiltinHarnessId | undefined;
  readonly capabilities: { readonly agentSession: boolean; readonly structuredCompletion: boolean; readonly cancellation: boolean };
}
const capabilities = Object.freeze({ agentSession: true, structuredCompletion: true, cancellation: true });
const builtin = (id: BuiltinHarnessId, name: string, command: string, transport: HarnessTransport, args: string[], docsUrl: string, installHint: string): HarnessDefinition => Object.freeze({
  id, backendId: id === "cursor-agent" ? "cursor_subscription" : `${id}_subscription`, name, command, transport, args: Object.freeze(args), docsUrl, installHint, capabilities
});
export const BUILTIN_HARNESSES: readonly HarnessDefinition[] = Object.freeze([
  builtin("claude", "Claude Code", "claude", "native", [], "https://code.claude.com/docs/en/setup", "npm install -g @anthropic-ai/claude-code"),
  builtin("cursor-agent", "Cursor Agent", "agent", "native", [], "https://cursor.com/docs/cli/overview", "Install via cursor.com/cli"),
  builtin("codex", "Codex CLI", "codex", "native", [], "https://developers.openai.com/codex/cli", "npm install -g @openai/codex"),
  builtin("copilot", "GitHub Copilot CLI", "copilot", "acp", ["--acp", "--stdio", "--available-tools=", "--disable-builtin-mcps", "--no-custom-instructions", "--no-auto-update"], "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli", "npm install -g @github/copilot"),
  builtin("opencode", "OpenCode", "opencode", "acp", ["acp"], "https://opencode.ai/docs/acp/", "npm install -g opencode-ai"),
  builtin("hermes", "Hermes Agent", "hermes", "acp", ["acp"], "https://hermes-agent.nousresearch.com/docs/user-guide/features/acp", "Install Hermes and its ACP extra using the official installation guide"),
  builtin("kiro", "Kiro CLI", "kiro-cli", "acp", ["acp", "--agent-engine=v3"], "https://kiro.dev/docs/cli/acp/", "Install Kiro CLI from kiro.dev/downloads"),
  builtin("kimi", "Kimi Code", "kimi", "acp", ["acp"], "https://www.kimi.com/code/docs/en/kimi-code-cli/guides/ides", "Install the current Kimi Code CLI from code.kimi.com; sign in with kimi login"),
  builtin("vibe", "Mistral Vibe", "vibe-acp", "acp", [], "https://docs.mistral.ai/vibe/code/use-vibe-in-other-ides", "Install mistral-vibe using the official Mistral installer; sign in with vibe"),
  builtin("kilo", "Kilo Code", "kilo", "acp", ["acp"], "https://kilo.ai/docs/code-with-ai/platforms/cli", "npm install -g @kilocode/cli"),
  builtin("qwen", "Qwen Code", "qwen", "acp", ["--acp"], "https://qwenlm.github.io/qwen-code-docs/en/users/overview", "npm install -g @qwen-code/qwen-code; configure the provider with /auth"),
  builtin("grok-build", "Grok Build", "grok", "acp", ["--no-auto-update", "agent", "stdio"], "https://docs.x.ai/build/cli/headless-scripting", "Install Grok Build from x.ai/cli; sign in with grok login"),
  builtin("pi", "Pi", "pi", "pi-rpc", ["--mode", "rpc", "--no-session", "--no-tools", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve"], "https://pi.dev/docs/latest/rpc", "npm install -g --ignore-scripts @earendil-works/pi-coding-agent")
]);
export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === "string" && ((BUILTIN_HARNESS_IDS as readonly string[]).includes(value) || /^custom-[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value));
}
export function builtinHarness(value: string): HarnessDefinition | undefined {
  return BUILTIN_HARNESSES.find(h => h.id === value || h.backendId === value);
}
export function isHarnessBackendId(value: unknown): value is string {
  return typeof value === "string" && (BUILTIN_HARNESSES.some(h => h.backendId === value) || value.endsWith("_subscription") && isHarnessId(value.slice(0, -"_subscription".length)));
}
