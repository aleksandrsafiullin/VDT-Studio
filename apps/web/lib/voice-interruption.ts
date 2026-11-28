const INTERRUPT_CAPTURE_LIMIT_MS = 8_000;
const INTERRUPT_CLEANUP_LIMIT_MS = 2_000;

export type VoiceInterruptionMode = "off" | "interrupt_only";
type DetectorCleanup = "closed" | "cleanup_unconfirmed";

/** A future local detector supplies only an activity signal. Its promise
 * confirms whether all detector resources closed, including after abort. */
export type LocalInterruptDetector = (
  signal: AbortSignal,
  onNearEndSpeech: () => void
) => Promise<DetectorCleanup>;

interface VoiceLease {
  readonly signal: AbortSignal;
  /** Acknowledge only once the owner has closed the media resources. */
  finish(): void;
}

interface DetectorLease {
  readonly signal: AbortSignal;
  readonly closed: Promise<DetectorCleanup>;
  cancel(): void;
}

interface OwnedVoiceLease {
  scopeId: string;
  controller: AbortController;
  lease: VoiceLease;
}

/** An isolated experiment in ownership and cleanup. The existing voice path
 * remains half-duplex. The detector never receives a recognizer, transcript
 * callback, approval or analytical-run controller. */
export class VoiceInterruptionGate {
  #scopeId: string;
  #mode: VoiceInterruptionMode = "off";
  #playback: OwnedVoiceLease | undefined;
  #answer: OwnedVoiceLease | undefined;
  #detector: AbortController | undefined;
  #disposed = false;

  constructor(scopeId: string) {
    this.#scopeId = scopeId;
  }

  setMode(mode: VoiceInterruptionMode): void {
    if (this.#disposed) return;
    this.#mode = mode;
    if (mode === "off") this.#detector?.abort();
  }

  switchScope(scopeId: string): void {
    if (this.#disposed || this.#scopeId === scopeId) return;
    this.#scopeId = scopeId;
    this.#mode = "off";
    this.#stopAll();
  }

  beginPlayback(scopeId: string): VoiceLease | undefined {
    if (!this.#canStart(scopeId)) return;
    const owner = this.#newLease(scopeId, () => {
      if (this.#playback !== owner) return;
      this.#detector?.abort();
      this.#playback = undefined;
    });
    this.#playback = owner;
    return owner.lease;
  }

  beginAnswerCapture(scopeId: string): VoiceLease | undefined {
    if (!this.#canStart(scopeId)) return;
    const owner = this.#newLease(scopeId, () => {
      if (this.#answer === owner) this.#answer = undefined;
    });
    this.#answer = owner;
    return owner.lease;
  }

  beginDetection(scopeId: string, playbackLease: VoiceLease, detect: LocalInterruptDetector): DetectorLease | undefined {
    const playback = this.#playback;
    if (this.#disposed || this.#mode !== "interrupt_only" || this.#detector || this.#answer
      || scopeId !== this.#scopeId || playback?.scopeId !== scopeId || playback.lease !== playbackLease
      || playback.controller.signal.aborted) return;

    const controller = new AbortController();
    this.#detector = controller;
    const abort = () => controller.abort();
    const deadline = setTimeout(abort, INTERRUPT_CAPTURE_LIMIT_MS);
    const interrupt = () => {
      if (controller.signal.aborted || this.#detector !== controller || this.#playback !== playback
        || this.#scopeId !== scopeId || this.#mode !== "interrupt_only") return;
      controller.abort();
      playback.controller.abort();
    };
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let startCleanupTimer!: () => void;
    const cleanupLimit = new Promise<DetectorCleanup>(resolve => {
      startCleanupTimer = () => {
        cleanupTimer = setTimeout(() => resolve("cleanup_unconfirmed"), INTERRUPT_CLEANUP_LIMIT_MS);
      };
      controller.signal.addEventListener("abort", startCleanupTimer, { once: true });
    });
    const detectorClosed = this.#runDetector(controller, detect, interrupt).then(result => {
      // Keep ownership quarantined on timeout. A later acknowledgment can
      // release only this exact detector, without reviving its callbacks.
      if (result === "closed" && this.#detector === controller) this.#detector = undefined;
      return result;
    });
    const closed = Promise.race([detectorClosed, cleanupLimit]).finally(() => {
      clearTimeout(deadline);
      clearTimeout(cleanupTimer);
      controller.signal.removeEventListener("abort", startCleanupTimer);
    });
    return { signal: controller.signal, closed, cancel: abort };
  }

  dispose(): void {
    this.#disposed = true;
    this.#stopAll();
  }

  #canStart(scopeId: string): boolean {
    return !this.#disposed && scopeId === this.#scopeId && !this.#playback && !this.#answer && !this.#detector;
  }

  #newLease(scopeId: string, finish: () => void): OwnedVoiceLease {
    const controller = new AbortController();
    return { scopeId, controller, lease: { signal: controller.signal, finish } };
  }

  #stopAll(): void {
    const detector = this.#detector;
    const playback = this.#playback;
    const answer = this.#answer;
    detector?.abort();
    playback?.controller.abort();
    answer?.controller.abort();
  }

  async #runDetector(controller: AbortController, detect: LocalInterruptDetector, interrupt: () => void): Promise<DetectorCleanup> {
    // Reserve the detector before invoking the adapter. A synchronous abort
    // before invocation means no device lease was opened.
    await Promise.resolve();
    if (controller.signal.aborted) return "closed";
    try {
      if (await detect(controller.signal, interrupt) === "closed") return "closed";
    } catch { /* Keep answer capture blocked when cleanup is unconfirmed. */ }
    controller.abort();
    return "cleanup_unconfirmed";
  }
}
