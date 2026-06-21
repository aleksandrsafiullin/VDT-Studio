import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import os from "node:os";
import path from "node:path";
import {
  CODING_AGENT_IDS,
  findExecutableOnPath,
  getAgentDefinition,
  type AgentRunEvent,
  type AgentRunParams,
  type AgentStreamFormat,
  type CodingAgentId,
  type ExecutableCheck
} from "./agent-runtime";
import { runAcpClient } from "./acp-client";
import { drivePiRpc } from "./pi-rpc-client";

const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_KILL_GRACE_MS = 3_000;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_PROMPT_BYTES = 1024 * 1024;
const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

export const DEFAULT_ENV_ALLOWLIST = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP",
  "LANG", "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM", "NO_COLOR", "CI",
  "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL", "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION", "GOOGLE_GENAI_USE_VERTEXAI", "GEMINI_CLI_TRUST_WORKSPACE", "GITHUB_TOKEN", "GH_TOKEN",
  "OPENROUTER_API_KEY", "XAI_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY",
  "KIMI_API_KEY", "MOONSHOT_API_KEY", "QWEN_API_KEY", "DASHSCOPE_API_KEY",
  "HERMES_HOME", "HERMES_INFERENCE_MODEL", "PI_CODING_AGENT_DIR",
  "PI_CODING_AGENT_SESSION_DIR", "PI_OFFLINE", "PI_SKIP_VERSION_CHECK", "PI_TELEMETRY"
] as const);

const COMMON_INHERITED_ENV = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL",
  "LC_CTYPE", "TERM", "COLORTERM", "NO_COLOR", "CI", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME"
]);

