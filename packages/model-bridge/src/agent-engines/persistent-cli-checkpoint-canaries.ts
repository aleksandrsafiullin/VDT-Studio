import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  AgentCapabilityProfile,
  AgentEngineCheckpoint,
  AgentEngineHost,
  AgentEngineStart,
  AgentRunSession,
  ExternalCliAgentEngine
} from "@vdt-studio/vdt-agent-runtime";
import { parseCheckpointActionBatch, type CheckpointActionBatch } from "./action-batch";

const SAFE_HASH = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,511}$/;
const SAFE_ENVIRONMENT = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "VDT_GATEWAY_CAPABILITY"
]);
const FORBIDDEN_EXECUTABLES = new Set([
  "bash",
  "cmd",
  "env",
  "fish",
  "node",
  "powershell",
  "pwsh",
  "python",
  "python3",
  "sh",
  "zsh"
]);

export const CODEX_CHECKPOINT_PROTOCOL_VERSION = "codex-exec-jsonl-checkpoint-v1" as const;
export const CLAUDE_CHECKPOINT_PROTOCOL_VERSION = "claude-stream-json-checkpoint-v1" as const;
export const VDT_CHECKPOINT_TURN_PROTOCOL_VERSION = "vdt-checkpoint-turn-v1" as const;

type ExternalCapability = Extract<AgentCapabilityProfile, { executionProfile: "external_cli_agent" }>;

export interface VdtOnlyMcpServerConfig {
  /** Absolute reviewed binary; interpreter/shell launchers are forbidden. */
  readonly command: string;
  readonly args: readonly string[];
}

export interface PersistentCliEnvironmentEntry {
  readonly name: string;
  readonly value: string;
}

export interface PersistentCliCheckpointEnvironment {
  readonly environmentId: string;
  readonly privateWorkspacePath: string;
  readonly privateStatePath: string;
  readonly forbiddenRoots: readonly string[];
  readonly processEnvironment: readonly PersistentCliEnvironmentEntry[];
  readonly vdtMcpServer: VdtOnlyMcpServerConfig;
}

export interface PersistentCliProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin: string;
  readonly signal: AbortSignal;
}

export interface PersistentCliProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Deliberately injected: these unqualified adapters have no default process runner. */
export interface PersistentCliProcessRunner {
  run(request: PersistentCliProcessRequest): Promise<PersistentCliProcessResult>;
}

export interface PersistentCheckpointAssistantMessage {
  readonly messageId: string;
  readonly text: string;
}

export type PersistentCheckpointTurn =
  | {
      readonly protocolVersion: typeof VDT_CHECKPOINT_TURN_PROTOCOL_VERSION;
      readonly assistantMessage: PersistentCheckpointAssistantMessage | null;
      readonly action: {
        readonly type: "action_batch";
        readonly batch: CheckpointActionBatch;
      };
    }
  | {
      readonly protocolVersion: typeof VDT_CHECKPOINT_TURN_PROTOCOL_VERSION;
      readonly assistantMessage: null;
      readonly action: {
        readonly type: "final";
        readonly messageId: string;
        readonly finishReceiptId: string;
        readonly text: string;
      };
    };

export interface PersistentCliSegmentResult {
  readonly sessionId: string;
  readonly turn: PersistentCheckpointTurn;
  readonly inputHash: string;
  readonly outputHash: string;
}

export interface PersistentCliSegmentInput {
  readonly mode: "open" | "resume";
  readonly environment: PersistentCliCheckpointEnvironment;
  readonly model: string;
  readonly prompt: string;
  readonly expectedSessionId?: string;
  readonly signal: AbortSignal;
}

interface PersistentCanaryOptions {
  readonly executable: string;
  readonly cliVersion: string;
  readonly toolCatalogHash: string;
  readonly allowedToolNames: readonly string[];
  readonly runner: PersistentCliProcessRunner;
}

export type CodexResumeCheckpointCanaryOptions = PersistentCanaryOptions;
export type ClaudeResumeCheckpointCanaryOptions = PersistentCanaryOptions;

function canaryError(code: string, message: string, details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code, ...details });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw canaryError("CHECKPOINT_JSON_INVALID", "JSON contains a non-finite number.");
    return value;
  }
  if (!isRecord(value)) throw canaryError("CHECKPOINT_JSON_INVALID", "JSON value is unsupported.");
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortJson(value[key])])
  );
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(sortJson(value)));
}

