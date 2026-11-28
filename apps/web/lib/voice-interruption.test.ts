import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceInterruptionGate, type LocalInterruptDetector } from "./voice-interruption";

const scope = "workspace:project:tree:run";
const otherScope = "workspace:project:tree:other-run";

function controlledDetector() {
  let notify: (() => void) | undefined;
  let close: (() => void) | undefined;
  const detect: LocalInterruptDetector = (signal, onNearEndSpeech) => {
    expect(signal.aborted).toBe(false);
    notify = onNearEndSpeech;
    return new Promise(resolve => { close = () => resolve("closed"); });
  };
  return { detect, speak: () => notify?.(), close: () => close?.() };
}

describe("experimental interrupt-only voice capture", () => {
  afterEach(() => vi.useRealTimers());

  it("requires explicit opt-in and the current scoped playback owner", () => {
    const gate = new VoiceInterruptionGate(scope);
    const detect = vi.fn<LocalInterruptDetector>();
    const playback = gate.beginPlayback(scope)!;
    expect(gate.beginDetection(scope, playback, detect)).toBeUndefined();
    expect(gate.beginAnswerCapture(scope)).toBeUndefined();
    gate.setMode("interrupt_only");
    expect(gate.beginDetection(otherScope, playback, detect)).toBeUndefined();
    expect(gate.beginDetection(scope, { ...playback }, detect)).toBeUndefined();
    expect(detect).not.toHaveBeenCalled();
    playback.finish();
    expect(gate.beginDetection(scope, playback, detect)).toBeUndefined();
    const answer = gate.beginAnswerCapture(scope)!;
    expect(gate.beginPlayback(scope)).toBeUndefined();
    answer.finish();
    expect(gate.beginPlayback(scope)).toBeDefined();
  });

  it("interrupts only the current playback once and requires a fresh answer after both closures", async () => {
    const gate = new VoiceInterruptionGate(scope);
    gate.setMode("interrupt_only");
    const unrelatedRun = new AbortController();
    const playback = gate.beginPlayback(scope)!;
    const stopPlayback = vi.fn();
    playback.signal.addEventListener("abort", stopPlayback);
    const input = controlledDetector();
    const detector = gate.beginDetection(scope, playback, input.detect)!;
    await Promise.resolve();
    expect(gate.beginDetection(scope, playback, input.detect)).toBeUndefined();
    input.speak();
    input.speak();
    expect(stopPlayback).toHaveBeenCalledOnce();
    expect(detector.signal.aborted).toBe(true);
    expect(unrelatedRun.signal.aborted).toBe(false);
    expect(gate.beginAnswerCapture(scope)).toBeUndefined();
    playback.finish();
    expect(gate.beginAnswerCapture(scope)).toBeUndefined();
    input.close();
    await expect(detector.closed).resolves.toBe("closed");
    expect(gate.beginAnswerCapture(scope)?.signal.aborted).toBe(false);
  });

  it("blocks answer capture when the detector has closed but playback is still tearing down", async () => {
    const gate = new VoiceInterruptionGate(scope);
    gate.setMode("interrupt_only");
    const playback = gate.beginPlayback(scope)!;
    const input = controlledDetector();
    const detector = gate.beginDetection(scope, playback, input.detect)!;
    await Promise.resolve();
    input.speak();
    input.close();
    await expect(detector.closed).resolves.toBe("closed");
    expect(gate.beginAnswerCapture(scope)).toBeUndefined();
    playback.finish();
    expect(gate.beginAnswerCapture(scope)).toBeDefined();
  });

  it.each(["cancel", "deadline", "off"] as const)("withdraws detector authority on %s without cancelling playback", async action => {
    vi.useFakeTimers();
    const gate = new VoiceInterruptionGate(scope);
    gate.setMode("interrupt_only");
    const playback = gate.beginPlayback(scope)!;
    const input = controlledDetector();
    const detector = gate.beginDetection(scope, playback, input.detect)!;
    await Promise.resolve();
    if (action === "cancel") detector.cancel();
    if (action === "deadline") vi.advanceTimersByTime(8_000);
    if (action === "off") gate.setMode("off");
    expect(detector.signal.aborted).toBe(true);
    input.speak();
    expect(playback.signal.aborted).toBe(false);
    playback.finish();
    expect(gate.beginAnswerCapture(scope)).toBeUndefined();
    input.close();
    await expect(detector.closed).resolves.toBe("closed");
    expect(gate.beginAnswerCapture(scope)).toBeDefined();
  });

  it("fences late old-scope audio and releases only the verified older leases", async () => {
    const gate = new VoiceInterruptionGate(scope);
    gate.setMode("interrupt_only");
    const first = gate.beginPlayback(scope)!;
    const input = controlledDetector();
    const detector = gate.beginDetection(scope, first, input.detect)!;
    await Promise.resolve();
    gate.switchScope(otherScope);
    expect(first.signal.aborted && detector.signal.aborted).toBe(true);
    expect(gate.beginPlayback(otherScope)).toBeUndefined();
    first.finish();
    input.close();
    await detector.closed;
    const latest = gate.beginPlayback(otherScope)!;
    input.speak();
    first.finish();
    expect(latest.signal.aborted).toBe(false);
    expect(gate.beginDetection(otherScope, latest, input.detect)).toBeUndefined();
    expect(gate.beginAnswerCapture(scope)).toBeUndefined();
    expect(gate.beginAnswerCapture(otherScope)).toBeUndefined();
    gate.dispose();
    expect(latest.signal.aborted).toBe(true);
    latest.finish();
    expect(gate.beginAnswerCapture(otherScope)).toBeUndefined();
  });

  it("does not open the detector when cancelled before device admission", async () => {
    const gate = new VoiceInterruptionGate(scope);
    gate.setMode("interrupt_only");
    const playback = gate.beginPlayback(scope)!;
    const detect = vi.fn<LocalInterruptDetector>();
    const detector = gate.beginDetection(scope, playback, detect)!;
    detector.cancel();
    await expect(detector.closed).resolves.toBe("closed");
    expect(detect).not.toHaveBeenCalled();
    expect(playback.signal.aborted).toBe(false);
  });

  it("keeps a new scope lease separate from synchronous older cleanup", () => {
    const gate = new VoiceInterruptionGate(scope);
    const old = gate.beginPlayback(scope)!;
    const activate = vi.fn(() => gate.beginPlayback(otherScope));
    old.signal.addEventListener("abort", () => { old.finish(); activate(); });
    gate.switchScope(otherScope);
    expect(activate.mock.results[0]?.value?.signal.aborted).toBe(false);
    expect(gate.beginAnswerCapture(otherScope)).toBeUndefined();
  });

  it.each(["cancel", "deadline", "off", "scope"] as const)(
    "settles a nonresponsive detector after %s without admitting an answer",
    async action => {
      vi.useFakeTimers();
      const gate = new VoiceInterruptionGate(scope);
      gate.setMode("interrupt_only");
      const playback = gate.beginPlayback(scope)!;
      let lateSpeech!: () => void;
      const detector = gate.beginDetection(scope, playback, async (_signal, nearEnd) => {
        lateSpeech = nearEnd;
        await new Promise<never>(() => {});
        return "closed";
      })!;
      const settled = vi.fn();
      void detector.closed.then(settled);
      await Promise.resolve();
      if (action === "cancel") detector.cancel();
      if (action === "deadline") await vi.advanceTimersByTimeAsync(8_000);
      if (action === "off") gate.setMode("off");
      const current = action === "scope" ? otherScope : scope;
      if (action === "scope") gate.switchScope(current);
      expect(detector.signal.aborted).toBe(true);
      lateSpeech();
      expect(playback.signal.aborted).toBe(action === "scope");
      await vi.advanceTimersByTimeAsync(1_999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(detector.closed).resolves.toBe("cleanup_unconfirmed");
      playback.finish();
      gate.setMode("interrupt_only");
      expect(gate.beginAnswerCapture(current)).toBeUndefined();
      expect(gate.beginPlayback(current)).toBeUndefined();
      expect(gate.beginDetection(current, playback, vi.fn<LocalInterruptDetector>())).toBeUndefined();
    }
  );

  it("releases quarantine only after the exact detector later confirms teardown", async () => {
    vi.useFakeTimers();
    const gate = new VoiceInterruptionGate(scope);
    gate.setMode("interrupt_only");
    const playback = gate.beginPlayback(scope)!;
    const input = controlledDetector();
    const detector = gate.beginDetection(scope, playback, input.detect)!;
    await Promise.resolve();
    detector.cancel();
    playback.finish();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(detector.closed).resolves.toBe("cleanup_unconfirmed");
    expect(gate.beginAnswerCapture(scope)).toBeUndefined();

    input.close();
    await vi.advanceTimersByTimeAsync(0);
    const current = gate.beginPlayback(scope)!;
    input.speak();
    expect(current.signal.aborted).toBe(false);
    current.finish();
    expect(gate.beginAnswerCapture(scope)).toBeDefined();
    await expect(detector.closed).resolves.toBe("cleanup_unconfirmed");
  });

  it.each(["unconfirmed", "thrown"] as const)("fails closed on %s detector cleanup", async failure => {
    const gate = new VoiceInterruptionGate(scope);
    gate.setMode("interrupt_only");
    const playback = gate.beginPlayback(scope)!;
    const detector = gate.beginDetection(scope, playback, async () => {
      if (failure === "thrown") throw new Error("detector crashed");
      return "cleanup_unconfirmed";
    })!;
    await expect(detector.closed).resolves.toBe("cleanup_unconfirmed");
    expect(detector.signal.aborted).toBe(true);
    playback.finish();
    expect(gate.beginAnswerCapture(scope)).toBeUndefined();
    gate.switchScope(otherScope);
    expect(gate.beginAnswerCapture(otherScope)).toBeUndefined();
  });
});