const AGENT_INHERITED_ENV: Partial<Record<CodingAgentId, readonly string[]>> = {
  claude: ["ANTHROPIC_API_KEY"],
  codex: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_GENAI_USE_VERTEXAI"],
  copilot: ["GITHUB_TOKEN", "GH_TOKEN"],
  hermes: ["HERMES_HOME", "HERMES_INFERENCE_MODEL"],
  kimi: ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
  qwen: ["QWEN_API_KEY", "DASHSCOPE_API_KEY"],
  pi: ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_OFFLINE", "PI_SKIP_VERSION_CHECK", "PI_TELEMETRY"],
  vibe: ["MISTRAL_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  "grok-build": ["XAI_API_KEY"]
};

export type PromptTransport = "argv" | "stdin" | "file" | "acp" | "pi-rpc";

export interface AgentCommandContext {
  readonly prompt: string;
  readonly promptFile?: string;
  readonly model?: string;
  readonly sessionId?: string;
  readonly systemPrompt?: string;
}

export interface AgentCommandAdapter {
  readonly id: CodingAgentId;
  readonly promptTransport: PromptTransport;
  readonly outputFormat: AgentStreamFormat;
  readonly supportsSession: boolean;
  readonly buildArgv: (context: AgentCommandContext) => readonly string[];
}

const add = (argv: string[], flag: string, value: string | undefined): void => {
  if (value !== undefined) argv.push(flag, value);
};

const prependSystem = (prompt: string, systemPrompt: string | undefined): string =>
  systemPrompt === undefined ? prompt : `${systemPrompt}\n\n${prompt}`;

const adapter = (
  id: CodingAgentId,
  promptTransport: PromptTransport,
  outputFormat: AgentStreamFormat,
  supportsSession: boolean,
  buildArgv: AgentCommandAdapter["buildArgv"]
): AgentCommandAdapter => Object.freeze({ id, promptTransport, outputFormat, supportsSession, buildArgv });

// Every catalog entry is intentionally explicit. CLI syntax is not interchangeable between agents.
export const AGENT_COMMAND_ADAPTERS: Readonly<Record<CodingAgentId, AgentCommandAdapter>> = Object.freeze({
  claude: adapter("claude", "stdin", "json-lines", true, ({ model, sessionId, systemPrompt }) => {
    const argv = ["-p", "--output-format", "stream-json", "--verbose"];
    add(argv, "--model", model);
    add(argv, "--resume", sessionId);
    add(argv, "--system-prompt", systemPrompt);
    return argv;
  }),
  codex: adapter("codex", "stdin", "json-lines", true, ({ model, sessionId, systemPrompt }) => {
    const argv = ["exec"];
    if (sessionId !== undefined) argv.push("resume", sessionId);
    argv.push("--json", "--color", "never");
    add(argv, "--model", model);
    if (systemPrompt !== undefined) argv.push("-c", `developer_instructions=${JSON.stringify(systemPrompt)}`);
    return argv;
  }),
  opencode: adapter("opencode", "stdin", "json-lines", true, ({ model, sessionId }) => {
    const argv = ["run", "--format", "json"];
    add(argv, "--model", model);
    add(argv, "--session", sessionId);
    return argv;
  }),
  hermes: adapter("hermes", "acp", "acp-json-rpc", true, () => ["acp", "--accept-hooks"]),
  antigravity: adapter("antigravity", "argv", "text", false, ({ prompt, model, systemPrompt }) => {
    const argv = ["run", "--non-interactive"];
    add(argv, "--model", model);
    argv.push(prependSystem(prompt, systemPrompt));
    return argv;
  }),
  gemini: adapter("gemini", "stdin", "json-lines", false, ({ model }) => {
    const argv = ["--output-format", "stream-json", "--yolo"];
    add(argv, "--model", model);
    return argv;
  }),
  "grok-build": adapter("grok-build", "argv", "text", false, ({ prompt, model, systemPrompt }) => {
    const argv = ["run", "--no-interactive"];
    add(argv, "--model", model);
    argv.push(prependSystem(prompt, systemPrompt));
    return argv;
  }),
  kimi: adapter("kimi", "acp", "acp-json-rpc", true, () => ["acp"]),
  "cursor-agent": adapter("cursor-agent", "stdin", "json-lines", false, ({ model }) => {
    const argv = ["--print", "--output-format", "stream-json", "--stream-partial-output", "--force", "--trust"];
    add(argv, "--model", model);
    return argv;
  }),
  qwen: adapter("qwen", "stdin", "text", false, ({ model }) => {
    const argv = ["--yolo"];
    add(argv, "--model", model);
    argv.push("-");
    return argv;
  }),
  qoder: adapter("qoder", "stdin", "json-lines", false, ({ model }) => {
    const argv = ["-p", "--output-format", "stream-json", "--permission-mode", "bypass_permissions"];
    add(argv, "--model", model);
    return argv;
  }),
  copilot: adapter("copilot", "argv", "json-lines", false, ({ prompt, model, systemPrompt }) => {
    const argv = ["-p", prependSystem(prompt, systemPrompt), "--allow-all-tools", "--output-format", "json"];
    add(argv, "--model", model);
    return argv;
  }),
  pi: adapter("pi", "pi-rpc", "pi-rpc", false, ({ model }) => {
    const argv = ["--mode", "rpc"];
    add(argv, "--model", model);
    return argv;
  }),
  kiro: adapter("kiro", "acp", "acp-json-rpc", true, () => ["acp"]),
  kilo: adapter("kilo", "acp", "acp-json-rpc", true, () => ["acp"]),
  vibe: adapter("vibe", "acp", "acp-json-rpc", true, () => []),
  deepseek: adapter("deepseek", "argv", "text", false, ({ prompt, model, systemPrompt }) => {
    const argv = ["chat", "--no-interactive"];
    add(argv, "--model", model);
    argv.push(prependSystem(prompt, systemPrompt));
    return argv;
  }),
  reasonix: adapter("reasonix", "argv", "text", false, ({ prompt, model, systemPrompt }) => {
    const argv = ["run", "--no-interactive"];
    add(argv, "--model", model);
    argv.push(prependSystem(prompt, systemPrompt));
    return argv;
  }),
  aider: adapter("aider", "file", "text", false, ({ promptFile, model, systemPrompt }) => {
    if (promptFile === undefined) throw new Error("Aider requires a prompt file.");
    const argv = ["--yes", "--no-stream", "--message-file", promptFile];
    add(argv, "--model", model);
    add(argv, "--system-prompt", systemPrompt);
    return argv;
  }),
  devin: adapter("devin", "acp", "acp-json-rpc", true, () => ["--permission-mode", "dangerous", "--respect-workspace-trust", "false", "acp"]),
  trae: adapter("trae", "argv", "text", false, ({ prompt, model, systemPrompt }) => {
    const argv = ["run", "--no-interactive"];
    add(argv, "--model", model);
    argv.push(prependSystem(prompt, systemPrompt));
    return argv;
  })
});

for (const id of CODING_AGENT_IDS) {
  if (AGENT_COMMAND_ADAPTERS[id].id !== id) throw new Error(`Invalid command adapter for ${id}.`);
}

export interface ChildStdinLike {
  write?(data: string): boolean;
  end(data?: string): void;
  destroy?(error?: Error): void;
}

export interface ChildProcessLike {
  readonly stdin: ChildStdinLike | null;
  readonly stdout: AsyncIterable<Uint8Array | string> | null;
  readonly stderr: AsyncIterable<Uint8Array | string> | null;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnAgentProcess = (
  command: string,
  argv: readonly string[],
  options: SpawnOptions
) => ChildProcessLike;

export interface AgentRunnerOptions {
  readonly executable?: string;
  readonly executableCheck?: ExecutableCheck;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly killGraceMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxPromptBytes?: number;
  readonly maxLineBytes?: number;
  readonly allowedCwdRoots?: readonly string[];
  readonly allowedEnvKeys?: readonly string[];
  readonly allowedExtraArgs?: readonly string[];
  readonly spawn?: SpawnAgentProcess;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly tempRoot?: string;
  readonly allowDangerousPermissions?: boolean;
}

const DANGEROUS_PERMISSION_AGENTS = new Set<CodingAgentId>(["gemini", "cursor-agent", "qwen", "qoder", "copilot", "aider", "devin"]);

interface RunPlan {
  readonly command: string;
  readonly argv: readonly string[];
  readonly stdin?: string;
  readonly cleanup?: () => Promise<void>;
  readonly adapter: AgentCommandAdapter;
}

const defaultSpawn: SpawnAgentProcess = (command, argv, options) =>
  nodeSpawn(command, [...argv], options) as ChildProcessLike;

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

function validateExecutable(value: string): void {
  if (value.length === 0 || value.includes("\0")) throw new Error("Agent executable is invalid.");
}

async function resolveAllowedCwd(cwd: string, roots: readonly string[]): Promise<string> {
  const info = await stat(cwd);
  if (!info.isDirectory()) throw new Error(`Agent cwd is not a directory: ${cwd}`);
  const resolvedCwd = await realpath(cwd);
  const resolvedRoots = await Promise.all(roots.map(async (root) => realpath(root)));
  const allowed = resolvedRoots.some((root) => {
    const relative = path.relative(root, resolvedCwd);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  });
  if (!allowed) throw new Error(`Agent cwd is outside the allowed roots: ${resolvedCwd}`);
  return resolvedCwd;
}

function buildEnv(
  requested: Readonly<Record<string, string>> | undefined,
  baseEnv: NodeJS.ProcessEnv,
  allowedKeys: readonly string[],
  agentId: CodingAgentId
): NodeJS.ProcessEnv {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(requested ?? {})) {
    if (!allowed.has(key)) throw new Error(`Agent environment variable is not allowed: ${key}`);
  }
  const env = {} as NodeJS.ProcessEnv;
  const inherited = new Set([...COMMON_INHERITED_ENV, ...(AGENT_INHERITED_ENV[agentId] ?? [])]);
  for (const key of allowed) {
    const value = requested?.[key] ?? (inherited.has(key) ? baseEnv[key] : undefined);
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function validateExtraArgs(extraArgs: readonly string[] | undefined, allowedArgs: readonly string[]): readonly string[] {
  if (extraArgs === undefined) return [];
  const allowed = new Set(allowedArgs);
  for (const value of extraArgs) {
    if (value.includes("\0") || !allowed.has(value)) throw new Error(`Agent extra argument is not allowed: ${value}`);
  }
  return extraArgs;
}

async function createRunPlan(params: AgentRunParams, options: AgentRunnerOptions): Promise<RunPlan> {
  const adapter = AGENT_COMMAND_ADAPTERS[params.agentId];
  const definition = getAgentDefinition(params.agentId);
  if (params.sessionId !== undefined && !adapter.supportsSession) {
    throw new Error(`${definition.displayName} does not support session resume in the runner.`);
  }
  if (DANGEROUS_PERMISSION_AGENTS.has(params.agentId) && options.allowDangerousPermissions !== true) {
    throw new Error(`${definition.displayName} requires explicit allowDangerousPermissions because its headless adapter auto-approves tools or workspace trust.`);
  }
  const maxPromptBytes = options.maxPromptBytes ?? DEFAULT_MAX_PROMPT_BYTES;
  if (!Number.isSafeInteger(maxPromptBytes) || maxPromptBytes <= 0) throw new Error("maxPromptBytes must be a positive integer.");
  if (byteLength(params.prompt) > maxPromptBytes) throw new Error(`Agent prompt exceeds ${maxPromptBytes} bytes.`);

  const pathValue = options.baseEnv?.PATH ?? process.env.PATH;
  const detected = options.executable === undefined
    ? await findExecutableOnPath(definition.executableAliases, {
        ...(pathValue === undefined ? {} : { path: pathValue }),
        ...(options.executableCheck === undefined ? {} : { executableCheck: options.executableCheck })
      })
    : undefined;
  const command = options.executable ?? detected?.executable;
  if (command === undefined) {
    throw new Error(`${definition.displayName} executable was not found on PATH.`);
  }
  validateExecutable(command);
  let promptFile: string | undefined;
  let cleanup: (() => Promise<void>) | undefined;
  if (adapter.promptTransport === "file") {
    const directory = await mkdtemp(path.join(options.tempRoot ?? os.tmpdir(), "vdt-agent-"));
    promptFile = path.join(directory, "prompt.txt");
    await writeFile(promptFile, params.prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });
    cleanup = async () => rm(directory, { recursive: true, force: true });
  }

  try {
    const context: AgentCommandContext = {
      prompt: params.prompt,
      ...(promptFile === undefined ? {} : { promptFile }),
      ...(params.model === undefined ? {} : { model: params.model }),
      ...(params.sessionId === undefined ? {} : { sessionId: params.sessionId }),
      ...(params.systemPrompt === undefined ? {} : { systemPrompt: params.systemPrompt })
    };
    const argv = [
      ...adapter.buildArgv(context),
      ...validateExtraArgs(params.extraArgs, options.allowedExtraArgs ?? [])
    ];
    if (argv.some((value) => value.includes("\0"))) throw new Error("Agent argument contains a NUL byte.");
    return {
      command,
      argv: Object.freeze(argv),
      ...(adapter.promptTransport === "stdin" ? { stdin: params.prompt } : {}),
      ...(cleanup === undefined ? {} : { cleanup }),
      adapter
    };
  } catch (error) {
    await cleanup?.();
    throw error;
  }
}

type InternalEvent =
  | { readonly type: "event"; readonly event: AgentRunEvent }
  | { readonly type: "close"; readonly code: number | null; readonly signal: NodeJS.Signals | null }
  | { readonly type: "spawn-error"; readonly error: Error }
  | { readonly type: "forced-close" };

class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: T) => void> = [];

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }

  next(): Promise<T> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve(value);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(record: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function contentText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((item) => {
      if (typeof item === "string") return item;
      const record = asRecord(item);
      return stringValue(record, "text", "content", "output");
    }).filter((item): item is string => item !== undefined);
    return parts.length > 0 ? parts.join("") : undefined;
  }
  const record = asRecord(value);
  return stringValue(record, "text", "content", "output", "result");
}

