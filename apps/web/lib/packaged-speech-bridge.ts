import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import { SpeechError } from "@vdt-studio/local-runner/speech";
import type { SpeechRequest, SpeechResponse } from "@vdt-studio/local-runner/speech-catalog";

type BridgeOperation = "open_session" | "keep_session" | "transcribe" | "result" | "cancel" | "close_session";
export type BridgeRequest = Extract<SpeechRequest, { operation: BridgeOperation }>;

export function isPackagedCaptureRequest(request: SpeechRequest): request is BridgeRequest {
  return ["open_session", "keep_session", "transcribe", "result", "cancel", "close_session"].includes(request.operation);
}

const socketKey = Symbol.for("vdt-studio.packaged-speech.socket.v1");
const bridgeKey = Symbol.for("vdt-studio.packaged-speech.client.v1");
const MAX_REQUEST_BYTES = 551_024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_PENDING = 8;
const REQUEST_TIMEOUT_MS = 30_000;
const unavailable = () => new SpeechError("The private speech bridge is unavailable.", 503);

type Pending = { resolve: (value: SpeechResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/** The packaged launcher supplies this socket before handling WebView requests.
 * Browser input cannot supply a descriptor, pipe path or bridge operation. */
export function getPackagedSpeechBridge(): PackagedSpeechBridge | undefined {
  const host = globalThis as typeof globalThis & { [socketKey]?: Socket; [bridgeKey]?: PackagedSpeechBridge };
  const socket = host[socketKey];
  if (!(socket instanceof Socket) || socket.destroyed) return;
  return host[bridgeKey] ??= new PackagedSpeechBridge(socket);
}

export class PackagedSpeechBridge {
  private readonly pending = new Map<string, Pending>();
  private readonly failure = new AbortController();
  private buffer = Buffer.alloc(0);

  constructor(private readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => this.receive(chunk));
    socket.on("error", () => this.stop());
    socket.on("end", () => this.stop());
    socket.on("close", () => this.stop());
  }

  get signal(): AbortSignal { return this.failure.signal; }

  request(speech: BridgeRequest): Promise<SpeechResponse> {
    if (this.signal.aborted || this.socket.destroyed) return Promise.reject(unavailable());
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new SpeechError("The private speech bridge is busy.", 409));
    const id = randomUUID();
    const frame = Buffer.from(`${JSON.stringify({ id, speech })}\n`);
    if (frame.length > MAX_REQUEST_BYTES) return Promise.reject(new SpeechError("Audio fragment is too large.", 413));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop(), REQUEST_TIMEOUT_MS);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(frame, error => { if (error) this.stop(); });
    });
  }

  private receive(chunk: Buffer) {
    if (this.signal.aborted) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let newline: number;
    while ((newline = this.buffer.indexOf(10)) >= 0) {
      if (newline >= MAX_RESPONSE_BYTES) { this.stop(); return; }
      const raw = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      try {
        const frame: unknown = JSON.parse(raw.toString("utf8"));
        if (!frame || typeof frame !== "object" || !("id" in frame) || typeof frame.id !== "string" || !("ok" in frame)) {
          this.stop(); return;
        }
        const pending = this.pending.get(frame.id);
        if (!pending) { this.stop(); return; }
        if (frame.ok === true && "speech" in frame && frame.speech && typeof frame.speech === "object") {
          this.pending.delete(frame.id);
          clearTimeout(pending.timer);
          pending.resolve(frame.speech as SpeechResponse);
        } else if (frame.ok === false && "error" in frame && typeof frame.error === "string") {
          this.pending.delete(frame.id);
          clearTimeout(pending.timer);
          pending.reject(new SpeechError(frame.error, 409));
        } else { this.stop(); return; }
      } catch { this.stop(); return; }
    }
    if (this.buffer.length >= MAX_RESPONSE_BYTES) this.stop();
  }

  private stop() {
    if (this.signal.aborted) return;
    this.failure.abort();
    this.socket.destroy();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(unavailable());
    }
    this.pending.clear();
    this.buffer = Buffer.alloc(0);
  }
}
