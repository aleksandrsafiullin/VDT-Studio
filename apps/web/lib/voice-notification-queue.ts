import { projectVoiceEvent, type VoiceNotification, type VoiceRunEvent } from "./voice-notifications";

export interface VoiceSynthesis {
  /** This adapter owns an explicit host-granted local synthesis session. */
  speak(notification: VoiceNotification, signal: AbortSignal): Promise<void>;
}

export type VoicePlayback = "idle" | "speaking" | "error";

/** The two formats use independent sequence spaces for Supervisor projections.
 * Both cursors recover monotonically; receipt identities deduplicate mirrors. */
export class VoiceEventFeed {
  private canonicalSeq = 0;
  private publicSeq = 0;

  constructor(private readonly runId: string, private readonly activationTime: number, history: readonly VoiceRunEvent[] = []) {
    for (const event of history) if (event.runId === runId && !("schemaVersion" in event)) this.publicSeq = Math.max(this.publicSeq, event.seq);
  }

  take(events: readonly VoiceRunEvent[], locale: string): VoiceNotification[] {
    const result: VoiceNotification[] = [];
    const accepted = events.filter(event => event.runId === this.runId && Number.isSafeInteger(event.seq) && event.seq > 0)
      .sort((a, b) => a.seq - b.seq);
    const canonical = accepted.filter(event => "schemaVersion" in event);
    const legacy = accepted.filter(event => !("schemaVersion" in event));
    let canonicalIndex = 0, legacyIndex = 0;
    while (canonicalIndex < canonical.length || legacyIndex < legacy.length) {
      const current = canonical[canonicalIndex], compatibility = legacy[legacyIndex];
      const event = current && (!compatibility || Date.parse(current.timestamp) < Date.parse(compatibility.timestamp))
        ? canonical[canonicalIndex++]! : legacy[legacyIndex++]!;
      if ("schemaVersion" in event) {
        if (event.schemaVersion !== 2 || event.seq <= this.canonicalSeq) continue;
        this.canonicalSeq = event.seq;
      } else {
        if (event.seq <= this.publicSeq) continue;
        this.publicSeq = event.seq;
      }
      const timestamp = Date.parse(event.timestamp);
      if (!Number.isFinite(timestamp) || timestamp < this.activationTime) continue;
      const notification = projectVoiceEvent(event, locale);
      if (notification) result.push(notification);
    }
    return result;
  }
}

export class VoiceNotificationQueue {
  private pending: VoiceNotification[] = [];
  private current?: { controller: AbortController; notification: VoiceNotification };
  private seen = new Set<string>();
  private paused = false;
  private disposed = false;

  constructor(private readonly synthesis: VoiceSynthesis, private readonly setPlayback: (value: VoicePlayback) => void) {}

  push(items: readonly VoiceNotification[]) {
    if (this.disposed) return;
    for (const item of items) {
      if (this.seen.has(item.key)) continue;
      this.seen.add(item.key);
      if (this.seen.size > 8_192) this.seen.delete(this.seen.values().next().value!);
      if (item.priority === "progress") this.pending = this.pending.filter(entry => entry.priority !== "progress");
      if (item.priority === "urgent") {
        this.pending = this.pending.filter(entry => entry.priority !== "progress");
        if (this.current?.notification.priority === "progress") this.current.controller.abort();
      }
      if (["finish", "cancel"].includes(item.kind)) {
        this.pending = this.pending.filter(entry => entry.kind === "method");
        if (this.current && ["question", "approval", "progress", "read"].includes(this.current.notification.kind))
          this.current.controller.abort();
      }
      this.pending.push(item);
      if (this.pending.length > 32) {
        const optional = this.pending.findIndex(entry => entry.priority !== "urgent");
        this.pending.splice(optional < 0 ? 0 : optional, 1);
      }
    }
    this.pump();
  }

  pause() { this.paused = true; }
  pauseForCapture(): boolean {
    if (this.current) return false;
    this.pause();
    return true;
  }
  resume() { this.paused = false; this.pump(); }

  dismiss(kind: "question" | "approval") {
    this.pending = this.pending.filter(item => item.kind !== kind);
    if (this.current?.notification.kind === kind) this.current.controller.abort();
  }

  interrupt() {
    this.pending = [];
    this.current?.controller.abort();
  }

  dispose() {
    this.disposed = true;
    this.interrupt();
  }

  private pump() {
    if (this.disposed || this.paused || this.current) return;
    const urgent = this.pending.findIndex(item => item.priority === "urgent");
    const notification = this.pending.splice(Math.max(urgent, 0), 1)[0];
    if (!notification) return;
    const controller = new AbortController();
    this.current = { controller, notification };
    this.setPlayback("speaking");
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return this.synthesis.speak(notification, controller.signal);
    }).then(() => this.settle(controller, "idle"), () =>
      this.settle(controller, controller.signal.aborted ? "idle" : "error"));
  }

  private settle(controller: AbortController, playback: VoicePlayback) {
    if (this.disposed || this.current?.controller !== controller) return;
    delete this.current;
    this.pump();
    if (!this.current) this.setPlayback(playback);
  }
}