function normalizeJson(value: unknown): AgentRunEvent[] {
  const record = asRecord(value);
  if (!record) return [];
  const events: AgentRunEvent[] = [];
  const type = stringValue(record, "type", "event", "kind") ?? "";
  const message = asRecord(record.message) ?? asRecord(record.item);
  const part = asRecord(record.part);
  const sessionId = stringValue(record, "session_id", "sessionId", "thread_id", "conversation_id")
    ?? stringValue(message, "session_id", "sessionId", "thread_id");

  if (type === "thread.started" && sessionId !== undefined) return [];

  const toolRecord = asRecord(record.tool) ?? message;
  const toolName = stringValue(record, "tool_name", "name") ?? stringValue(toolRecord, "tool_name", "name");
  const callId = stringValue(record, "tool_call_id", "call_id", "callId", "id")
    ?? stringValue(toolRecord, "tool_call_id", "call_id", "callId", "id");
  const isToolResult = /tool[_.-]?(result|execution_end)|command\.completed/i.test(type);
  const isToolCall = /tool[_.-]?(use|call|execution_start)|command\.started/i.test(type);
  if (isToolResult && toolName !== undefined) {
    events.push({ type: "tool-result", name: toolName, ...(callId === undefined ? {} : { callId }), output: record.output ?? record.result ?? message });
  } else if (isToolCall && toolName !== undefined) {
    events.push({ type: "tool-call", name: toolName, ...(callId === undefined ? {} : { callId }), input: record.input ?? record.arguments ?? message });
  }

  const blocks = Array.isArray(message?.content) ? message.content : Array.isArray(record.content) ? record.content : [];
  for (const blockValue of blocks) {
    const block = asRecord(blockValue);
    const blockType = stringValue(block, "type") ?? "";
    const blockName = stringValue(block, "name", "tool_name") ?? "tool";
    const blockCallId = stringValue(block, "id", "tool_use_id", "call_id");
    if (/^tool_(use|call)$/.test(blockType)) {
      events.push({ type: "tool-call", name: blockName, ...(blockCallId === undefined ? {} : { callId: blockCallId }), input: block?.input ?? block?.arguments ?? {} });
    } else if (blockType === "tool_result") {
      events.push({ type: "tool-result", name: blockName, ...(blockCallId === undefined ? {} : { callId: blockCallId }), output: block?.content ?? block?.output });
    }
  }

  const itemType = stringValue(message, "type") ?? type;
  if (itemType === "command_execution" && /item\.(started|completed)/.test(type)) {
    const commandId = stringValue(message, "id");
    if (type.endsWith("started")) {
      events.push({ type: "tool-call", name: "command", ...(commandId === undefined ? {} : { callId: commandId }), input: message?.command ?? message });
    } else {
      events.push({ type: "tool-result", name: "command", ...(commandId === undefined ? {} : { callId: commandId }), output: message?.aggregated_output ?? message?.output ?? message });
    }
  }

  const roleValue = stringValue(record, "role") ?? stringValue(message, "role");
  const text = contentText(record.content) ?? contentText(record.text) ?? contentText(record.delta)
    ?? contentText(message?.content) ?? contentText(message?.text)
    ?? contentText(part?.content) ?? contentText(part?.text)
    ?? (/^(result|final|agent_message|message_end)$/i.test(itemType) ? contentText(record.result) : undefined);
  if (text !== undefined) {
    const role: "assistant" | "tool" | "system" = roleValue === "tool" ? "tool" : roleValue === "system" ? "system" : "assistant";
    events.push({ type: "message", role, content: text });
  }
  return events;
}

