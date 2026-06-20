import { StringDecoder } from "node:string_decoder";
import type { AgentRunEvent } from "./agent-runtime";
import type { ChildStdinLike } from "./agent-runner";

const ACP_PROTOCOL_VERSION = 1;

interface JsonRpcMessage {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

export interface AcpClientOptions {
  readonly stdin: ChildStdinLike;
  readonly stdout: AsyncIterable<Uint8Array | string>;
  readonly cwd: string;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
  readonly maxOutputBytes: number;
  readonly maxLineBytes: number;
  readonly onEvent: (event: AgentRunEvent) => void;
  readonly onRawOutput?: (data: string) => void;
}

export interface AcpClientResult {
  readonly sessionId: string;
  readonly stopReason: AcpStopReason;
}

export const ACP_STOP_REASONS = [
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled"
] as const;

export type AcpStopReason = (typeof ACP_STOP_REASONS)[number];

const acpStopReasons = new Set<string>(ACP_STOP_REASONS);

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textContent(value: unknown): string | undefined {
  const content = asRecord(value);
  return content?.type === "text" && typeof content.text === "string" ? content.text : undefined;
}

function rpcError(message: JsonRpcMessage): Error {
  const error = asRecord(message.error);
  const code = typeof error?.code === "number" ? ` (${error.code})` : "";
  const detail = typeof error?.message === "string" ? error.message : "Unknown JSON-RPC error";
  return new Error(`ACP request failed${code}: ${detail}`);
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

class JsonLineReader {
  private readonly decoder = new StringDecoder("utf8");
  private readonly iterator: AsyncIterator<Uint8Array | string>;
  private buffer = "";
  private outputBytes = 0;

  constructor(
    source: AsyncIterable<Uint8Array | string>,
    private readonly maxOutputBytes: number,
    private readonly maxLineBytes: number,
    private readonly onRawOutput?: (data: string) => void
  ) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  async next(): Promise<JsonRpcMessage> {
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline >= 0) {
        const line = this.buffer.slice(0, newline).replace(/\r$/, "");
        this.buffer = this.buffer.slice(newline + 1);
        if (byteLength(line) > this.maxLineBytes) throw new Error(`ACP output line exceeds ${this.maxLineBytes} bytes.`);
        if (line.length === 0) continue;
        return this.parse(line);
      }
      if (byteLength(this.buffer) > this.maxLineBytes) throw new Error(`ACP output line exceeds ${this.maxLineBytes} bytes.`);

      const item = await this.iterator.next();
      if (item.done) {
        this.buffer += this.decoder.end();
        if (this.buffer.length === 0) throw new Error("ACP agent closed stdout before completing the request.");
        if (byteLength(this.buffer) > this.maxLineBytes) throw new Error(`ACP output line exceeds ${this.maxLineBytes} bytes.`);
        const line = this.buffer.replace(/\r$/, "");
        this.buffer = "";
        return this.parse(line);
      }
      const data = typeof item.value === "string" ? item.value : this.decoder.write(Buffer.from(item.value));
      this.outputBytes += byteLength(data);
      if (this.outputBytes > this.maxOutputBytes) throw new Error(`ACP output exceeds ${this.maxOutputBytes} bytes.`);
      this.onRawOutput?.(data);
      this.buffer += data;
    }
  }