function assertSafeId(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw canaryError("CHECKPOINT_PROTOCOL_INVALID", `${field} is invalid.`);
  }
}

function assertSessionId(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_SESSION_ID.test(value)) {
    throw canaryError("CHECKPOINT_SESSION_INVALID", `${field} is invalid.`);
  }
}

function assertText(value: unknown, field: string, maximum = 8_000): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || byteLength(value) > maximum) {
    throw canaryError("CHECKPOINT_PROTOCOL_INVALID", `${field} is invalid.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw canaryError("CHECKPOINT_PROTOCOL_INVALID", `${field} contains unknown or missing fields.`);
  }
}

export function parsePersistentCheckpointTurn(
  value: unknown,
  allowedToolNames: readonly string[]
): PersistentCheckpointTurn {
  let parsed = value;
  if (typeof value === "string") {
    if (byteLength(value) > 1024 * 1024) {
      throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Checkpoint turn exceeds its byte limit.");
    }
    try {
      parsed = JSON.parse(value.trim()) as unknown;
    } catch {
      throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Checkpoint turn must be exactly one JSON object.");
    }
  }
  if (!isRecord(parsed)) throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Checkpoint turn must be an object.");
  assertExactKeys(parsed, ["action", "assistantMessage", "protocolVersion"], "checkpoint turn");
  if (parsed.protocolVersion !== VDT_CHECKPOINT_TURN_PROTOCOL_VERSION || !isRecord(parsed.action)) {
    throw canaryError("CHECKPOINT_PROTOCOL_MISMATCH", "Checkpoint turn protocol is unknown.");
  }
  if (parsed.action.type === "action_batch") {
    assertExactKeys(parsed.action, ["batch", "type"], "checkpoint action");
    let assistantMessage: PersistentCheckpointAssistantMessage | null = null;
    if (parsed.assistantMessage !== null) {
      if (!isRecord(parsed.assistantMessage)) throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "assistantMessage is invalid.");
      assertExactKeys(parsed.assistantMessage, ["messageId", "text"], "assistantMessage");
      assertSafeId(parsed.assistantMessage.messageId, "assistantMessage.messageId");
      assertText(parsed.assistantMessage.text, "assistantMessage.text");
      assistantMessage = Object.freeze({
        messageId: parsed.assistantMessage.messageId,
        text: parsed.assistantMessage.text
      });
    }
    return Object.freeze({
      protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
      assistantMessage,
      action: Object.freeze({
        type: "action_batch",
        batch: parseCheckpointActionBatch(parsed.action.batch, { allowedToolNames })
      })
    });
  }
  if (parsed.action.type === "final") {
    if (parsed.assistantMessage !== null) throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Final cannot duplicate assistantMessage.");
    assertExactKeys(parsed.action, ["finishReceiptId", "messageId", "text", "type"], "final action");
    assertSafeId(parsed.action.messageId, "final.messageId");
    assertSafeId(parsed.action.finishReceiptId, "final.finishReceiptId");
    assertText(parsed.action.text, "final.text");
    return Object.freeze({
      protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
      assistantMessage: null,
      action: Object.freeze({
        type: "final",
        messageId: parsed.action.messageId,
        finishReceiptId: parsed.action.finishReceiptId,
        text: parsed.action.text
      })
    });
  }
  throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Checkpoint action type is unknown.");
}

function validateExecutable(value: string): string {
  if (!path.isAbsolute(value) || value === path.parse(value).root || value.includes("\0")) {
    throw canaryError("CHECKPOINT_CONFIGURATION_INVALID", "CLI executable must be a non-root absolute path.");
  }
  return value;
}

function validateMcpServer(server: VdtOnlyMcpServerConfig): void {
  validateExecutable(server.command);
  const executable = path.basename(server.command).toLowerCase().replace(/\.exe$/, "");
  if (FORBIDDEN_EXECUTABLES.has(executable)) {
    throw canaryError("CHECKPOINT_UNSAFE_MCP", "VDT MCP cannot be launched through a shell or general-purpose interpreter.");
  }
  if (server.args.some((arg) => arg.includes("\0"))) {
    throw canaryError("CHECKPOINT_UNSAFE_MCP", "VDT MCP argument contains a NUL byte.");
  }
}

function validateTools(names: readonly string[]): readonly string[] {
  if (names.length === 0 || names.length > 100) {
    throw canaryError("CHECKPOINT_CONFIGURATION_INVALID", "allowedToolNames must contain 1-100 VDT tools.");
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(name) || seen.has(name)) {
      throw canaryError("CHECKPOINT_CONFIGURATION_INVALID", `Invalid or duplicate VDT tool: ${name}.`);
    }
    seen.add(name);
  }
  return Object.freeze([...names]);
}

async function canonicalDirectory(value: string, field: string): Promise<string> {
  if (!path.isAbsolute(value) || value === path.parse(value).root || value.includes("\0")) {
    throw canaryError("CHECKPOINT_UNSAFE_ENVIRONMENT", `${field} must be a non-root absolute path.`);
  }
  const stat = await lstat(value).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw canaryError("CHECKPOINT_UNSAFE_ENVIRONMENT", `${field} must be an existing non-symlink directory.`);
  }
  return realpath(value);
}

function contains(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function validateEnvironment(
  input: PersistentCliCheckpointEnvironment,
  open: boolean
): Promise<{ workspace: string; state: string; processEnvironment: Readonly<Record<string, string>> }> {
  if (!SAFE_ID.test(input.environmentId) || input.forbiddenRoots.length === 0) {
    throw canaryError("CHECKPOINT_UNSAFE_ENVIRONMENT", "Stable environment ID and forbidden roots are required.");
  }
  validateMcpServer(input.vdtMcpServer);
  const workspace = await canonicalDirectory(input.privateWorkspacePath, "privateWorkspacePath");
  const state = await canonicalDirectory(input.privateStatePath, "privateStatePath");
  if (contains(workspace, state) || contains(state, workspace)) {
    throw canaryError("CHECKPOINT_UNSAFE_ENVIRONMENT", "Private workspace and state paths overlap.");
  }
  if ((await readdir(workspace)).length > 0 || (open && (await readdir(state)).length > 0)) {
    throw canaryError("SECURITY_BOUNDARY_BREACH", "Private CLI workspace/state is not empty at session open.");
  }
  for (const root of input.forbiddenRoots) {
    const canonicalRoot = await canonicalDirectory(root, "forbiddenRoots[]");
    if (
      contains(canonicalRoot, workspace)
      || contains(workspace, canonicalRoot)
      || contains(canonicalRoot, state)
      || contains(state, canonicalRoot)
    ) {
      throw canaryError("CHECKPOINT_UNSAFE_ENVIRONMENT", "Private CLI paths overlap a forbidden root.");
    }
  }
  const output: Record<string, string> = Object.create(null) as Record<string, string>;
  output.HOME = state;
  const seen = new Set<string>();
  for (const entry of input.processEnvironment) {
    if (!SAFE_ENVIRONMENT.has(entry.name) || seen.has(entry.name) || entry.value.includes("\0") || byteLength(entry.value) > 16 * 1024) {
      throw canaryError("CHECKPOINT_UNSAFE_ENVIRONMENT", `Environment entry ${entry.name || "<empty>"} is not allowed.`);
    }
    seen.add(entry.name);
    output[entry.name] = entry.value;
  }
  if (!seen.has("VDT_GATEWAY_CAPABILITY")) {
    throw canaryError("CHECKPOINT_UNSAFE_ENVIRONMENT", "Per-run VDT Gateway capability is required.");
  }
  if ((output.VDT_GATEWAY_CAPABILITY?.length ?? 0) < 32) {
    throw canaryError("CHECKPOINT_UNSAFE_ENVIRONMENT", "Per-run VDT Gateway capability is too short.");
  }
  return { workspace, state, processEnvironment: Object.freeze(output) };
}

function sanitizeError(result: PersistentCliProcessResult, provider: string): Error {
  return canaryError(
    "CHECKPOINT_PROCESS_FAILED",
    `${provider} checkpoint process failed; raw CLI output is not exposed.`,
    { exitCode: result.exitCode, signal: result.signal }
  );
}

function assertProcessSuccess(result: PersistentCliProcessResult, provider: string): void {
  if (byteLength(result.stdout) > 4 * 1024 * 1024 || byteLength(result.stderr) > 256 * 1024) {
    throw canaryError("CHECKPOINT_OUTPUT_TOO_LARGE", `${provider} checkpoint output exceeded its limit.`);
  }
  if (result.exitCode !== 0 || result.signal !== null) throw sanitizeError(result, provider);
}

function assertNoCapabilityLeak(
  result: PersistentCliProcessResult,
  environment: PersistentCliCheckpointEnvironment
): void {
  const combined = `${result.stdout}\n${result.stderr}`;
  const capability = environment.processEnvironment.find((entry) => entry.name === "VDT_GATEWAY_CAPABILITY")?.value;
  if (capability && capability.length >= 8 && combined.includes(capability)) {
    throw canaryError("SECURITY_BOUNDARY_BREACH", "CLI output exposed the per-run VDT Gateway capability.");
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexMcpConfigArgs(server: VdtOnlyMcpServerConfig, tools: readonly string[]): readonly string[] {
  return Object.freeze([
    "-c", `approval_policy=${tomlString("never")}`,
    "-c", `sandbox_mode=${tomlString("read-only")}`,
    "-c", `mcp_servers.vdt_gateway.command=${tomlString(server.command)}`,
    "-c", `mcp_servers.vdt_gateway.args=${JSON.stringify(server.args)}`,
    "-c", "mcp_servers.vdt_gateway.env_vars=[\"VDT_GATEWAY_CAPABILITY\"]",
    "-c", "mcp_servers.vdt_gateway.required=true",
    "-c", "mcp_servers.vdt_gateway.enabled=true",
    "-c", `mcp_servers.vdt_gateway.enabled_tools=${JSON.stringify(tools)}`,
    "-c", `mcp_servers.vdt_gateway.default_tools_approval_mode=${tomlString("approve")}`
  ]);
}

function claudeMcpConfig(server: VdtOnlyMcpServerConfig): string {
  return JSON.stringify({
    mcpServers: {
      vdt_gateway: {
        type: "stdio",
        command: server.command,
        args: server.args
      }
    }
  });
}

function capability(input: {
  provider: "codex" | "claude";
  cliVersion: string;
  toolCatalogHash: string;
}): ExternalCapability {
  if (!input.cliVersion.trim() || input.cliVersion.length > 120) {
    throw canaryError("CHECKPOINT_VERSION_UNKNOWN", `Exact ${input.provider} CLI version is required.`);
  }
  if (!SAFE_HASH.test(input.toolCatalogHash)) {
    throw canaryError("CHECKPOINT_CONFIGURATION_INVALID", "toolCatalogHash must be a sha256 hash.");
  }
  const codex = input.provider === "codex";
  return Object.freeze({
    schemaVersion: 1,
    executionProfile: "external_cli_agent",
    engineId: `${input.provider}-resume-checkpoint`,
    engineAdapterId: `${input.provider}-resume-checkpoint-v1`,
    backendId: input.provider,
    cli: Object.freeze({ name: input.provider, version: input.cliVersion }),
    protocolVersion: codex ? CODEX_CHECKPOINT_PROTOCOL_VERSION : CLAUDE_CHECKPOINT_PROTOCOL_VERSION,
    sessionStrategy: "checkpoint_resume",
    toolCatalogHash: input.toolCatalogHash,
    toolIsolation: "unverified",
    qualification: Object.freeze({
      status: "unverified",
      platform: Object.freeze({ os: process.platform, arch: process.arch, runtimeVersion: process.version }),
      testedAt: null,
      evidenceHash: null
    }),
    supportsNativeSession: false,
    supportsResume: true,
    supportsStructuredEvents: true,
    supportsToolBridge: true,
    supportsQuestions: true,
    supportsCancellation: true,
    supportsUsageMetrics: codex
  });
}

abstract class UnavailablePersistentCheckpointCanary implements ExternalCliAgentEngine {
  readonly capability: ExternalCapability;

  protected constructor(capabilityInput: ExternalCapability) {
    this.capability = capabilityInput;
  }

  openSession(_start: AgentEngineStart, _host: AgentEngineHost): Promise<AgentRunSession> {
    return Promise.reject(canaryError(
      "EXTERNAL_ENGINE_NOT_QUALIFIED",
      `${this.capability.engineAdapterId} is a typed, unverified protocol canary with no execution authority.`
    ));
  }

  resumeSession(_checkpoint: AgentEngineCheckpoint, _host: AgentEngineHost): Promise<AgentRunSession> {
    return Promise.reject(canaryError(
      "EXTERNAL_ENGINE_NOT_QUALIFIED",
      `${this.capability.engineAdapterId} cannot resume until exact-version live and adversarial qualification passes.`
    ));
  }
}

export class CodexResumeCheckpointCanary extends UnavailablePersistentCheckpointCanary {
  readonly #options: CodexResumeCheckpointCanaryOptions;
  readonly #tools: readonly string[];

  constructor(options: CodexResumeCheckpointCanaryOptions) {
    validateExecutable(options.executable);
    const tools = validateTools(options.allowedToolNames);
    super(capability({ provider: "codex", cliVersion: options.cliVersion, toolCatalogHash: options.toolCatalogHash }));
    this.#options = options;
    this.#tools = tools;
  }

  async runProtocolDiagnostic(input: PersistentCliSegmentInput): Promise<PersistentCliSegmentResult> {
    input.signal.throwIfAborted();
    if (!input.model.trim() || input.model.startsWith("-") || input.model.includes("\0")) {
      throw canaryError("CHECKPOINT_CONFIGURATION_INVALID", "Codex model is invalid.");
    }
    if (input.mode === "resume") assertSessionId(input.expectedSessionId, "expectedSessionId");
    if (input.mode === "open" && input.expectedSessionId !== undefined) {
      throw canaryError("CHECKPOINT_SESSION_INVALID", "Open segment cannot carry a session ID.");
    }
    const prepared = await validateEnvironment(input.environment, input.mode === "open");
    const common = [
      "--json",
      "--strict-config",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--model",
      input.model,
      ...codexMcpConfigArgs(input.environment.vdtMcpServer, this.#tools)
    ];
    const args = input.mode === "open"
      ? ["exec", "--color", "never", "--sandbox", "read-only", "-C", prepared.workspace, ...common, "-"]
      : ["exec", "resume", ...common, input.expectedSessionId!, "-"];
    if (args.includes("--ephemeral") || args.includes("--yolo") || args.includes("--dangerously-bypass-approvals-and-sandbox")) {
      throw canaryError("SECURITY_BOUNDARY_BREACH", "Codex canary enabled a forbidden execution mode.");
    }
    const processEnvironment = Object.freeze({
      ...prepared.processEnvironment,
      CODEX_HOME: prepared.state
    });
    const result = await this.#options.runner.run({
      executable: this.#options.executable,
      args: Object.freeze(args),
      cwd: prepared.workspace,
      environment: processEnvironment,
      stdin: input.prompt,
      signal: input.signal
    });
    assertNoCapabilityLeak(result, input.environment);
    assertProcessSuccess(result, "Codex");
    if ((await readdir(prepared.workspace)).length > 0) {
      throw canaryError("SECURITY_BOUNDARY_BREACH", "Codex wrote to the private checkpoint workspace.");
    }
    const parsed = parseCodexCheckpointStream(result.stdout, this.#tools, input.expectedSessionId);
    return Object.freeze({
      ...parsed,
      inputHash: hashText(input.prompt),
      outputHash: hashJson(parsed.turn)
    });
  }
}

export class ClaudeResumeCheckpointCanary extends UnavailablePersistentCheckpointCanary {
  readonly #options: ClaudeResumeCheckpointCanaryOptions;
  readonly #tools: readonly string[];

  constructor(options: ClaudeResumeCheckpointCanaryOptions) {
    validateExecutable(options.executable);
    const tools = validateTools(options.allowedToolNames);
    super(capability({ provider: "claude", cliVersion: options.cliVersion, toolCatalogHash: options.toolCatalogHash }));
    this.#options = options;
    this.#tools = tools;
  }

  async runProtocolDiagnostic(input: PersistentCliSegmentInput): Promise<PersistentCliSegmentResult> {
    input.signal.throwIfAborted();
    if (!input.model.trim() || input.model.startsWith("-") || input.model.includes("\0")) {
      throw canaryError("CHECKPOINT_CONFIGURATION_INVALID", "Claude model is invalid.");
    }
    if (input.mode === "resume") assertSessionId(input.expectedSessionId, "expectedSessionId");
    if (input.mode === "open" && input.expectedSessionId !== undefined) {
      throw canaryError("CHECKPOINT_SESSION_INVALID", "Open segment cannot carry a session ID.");
    }
    const prepared = await validateEnvironment(input.environment, input.mode === "open");
    const allowedMcpTools = this.#tools.map((name) => `mcp__vdt_gateway__${name}`);
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--bare",
      "--tools",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      claudeMcpConfig(input.environment.vdtMcpServer),
      "--allowedTools",
      allowedMcpTools.join(","),
      "--permission-mode",
      "dontAsk",
      "--no-chrome",
      "--model",
      input.model,
      ...(input.mode === "resume" ? ["--resume", input.expectedSessionId!] : []),
      "Process the VDT checkpoint JSON supplied on stdin. Return only the required structured checkpoint turn."
    ];
    if (args.includes("--no-session-persistence") || args.includes("--fallback-model") || args.includes("--disallowedTools")) {
      throw canaryError("SECURITY_BOUNDARY_BREACH", "Claude canary enabled a forbidden persistence/fallback/tool mode.");
    }
    const processEnvironment = Object.freeze({
      ...prepared.processEnvironment,
      CLAUDE_CONFIG_DIR: prepared.state
    });
    const result = await this.#options.runner.run({
      executable: this.#options.executable,
      args: Object.freeze(args),
      cwd: prepared.workspace,
      environment: processEnvironment,
      stdin: input.prompt,
      signal: input.signal
    });
    assertNoCapabilityLeak(result, input.environment);
    assertProcessSuccess(result, "Claude");
    if ((await readdir(prepared.workspace)).length > 0) {
      throw canaryError("SECURITY_BOUNDARY_BREACH", "Claude wrote to the private checkpoint workspace.");
    }
    const parsed = parseClaudeCheckpointStream(result.stdout, this.#tools, input.expectedSessionId, prepared.workspace);
    return Object.freeze({
      ...parsed,
      inputHash: hashText(input.prompt),
      outputHash: hashJson(parsed.turn)
    });
  }
}

function codexItemType(item: Record<string, unknown>): string | undefined {
  const value = item.type ?? item.item_type;
  return typeof value === "string" ? value : undefined;
}

function assertAllowedCodexMcpItem(item: Record<string, unknown>, tools: readonly string[]): void {
  const server = item.server ?? item.server_name;
  const tool = item.tool ?? item.tool_name;
  if (server !== "vdt_gateway" || typeof tool !== "string" || !tools.includes(tool)) {
    throw canaryError("SECURITY_BOUNDARY_BREACH", "Codex attempted a foreign or unallowlisted MCP tool.");
  }
}

export function parseCodexCheckpointStream(
  stdout: string,
  allowedToolNames: readonly string[],
  expectedSessionId?: string
): { sessionId: string; turn: PersistentCheckpointTurn } {
  if (byteLength(stdout) > 4 * 1024 * 1024) throw canaryError("CHECKPOINT_OUTPUT_TOO_LARGE", "Codex output is too large.");
  let sessionId = expectedSessionId;
  let started = false;
  let completed = false;
  let finalText: string | undefined;
  let completedMessages = 0;
  let lineCount = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineCount += 1;
    if (lineCount > 100_000) throw canaryError("CHECKPOINT_OUTPUT_TOO_LARGE", "Codex output has too many lines.");
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Codex output contains malformed JSONL.");
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Codex output event is invalid.");
    }
    if (event.type === "thread.started") {
      if (started) throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Codex emitted duplicate thread.started.");
      assertSessionId(event.thread_id, "thread.started.thread_id");
      if (sessionId !== undefined && event.thread_id !== sessionId) {
        throw canaryError("CHECKPOINT_SESSION_MISMATCH", "Codex resumed a different thread.");
      }
      sessionId = event.thread_id;
      started = true;
      continue;
    }
    if (event.type === "error" || event.type === "turn.failed") {
      throw canaryError("CHECKPOINT_PROCESS_FAILED", "Codex reported a failed checkpoint turn.");
    }
    if (event.type === "turn.started") continue;
    if (event.type === "turn.completed") {
      completed = true;
      continue;
    }
    if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
      if (!isRecord(event.item)) throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Codex item event is invalid.");
      const type = codexItemType(event.item);
      if (type === "command_execution" || type === "file_change" || type === "web_search" || type === "collab_tool_call") {
        throw canaryError("SECURITY_BOUNDARY_BREACH", `Codex attempted forbidden ${type}.`);
      }
      if (type === "mcp_tool_call") {
        assertAllowedCodexMcpItem(event.item, allowedToolNames);
        continue;
      }
      if (type === "agent_message" || type === "assistant_message") {
        if (event.type === "item.completed" && typeof event.item.text === "string") {
          completedMessages += 1;
          if (completedMessages > 1) {
            throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Codex emitted multiple completed agent messages.");
          }
          finalText = event.item.text;
        }
        continue;
      }
      if (type === "reasoning" || type === "todo_list") continue;
      throw canaryError("CHECKPOINT_PROTOCOL_MISMATCH", "Codex emitted an unknown item type.");
    }
    throw canaryError("CHECKPOINT_PROTOCOL_MISMATCH", "Codex emitted an unknown stream event.");
  }
  if (!started || !completed || !sessionId || !finalText) {
    throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Codex output omitted thread, terminal turn, or agent message evidence.");
  }
  return { sessionId, turn: parsePersistentCheckpointTurn(finalText, allowedToolNames) };
}

function claudeToolName(block: Record<string, unknown>): string | undefined {
  return typeof block.name === "string" ? block.name : undefined;
}

function assertClaudeAssistantTools(event: Record<string, unknown>, allowedToolNames: readonly string[]): void {
  if (!isRecord(event.message) || !Array.isArray(event.message.content)) {
    throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Claude assistant event is malformed.");
  }
  for (const block of event.message.content) {
    if (!isRecord(block) || block.type !== "tool_use") continue;
    const name = claudeToolName(block);
    const expected = allowedToolNames.map((tool) => `mcp__vdt_gateway__${tool}`);
    if (!name || !expected.includes(name)) {
      throw canaryError("SECURITY_BOUNDARY_BREACH", "Claude attempted a built-in, foreign MCP, or unallowlisted tool.");
    }
  }
}

export function parseClaudeCheckpointStream(
  stdout: string,
  allowedToolNames: readonly string[],
  expectedSessionId?: string,
  expectedCwd?: string
): { sessionId: string; turn: PersistentCheckpointTurn } {
  if (byteLength(stdout) > 4 * 1024 * 1024) throw canaryError("CHECKPOINT_OUTPUT_TOO_LARGE", "Claude output is too large.");
  let sessionId = expectedSessionId;
  let initialized = false;
  let turn: PersistentCheckpointTurn | undefined;
  let lineCount = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineCount += 1;
    if (lineCount > 100_000) throw canaryError("CHECKPOINT_OUTPUT_TOO_LARGE", "Claude output has too many lines.");
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Claude output contains malformed JSONL.");
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Claude output event is invalid.");
    }
    if (event.type === "system") {
      if (event.subtype !== "init" || initialized) {
        throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Claude initialization event is invalid.");
      }
      initialized = true;
      assertSessionId(event.session_id, "system.session_id");
      if (sessionId !== undefined && event.session_id !== sessionId) {
        throw canaryError("CHECKPOINT_SESSION_MISMATCH", "Claude resumed a different session.");
      }
      sessionId = event.session_id;
      if (expectedCwd !== undefined && (typeof event.cwd !== "string" || path.resolve(event.cwd) !== expectedCwd)) {
        throw canaryError("SECURITY_BOUNDARY_BREACH", "Claude reported execution outside the private workspace.");
      }
      continue;
    }
    if (event.type === "assistant") {
      assertSessionId(event.session_id, "assistant.session_id");
      if (sessionId !== event.session_id) throw canaryError("CHECKPOINT_SESSION_MISMATCH", "Claude changed session ID.");
      assertClaudeAssistantTools(event, allowedToolNames);
      continue;
    }
    if (event.type === "user") {
      assertSessionId(event.session_id, "user.session_id");
      if (sessionId !== event.session_id) throw canaryError("CHECKPOINT_SESSION_MISMATCH", "Claude changed session ID.");
      continue;
    }
    if (event.type === "result") {
      if (turn !== undefined) throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Claude emitted duplicate terminal results.");
      assertSessionId(event.session_id, "result.session_id");
      if (sessionId !== event.session_id) throw canaryError("CHECKPOINT_SESSION_MISMATCH", "Claude changed session ID.");
      if (event.subtype !== "success" || event.is_error === true) {
        throw canaryError("CHECKPOINT_PROCESS_FAILED", "Claude reported a failed checkpoint result.");
      }
      turn = parsePersistentCheckpointTurn(event.structured_output ?? event.result, allowedToolNames);
      continue;
    }
    throw canaryError("CHECKPOINT_PROTOCOL_MISMATCH", "Claude emitted an unknown stream event.");
  }
  if (!initialized || !sessionId || !turn) {
    throw canaryError("CHECKPOINT_PROTOCOL_INVALID", "Claude output omitted initialization or terminal result evidence.");
  }
  return { sessionId, turn };
}

export function persistentCheckpointCapabilityHash(capabilityValue: ExternalCapability): string {
  return hashJson(capabilityValue);
}
