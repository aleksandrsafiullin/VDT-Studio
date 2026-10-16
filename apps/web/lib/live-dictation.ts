import { SPEECH_SAMPLE_RATE } from "@vdt-studio/local-runner/speech-catalog";
import { pcmWave } from "@vdt-studio/local-runner/speech-audio";
export { pcmWave };

export function audioBase64(samples: Float32Array): string {
  const bytes = pcmWave(samples);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}

/** Stateful resampling preserves fractional positions across worklet messages. */
export class PcmResampler {
  #position = 0;
  #previous = 0;
  constructor(readonly inputRate: number) {}
  push(input: Float32Array): Float32Array {
    if (this.inputRate === SPEECH_SAMPLE_RATE) return input;
    const step = this.inputRate / SPEECH_SAMPLE_RATE;
    const output: number[] = [];
    while (this.#position < input.length - 1) {
      const index = Math.floor(this.#position);
      const fraction = this.#position - index;
      const left = index < 0 ? this.#previous : input[index] ?? 0;
      const right = input[index + 1] ?? left;
      output.push(left + (right - left) * fraction);
      this.#position += step;
    }
    this.#position -= input.length;
    this.#previous = input[input.length - 1] ?? this.#previous;
    return Float32Array.from(output);
  }
}

interface Fragment { segment: number; audio: Float32Array; final: boolean }

/** Incremental snapshots revise only the current phrase; final phrases are never dropped. */
export class LiveDictationSession {
  #chunks: Float32Array[] = [];
  #samples = 0;
  #lastSnapshot = 0;
  #silence = 0;
  #hasVoice = false;
  #segment = 0;
  #text = new Map<number, string>();
  #queue: Fragment[] = [];
  #busy = false;
  #closed = false;
  #cancelled = false;
  #controller = new AbortController();
  #done: (() => void) | undefined;

  constructor(
    private readonly recognize: (audio: Float32Array, signal: AbortSignal) => Promise<string>,
    private readonly onText: (text: string) => void,
    private readonly onError: (error: Error) => void
  ) {}

  push(samples: Float32Array): void {
    if (this.#closed || this.#cancelled || !samples.length) return;
    const power = samples.reduce((sum, value) => sum + value * value, 0) / samples.length;
    const voice = Math.sqrt(power) > 0.006;
    if (!voice && !this.#hasVoice) {
      this.#chunks = [samples.slice(-Math.min(samples.length, 3200))];
      this.#samples = this.#chunks[0]!.length;
      return;
    }
    this.#hasVoice ||= voice;
    this.#silence = voice ? 0 : this.#silence + samples.length;
    this.#chunks.push(samples);
    this.#samples += samples.length;
    const final = this.#samples >= SPEECH_SAMPLE_RATE * 10 || (this.#silence >= SPEECH_SAMPLE_RATE * 0.65 && this.#samples >= SPEECH_SAMPLE_RATE * 0.8);
    if (final || this.#samples - this.#lastSnapshot >= SPEECH_SAMPLE_RATE * 1.6) this.snapshot(final);
  }

  finish(): Promise<void> {
    if (this.#cancelled) return Promise.resolve();
    this.#closed = true;
    if (this.#hasVoice) this.snapshot(true);
    if (!this.#busy && !this.#queue.length) return Promise.resolve();
    return new Promise((resolve) => { this.#done = resolve; });
  }

  cancel(): void {
    this.#cancelled = true;
    this.#closed = true;
    this.#controller.abort();
    this.#queue = [];
    this.#chunks = [];
    this.#done?.();
  }

  private snapshot(final: boolean): void {
    const audio = new Float32Array(this.#samples);
    let offset = 0;
    for (const chunk of this.#chunks) { audio.set(chunk, offset); offset += chunk.length; }
    // A slower CPU keeps the latest provisional snapshot, not a growing stale backlog.
    this.#queue = this.#queue.filter((entry) => entry.segment !== this.#segment || entry.final);
    this.#queue.push({ segment: this.#segment, audio, final });
    this.#lastSnapshot = this.#samples;
    if (final) {
      this.#segment++;
      this.#chunks = [];
      this.#samples = 0;
      this.#lastSnapshot = 0;
      this.#silence = 0;
      this.#hasVoice = false;
    }
    if (this.#queue.length > 6) {
      this.cancel();
      this.onError(new Error("Recognition cannot keep up. Stop and choose a smaller speech model."));
      return;
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.#busy || this.#cancelled) return;
    this.#busy = true;
    try {
      while (this.#queue.length && !this.#cancelled) {
        const fragment = this.#queue.shift()!;
        const text = await this.recognize(fragment.audio, this.#controller.signal);
        if (this.#cancelled) return;
        if (text.trim()) this.#text.set(fragment.segment, text.trim());
        this.onText([...this.#text.entries()].sort(([a], [b]) => a - b).map(([, value]) => value).join(" "));
      }
    } catch (error) {
      if (!this.#cancelled) {
        this.cancel();
        this.onError(error instanceof Error ? error : new Error("Voice recognition failed."));
      }
    } finally {
      this.#busy = false;
      if (!this.#queue.length) this.#done?.();
    }
  }
}

export function insertDictation(draft: string, start: number, end: number, text: string): string {
  if (!text) return draft;
  const before = draft.slice(0, start);
  const after = draft.slice(end);
  return before + (before && !/\s$/.test(before) ? " " : "") + text + (after && !/^[\s.,!?;:)]/.test(after) ? " " : "") + after;
}

export interface MicrophoneCapture { stop: () => Promise<void> }

export async function captureMicrophone(onSamples: (samples: Float32Array) => void, signal: AbortSignal, onEnded: () => void): Promise<MicrophoneCapture> {
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioContext) throw new Error("Microphone access requires a supported browser on localhost or VDT Studio Desktop.");
  signal.throwIfAborted();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  let context: AudioContext | undefined;
  let processor: AudioWorkletNode | undefined;
  let stopped: Promise<void> | undefined;
  let flushed: (() => void) | undefined;
  const stop = () => stopped ??= (async () => {
    if (processor && context?.state === "running") {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 100);
        flushed = () => { clearTimeout(timer); resolve(); };
        processor!.port.postMessage("flush");
      });
    }
    for (const track of stream.getTracks()) { track.onended = null; track.stop(); }
    if (processor) { processor.port.onmessage = null; processor.disconnect(); }
    if (context && context.state !== "closed") await context.close();
  })();
  if (signal.aborted) { await stop(); signal.throwIfAborted(); }
  try {
    context = new AudioContext();
    await context.audioWorklet.addModule("/speech/pcm-worklet.js");
    if (signal.aborted) { await stop(); signal.throwIfAborted(); }
    const source = context.createMediaStreamSource(stream);
    const resampler = new PcmResampler(context.sampleRate);
    processor = new AudioWorkletNode(context, "vdt-speech-pcm");
    processor.port.onmessage = (event: MessageEvent<Float32Array | string>) => {
      if (event.data === "flushed") { flushed?.(); return; }
      if (!signal.aborted && event.data instanceof Float32Array) onSamples(resampler.push(event.data));
    };
    for (const track of stream.getAudioTracks()) track.onended = onEnded;
    source.connect(processor);
    processor.connect(context.destination); // Worklet outputs silence, never microphone playback.
    await context.resume();
    return { stop };
  } catch (error) { await stop(); throw error; }
}