  private parse(line: string): JsonRpcMessage {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid ACP JSONL: ${error instanceof Error ? error.message : String(error)}`);
    }
    const record = asRecord(value);
    if (record?.jsonrpc !== "2.0") throw new Error("Invalid ACP JSON-RPC message: jsonrpc must be 2.0.");
    return record as unknown as JsonRpcMessage;
  }
}

function mapSessionUpdate(params: unknown): AgentRunEvent[] {
  const update = asRecord(asRecord(params)?.update);
  if (!update || typeof update.sessionUpdate !== "string") return [];
  const kind = update.sessionUpdate;
  const text = textContent(update.content);
  if (kind === "agent_message_chunk" && text !== undefined) {
    return [{ type: "message", role: "assistant", content: text }];
  }
  if (kind === "thought_message_chunk" && text !== undefined) {
    return [{ type: "message", role: "system", content: text }];
  }
  if (kind === "tool_call") {
    const callId = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
    const name = typeof update.title === "string" ? update.title : typeof update.kind === "string" ? update.kind : "tool";
    return [{ type: "tool-call", name, ...(callId === undefined ? {} : { callId }), input: update }];
  }
  if (kind === "tool_call_update") {
    const callId = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
    const name = typeof update.title === "string" ? update.title : typeof update.kind === "string" ? update.kind : "tool";
    const terminal = update.status === "completed" || update.status === "failed";
    return terminal
      ? [{ type: "tool-result", name, ...(callId === undefined ? {} : { callId }), output: update }]
      : [{ type: "tool-call", name, ...(callId === undefined ? {} : { callId }), input: update }];
  }
  return [];
}

export async function runAcpClient(options: AcpClientOptions): Promise<AcpClientResult> {
  if (typeof options.stdin.write !== "function") throw new Error("ACP agent stdin does not support streaming writes.");
  const reader = new JsonLineReader(
    options.stdout,
    options.maxOutputBytes,
    options.maxLineBytes,
    options.onRawOutput
  );
  let nextId = 0;
  let activeSessionId: string | undefined;

  const send = (message: JsonRpcMessage): void => {
    const line = `${JSON.stringify(message)}\n`;
    const accepted = options.stdin.write?.(line);
    if (accepted === false) throw new Error("ACP agent stdin backpressure is not supported by this process adapter.");
  };

  const respondToAgentRequest = (message: JsonRpcMessage): void => {
    if (message.id === undefined || message.id === null || message.method === undefined) return;
    if (message.method === "session/request_permission") {
      send({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "cancelled" } } });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Client method is not supported: ${message.method}` }
    });
  };

  const request = async (method: string, params: unknown): Promise<unknown> => {
    const id = nextId++;
    send({ jsonrpc: "2.0", id, method, params });
    while (true) {
      const message = await reader.next();
      if (message.method === "session/update") {
        for (const event of mapSessionUpdate(message.params)) options.onEvent(event);
        continue;
      }
      if (message.method !== undefined) {
        respondToAgentRequest(message);
        continue;
      }
      if (message.id !== id) {
        if (message.id !== undefined && message.id !== null) {
          throw new Error(`Unexpected ACP response id: ${String(message.id)}.`);
        }
        continue;
      }
      if (message.error !== undefined) throw rpcError(message);
      return message.result;
    }
  };

  const onAbort = (): void => {
    if (activeSessionId !== undefined) {
      try {
        send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: activeSessionId } });
      } catch {
        // The process runner owns termination and reports the primary abort error.
      }
    }
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (options.signal?.aborted) throw abortError("ACP run was aborted before initialization.");
    const initialize = asRecord(await request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "vdt-studio", title: "VDT Studio", version: "0.1.0" }
    }));
    if (initialize?.protocolVersion !== ACP_PROTOCOL_VERSION) {
      throw new Error(`ACP protocol version mismatch: expected ${ACP_PROTOCOL_VERSION}, received ${String(initialize?.protocolVersion)}.`);
    }
    const capabilities = asRecord(initialize.agentCapabilities);

    if (options.sessionId !== undefined) {
      if (capabilities?.loadSession !== true) throw new Error("ACP agent does not advertise session/load support.");
      activeSessionId = options.sessionId;
      await request("session/load", { sessionId: activeSessionId, cwd: options.cwd, mcpServers: [] });
    } else {
      const created = asRecord(await request("session/new", { cwd: options.cwd, mcpServers: [] }));
      if (typeof created?.sessionId !== "string" || created.sessionId.length === 0) {
        throw new Error("ACP session/new response is missing sessionId.");
      }
      activeSessionId = created.sessionId;
    }

    if (options.signal?.aborted) {
      onAbort();
      throw abortError("ACP run was aborted before prompting.");
    }
    const prompt = options.systemPrompt === undefined
      ? options.prompt
      : `${options.systemPrompt}\n\n${options.prompt}`;
    const promptResult = asRecord(await request("session/prompt", {
      sessionId: activeSessionId,
      prompt: [{ type: "text", text: prompt }]
    }));
    if (typeof promptResult?.stopReason !== "string" || !acpStopReasons.has(promptResult.stopReason)) {
      throw new Error(`ACP session/prompt response has invalid stopReason: ${String(promptResult?.stopReason)}.`);
    }
    return {
      sessionId: activeSessionId,
      stopReason: promptResult.stopReason as AcpStopReason
    };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}
