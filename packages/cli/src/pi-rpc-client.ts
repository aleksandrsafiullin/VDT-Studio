import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { AgentRunEvent } from "./agent-runtime";

export const DEFAULT_PI_RPC_MAX_LINE_BYTES = 1024 * 1024;
export const DEFAULT_PI_RPC_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface PiRpcDecoderOptions {
  readonly promptId?: string;
  readonly maxLineBytes?: number;
  readonly maxOutputBytes?: number;
}

export interface PiRpcDecodeResult {
  readonly events: readonly AgentRunEvent[];
  readonly commands: readonly string[];
  readonly agentEnded: boolean;
}

export interface PiRpcDriverOptions extends PiRpcDecoderOptions {
  readonly stdout: AsyncIterable<Uint8Array | string>;
  readonly prompt: string;
  readonly write: (jsonLine: string) => unknown;
  readonly signal?: AbortSignal;
  readonly onRawOutput?: (data: string) => void;
}

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
const FIRE_AND_FORGET_METHODS = new Set(["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]);

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function contentText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const parts = value.flatMap((item) => {
    if (typeof item === "string") return [item];
    const record = asRecord(item);
    const text = nonEmptyString(record?.text) ?? nonEmptyString(record?.content);
    return text === undefined ? [] : [text];
  });
  return parts.length === 0 ? undefined : parts.join("");
}

function jsonLine(command: Record<string, unknown>): string {
  return `${JSON.stringify(command)}\n`;
}

export function createPiRpcPromptCommand(message: string, id: string = randomUUID()): string {
  if (id.length === 0) throw new Error("Pi RPC prompt id must not be empty.");
  return jsonLine({ id, type: "prompt", message });
}

export function createPiRpcAbortCommand(): string {
  return jsonLine({ type: "abort" });
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export class PiRpcJsonlDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private readonly maxLineBytes: number;
  private readonly maxOutputBytes: number;
  private buffer = "";
  private outputBytes = 0;
  private assistantMessageStreamed = false;
  private ended = false;
  private accepted = false;

  constructor(private readonly options: PiRpcDecoderOptions = {}) {
    this.maxLineBytes = positiveLimit(options.maxLineBytes ?? DEFAULT_PI_RPC_MAX_LINE_BYTES, "maxLineBytes");
    this.maxOutputBytes = positiveLimit(options.maxOutputBytes ?? DEFAULT_PI_RPC_MAX_OUTPUT_BYTES, "maxOutputBytes");
  }

  get agentEnded(): boolean {
    return this.ended;
  }

  get promptAccepted(): boolean {
    return this.accepted;
  }

  feed(chunk: Uint8Array | string): PiRpcDecodeResult {
    if (this.ended) return { events: [], commands: [], agentEnded: true };
    const chunkBytes = typeof chunk === "string" ? byteLength(chunk) : chunk.byteLength;
    this.outputBytes += chunkBytes;
    if (this.outputBytes > this.maxOutputBytes) {
      throw new Error(`Pi RPC output exceeds ${this.maxOutputBytes} bytes.`);
    }
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(Buffer.from(chunk));
    return this.drain(false);
  }

  end(): PiRpcDecodeResult {
    if (this.ended) return { events: [], commands: [], agentEnded: true };
    this.buffer += this.decoder.end();
    return this.drain(true);
  }

  private drain(flush: boolean): PiRpcDecodeResult {
    const events: AgentRunEvent[] = [];
    const commands: string[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0 && !this.ended) {
      const rawLine = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.parseLine(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine, events, commands);
      newline = this.buffer.indexOf("\n");
    }
    if (flush && !this.ended && this.buffer.length > 0) {
      const rawLine = this.buffer;
      this.buffer = "";
      this.parseLine(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine, events, commands);
    }
    if (!this.ended && byteLength(this.buffer) > this.maxLineBytes) {
      throw new Error(`Pi RPC line exceeds ${this.maxLineBytes} bytes.`);
    }
    return { events, commands, agentEnded: this.ended };
  }

  private parseLine(line: string, events: AgentRunEvent[], commands: string[]): void {
    if (byteLength(line) > this.maxLineBytes) throw new Error(`Pi RPC line exceeds ${this.maxLineBytes} bytes.`);
    if (line.length === 0) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid Pi RPC JSONL: ${error instanceof Error ? error.message : String(error)}`);
    }
    const record = asRecord(value);
    if (!record) throw new Error("Invalid Pi RPC record: expected a JSON object.");
    const type = nonEmptyString(record.type);
    if (type === undefined) throw new Error("Invalid Pi RPC record: missing type.");

    if (type === "response") {
      if (record.success !== true) {
        throw new Error(`Pi RPC ${nonEmptyString(record.command) ?? "command"} failed: ${nonEmptyString(record.error) ?? "unknown error"}`);
      }
      if (record.command === "prompt") {
        if (this.options.promptId !== undefined && record.id !== this.options.promptId) {
          throw new Error("Pi RPC prompt response id does not match the request id.");
        }
        this.accepted = true;
      }
      return;
    }
    if (type === "extension_ui_request") {
      const id = nonEmptyString(record.id);
      const method = nonEmptyString(record.method);
      if (id === undefined || method === undefined) throw new Error("Invalid Pi RPC extension UI request.");
      if (DIALOG_METHODS.has(method) || !FIRE_AND_FORGET_METHODS.has(method)) {
        commands.push(jsonLine({ type: "extension_ui_response", id, cancelled: true }));
      }
      return;
    }
    if (type === "agent_end") {
      if (this.options.promptId !== undefined && !this.accepted) {
        throw new Error("Pi RPC agent ended before acknowledging the prompt.");
      }
      this.ended = true;
      return;
    }
    if (type === "message_start") {
      const message = asRecord(record.message);
      if (message?.role === "assistant") this.assistantMessageStreamed = false;
      return;
    }
    if (type === "message_update") {
      const update = asRecord(record.assistantMessageEvent);
      if (update?.type === "text_delta" && typeof update.delta === "string" && update.delta.length > 0) {
        this.assistantMessageStreamed = true;
        events.push({ type: "message", role: "assistant", content: update.delta });
      } else if (update?.type === "error") {
        events.push({ type: "error", error: new Error(nonEmptyString(update.errorMessage) ?? nonEmptyString(update.error) ?? "Pi assistant stream failed.") });
      }
      return;
    }
    if (type === "message_end") {
      const message = asRecord(record.message);
      const role = message?.role;
      const text = contentText(message?.content);
      if (text !== undefined && role === "assistant" && !this.assistantMessageStreamed) {
        events.push({ type: "message", role: "assistant", content: text });
      } else if (text !== undefined && (role === "tool" || role === "toolResult")) {
        events.push({ type: "message", role: "tool", content: text });
      }
      return;
    }
    if (type === "tool_execution_start") {
      const name = nonEmptyString(record.toolName);
      if (name === undefined) throw new Error("Invalid Pi RPC tool start: missing toolName.");
      const callId = nonEmptyString(record.toolCallId);
      events.push({ type: "tool-call", name, ...(callId === undefined ? {} : { callId }), input: record.args ?? {} });
      return;
    }
    if (type === "tool_execution_end") {
      const name = nonEmptyString(record.toolName);
      if (name === undefined) throw new Error("Invalid Pi RPC tool end: missing toolName.");
      const callId = nonEmptyString(record.toolCallId);
      events.push({ type: "tool-result", name, ...(callId === undefined ? {} : { callId }), output: record.result });
      return;
    }
    if (type === "extension_error") {
      events.push({ type: "error", error: new Error(`Pi extension failed: ${nonEmptyString(record.error) ?? "unknown error"}`) });
    } else if (type === "auto_retry_end" && record.success === false) {
      events.push({ type: "error", error: new Error(nonEmptyString(record.finalError) ?? "Pi automatic retry failed.") });
    }
  }
}

export async function* drivePiRpc(options: PiRpcDriverOptions): AsyncIterable<AgentRunEvent> {
  const promptId = options.promptId ?? randomUUID();
  if (options.signal?.aborted) throw abortError("Pi RPC run was aborted before start.");
  const decoder = new PiRpcJsonlDecoder({
    promptId,
    ...(options.maxLineBytes === undefined ? {} : { maxLineBytes: options.maxLineBytes }),
    ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes })
  });
  let abortWriteError: Error | undefined;
  let abortSent = false;
  const onAbort = (): void => {
    if (abortSent) return;
    abortSent = true;
    try {
      options.write(createPiRpcAbortCommand());
    } catch (error) {
      abortWriteError = error instanceof Error ? error : new Error(String(error));
    }
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    options.write(createPiRpcPromptCommand(options.prompt, promptId));
    for await (const chunk of options.stdout) {
      if (abortWriteError !== undefined) throw abortWriteError;
      options.onRawOutput?.(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      const result = decoder.feed(chunk);
      for (const command of result.commands) options.write(command);
      for (const event of result.events) yield event;
      if (result.agentEnded) return;
    }
    const result = decoder.end();
    for (const command of result.commands) options.write(command);
    for (const event of result.events) yield event;
    if (!result.agentEnded) throw new Error("Pi RPC stdout ended before agent_end.");
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}