function sessionIdFromJson(value: unknown): string | undefined {
  const record = asRecord(value);
  const message = asRecord(record?.message) ?? asRecord(record?.item);
  return stringValue(record, "session_id", "sessionId", "thread_id", "conversation_id")
    ?? stringValue(message, "session_id", "sessionId", "thread_id", "conversation_id");
}

class OutputParser {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";
  sessionId: string | undefined;

  constructor(
    private readonly format: AgentStreamFormat,
    private readonly maxLineBytes: number
  ) {}

  feed(chunk: Uint8Array | string): AgentRunEvent[] {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(Buffer.from(chunk));
    if (this.format === "json") {
      if (byteLength(this.buffer) > this.maxLineBytes) throw new Error(`Agent JSON record exceeds ${this.maxLineBytes} bytes.`);
      return [];
    }
    const events: AgentRunEvent[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (byteLength(line) > this.maxLineBytes) throw new Error(`Agent output line exceeds ${this.maxLineBytes} bytes.`);
      events.push(...this.parseLine(line));
      newline = this.buffer.indexOf("\n");
    }
    if (byteLength(this.buffer) > this.maxLineBytes) throw new Error(`Agent output line exceeds ${this.maxLineBytes} bytes.`);
    return events;
  }

  end(): AgentRunEvent[] {
    this.buffer += this.decoder.end();
    if (this.buffer.length === 0) return [];
    if (byteLength(this.buffer) > this.maxLineBytes) throw new Error(`Agent output record exceeds ${this.maxLineBytes} bytes.`);
    const value = this.buffer.replace(/\r$/, "");
    this.buffer = "";
    if (this.format === "json") {
      try {
        const parsed: unknown = JSON.parse(value);
        this.sessionId = sessionIdFromJson(parsed) ?? this.sessionId;
        return normalizeJson(parsed);
      } catch (error) {
        throw new Error(`Invalid JSON agent output: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return this.parseLine(value);
  }

  private parseLine(line: string): AgentRunEvent[] {
    if (line.length === 0) return [];
    if (this.format === "text" || this.format === "unknown") return [{ type: "message", role: "assistant", content: line }];
    try {
      const parsed: unknown = JSON.parse(line);
      this.sessionId = sessionIdFromJson(parsed) ?? this.sessionId;
      return normalizeJson(parsed);
    } catch (error) {
      if (this.format === "text-and-json") return [{ type: "message", role: "assistant", content: line }];
      throw new Error(`Invalid JSONL agent output: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export async function* runAgent(
  params: AgentRunParams,
  options: AgentRunnerOptions = {}
): AsyncIterable<AgentRunEvent> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  for (const [name, value] of [["timeoutMs", timeoutMs], ["killGraceMs", killGraceMs], ["maxOutputBytes", maxOutputBytes], ["maxLineBytes", maxLineBytes]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  }
  if (options.signal?.aborted) {
    yield { type: "error", error: abortError("Agent run was aborted before start.") };
    return;
  }

  const cwd = await resolveAllowedCwd(params.cwd, options.allowedCwdRoots ?? [process.cwd()]);
  const env = buildEnv(params.env, options.baseEnv ?? process.env, options.allowedEnvKeys ?? DEFAULT_ENV_ALLOWLIST, params.agentId);
  if (params.agentId === "gemini") {
    env.GEMINI_CLI_TRUST_WORKSPACE = "true";
  }
  const plan = await createRunPlan(params, options);
  const queue = new AsyncQueue<InternalEvent>();
  let child: ChildProcessLike;
  try {
    child = (options.spawn ?? defaultSpawn)(plan.command, plan.argv, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    await plan.cleanup?.();
    yield { type: "error", error: error instanceof Error ? error : new Error(String(error)) };
    return;
  }

  let stoppingError: Error | undefined;
  let runSessionId = params.sessionId;
  let outputBytes = 0;
  let childHasClosed = false;
  let resolveChildClosed!: () => void;
  const childClosed = new Promise<void>((resolve) => {
    resolveChildClosed = resolve;
  });
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let sentSigterm = false;
  let sentSigkill = false;
  const terminate = (error: Error): void => {
    if (stoppingError !== undefined) return;
    stoppingError = error;
    sentSigterm = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      sentSigkill = true;
      child.kill("SIGKILL");
      forceTimer = setTimeout(() => queue.push({ type: "forced-close" }), killGraceMs);
    }, killGraceMs);
  };

  const onAbort = (): void => terminate(abortError("Agent run was aborted."));
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => terminate(abortError(`Agent run timed out after ${timeoutMs}ms.`)), timeoutMs);

  let streamsDone: Promise<void> = Promise.resolve();
  child.once("error", (error) => queue.push({ type: "spawn-error", error }));
  child.once("close", (code, signal) => {
    childHasClosed = true;
    resolveChildClosed();
    void streamsDone.then(() => queue.push({ type: "close", code, signal }));
  });

  const waitForChildClose = async (): Promise<boolean> => {
    if (childHasClosed) return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), killGraceMs);
      void childClosed.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  };

  const ensureChildClosed = async (): Promise<void> => {
    if (childHasClosed) return;
    if (!sentSigterm) {
      sentSigterm = true;
      child.kill("SIGTERM");
    }
    if (await waitForChildClose()) return;
    if (!sentSigkill) {
      sentSigkill = true;
      child.kill("SIGKILL");
    }
    await waitForChildClose();
  };

  const consume = async (
    source: AsyncIterable<Uint8Array | string> | null,
    stream: "stdout" | "stderr"
  ): Promise<void> => {
    if (!source) return;
    const parser = stream === "stdout" ? new OutputParser(plan.adapter.outputFormat, maxLineBytes) : undefined;
    try {
      for await (const chunk of source) {
        if (stoppingError !== undefined) continue;
        const data = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        outputBytes += byteLength(data);
        if (outputBytes > maxOutputBytes) {
          terminate(new Error(`Agent output exceeds ${maxOutputBytes} bytes.`));
          continue;
        }
        queue.push({ type: "event", event: { type: stream, data } });
        if (parser) {
          for (const event of parser.feed(chunk)) queue.push({ type: "event", event });
          runSessionId = parser.sessionId ?? runSessionId;
        }
      }
      if (parser && stoppingError === undefined) {
        for (const event of parser.end()) queue.push({ type: "event", event });
        runSessionId = parser.sessionId ?? runSessionId;
      }
    } catch (error) {
      terminate(error instanceof Error ? error : new Error(String(error)));
    }
  };

  if (plan.adapter.promptTransport === "acp") {
    const acp = child.stdin !== null && child.stdout !== null
      ? runAcpClient({
          stdin: child.stdin,
          stdout: child.stdout,
          cwd,
          prompt: params.prompt,
          ...(params.systemPrompt === undefined ? {} : { systemPrompt: params.systemPrompt }),
          ...(params.sessionId === undefined ? {} : { sessionId: params.sessionId }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          maxOutputBytes,
          maxLineBytes,
          onRawOutput: (data) => queue.push({ type: "event", event: { type: "stdout", data } }),
          onEvent: (event) => queue.push({ type: "event", event })
        }).then((result) => {
          runSessionId = result.sessionId;
          child.stdin?.end();
        }).catch((error) => terminate(error instanceof Error ? error : new Error(String(error))))
      : Promise.reject(new Error("ACP agent requires piped stdin and stdout."))
        .catch((error) => terminate(error));
    streamsDone = Promise.all([acp, consume(child.stderr, "stderr")]).then(() => undefined);
  } else if (plan.adapter.promptTransport === "pi-rpc") {
    const prompt = params.systemPrompt === undefined
      ? params.prompt
      : `${params.systemPrompt}\n\n${params.prompt}`;
    const pi = child.stdin !== null && child.stdout !== null && typeof child.stdin.write === "function"
      ? (async () => {
          for await (const event of drivePiRpc({
            stdout: child.stdout!,
            prompt,
            write: (line) => {
              if (child.stdin?.write?.(line) === false) {
                throw new Error("Pi RPC stdin backpressure is not supported by this process adapter.");
              }
            },
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            maxOutputBytes,
            maxLineBytes,
            onRawOutput: (data) => queue.push({ type: "event", event: { type: "stdout", data } })
          })) {
            queue.push({ type: "event", event });
          }
          child.stdin?.end();
        })().catch((error) => terminate(error instanceof Error ? error : new Error(String(error))))
      : Promise.reject(new Error("Pi RPC requires piped streaming stdin and stdout."))
        .catch((error) => terminate(error));
    streamsDone = Promise.all([pi, consume(child.stderr, "stderr")]).then(() => undefined);
  } else {
    streamsDone = Promise.all([
      consume(child.stdout, "stdout"),
      consume(child.stderr, "stderr")
    ]).then(() => undefined);
    try {
      child.stdin?.end(plan.stdin);
    } catch (error) {
      terminate(error instanceof Error ? error : new Error(String(error)));
    }
  }

  let done = false;
  let emittedStopError = false;
  try {
    yield { type: "start", agentId: params.agentId, command: plan.command, argv: plan.argv };
    while (!done) {
      const item = await queue.next();
      if (item.type === "event") {
        yield item.event;
      } else if (item.type === "spawn-error") {
        terminate(item.error);
      } else {
        done = true;
        if (stoppingError !== undefined && !emittedStopError) {
          emittedStopError = true;
          yield { type: "error", error: stoppingError };
        } else if (item.type === "forced-close") {
          yield { type: "error", error: new Error("Agent did not exit after SIGKILL.") };
        } else {
          const exitCode = item.code ?? (item.signal === null ? 1 : 128);
          if (exitCode !== 0) yield { type: "error", error: new Error(`Agent exited with code ${exitCode}${item.signal ? ` (${item.signal})` : ""}.`) };
          yield { type: "complete", exitCode, ...(runSessionId === undefined ? {} : { sessionId: runSessionId }) };
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    if (killTimer !== undefined) clearTimeout(killTimer);
    if (forceTimer !== undefined) clearTimeout(forceTimer);
    options.signal?.removeEventListener("abort", onAbort);
    if (!done) await ensureChildClosed();
    await plan.cleanup?.();
  }
}
