import { describe, expect, it, vi } from "vitest";
import type { SpeechRequest, SpeechResponse } from "@vdt-studio/local-runner/speech-catalog";
import { createLocalNotificationSynthesis } from "./local-notification-synthesis";

const options = {
  scope: "project/tree/revision", analytics: { mode: "local" as const, providerId: "ollama", modelId: "qwen" },
  voice: { locale: "en" as const, voiceId: "installed", ratePercent: 100, volumePercent: 70 },
  autoSpeak: true, current: () => true
};
const notification = { key: "run:42", text: "The model was saved.", kind: "finish", priority: "urgent" } as const;
const wave = "UklGRgAAAABXQVZF";

function fakeHost(result: (eventId: string) => SpeechResponse | Promise<SpeechResponse> =
  eventId => ({ state: "tts_complete", eventId, waveformBase64: wave })) {
  let eventId = "";
  return vi.fn(async (input: SpeechRequest): Promise<SpeechResponse> => {
    if (input.operation === "open_tts") {
      eventId = input.eventId;
      return { state: "tts_open", sessionId: "lease", eventId, scopeId: input.selection.scopeId,
        boundary: "on_device", billing: "none", consent: "explicit_component" };
    }
    if (input.operation === "tts_result") return result(eventId);
    return { state: "closed" };
  });
}

describe("approved local notifications", () => {
  it("requires separate opt-in and binds the verified text and opaque event to Apple local", async () => {
    const request = fakeHost();
    const play = vi.fn(async () => {});
    expect(createLocalNotificationSynthesis({ ...options, autoSpeak: false }, request, play)).toBeNull();
    expect(request).not.toHaveBeenCalled();
    const signal = new AbortController().signal;
    const synthesis = createLocalNotificationSynthesis(options, request, play)!;
    await synthesis.speak(notification, signal);
    const open = request.mock.calls[0]?.[0];
    expect(open).toMatchObject({ operation: "open_tts", confirmed: true, eventId: /^[a-f0-9]{64}$/,
      text: notification.text, selection: { scopeId: /^[a-f0-9]{64}$/, stt: null, realtime: null,
        analytics: options.analytics, tts: { providerId: "apple_local", modelId: "installed" } } });
    expect(play).toHaveBeenCalledWith(wave, signal);
    expect(request.mock.calls.at(-1)?.[0]).toEqual({ operation: "close_tts", sessionId: "lease" });
    await synthesis.speak(notification, signal);
    expect(request.mock.calls[3]?.[0]).toEqual(open);
  });

  it("closes immediately on mute or interruption and never plays the late result", async () => {
    const controller = new AbortController();
    const request = fakeHost(eventId => {
      controller.abort();
      return { state: "tts_complete", eventId, waveformBase64: wave };
    });
    const play = vi.fn();
    await expect(createLocalNotificationSynthesis(options, request, play)!.speak(notification, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(play).not.toHaveBeenCalled();
    expect(request.mock.calls.filter(([input]) => input.operation === "close_tts")).toHaveLength(1);
  });

  it("splits only an oversized waveform on word boundaries and closes each lease before the next", async () => {
    let openCount = 0;
    const port = fakeHost(eventId => ++openCount === 1
      ? { state: "tts_error", code: "waveform_too_large", eventId }
      : { state: "tts_complete", eventId, waveformBase64: wave });
    const play = vi.fn(async () => {});
    const notice = { ...notification, text: "Use 984375000 kWh and 827391000 litres." };
    await createLocalNotificationSynthesis(options, port, play)!.speak(notice, new AbortController().signal);
    const calls = port.mock.calls.map(([request]) => request);
    const opens = calls.filter(request => request.operation === "open_tts");
    expect(opens.map(request => request.text)).toEqual([notice.text, "Use 984375000 kWh", "and 827391000 litres."]);
    expect(new Set(opens.map(request => request.eventId)).size).toBe(3);
    expect(calls.map(request => request.operation)).toEqual([
      "open_tts", "tts_result", "close_tts", "open_tts", "tts_result", "close_tts", "open_tts", "tts_result", "close_tts"
    ]);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("does not split a stale overflow, an ordinary failure or an indivisible token", async () => {
    for (const [result, text] of [
      [() => ({ state: "tts_error", code: "waveform_too_large", eventId: "stale" } as const), notification.text],
      [() => ({ state: "tts_error" } as const), notification.text],
      [(eventId: string) => ({ state: "tts_error", code: "waveform_too_large", eventId } as const), "9843750000000000"]
    ] as const) {
      const request = fakeHost(result);
      const play = vi.fn();
      await expect(createLocalNotificationSynthesis(options, request, play)!
        .speak({ ...notification, text }, new AbortController().signal)).rejects.toThrow("installed voice");
      expect(request.mock.calls.map(([input]) => input.operation)).toEqual(["open_tts", "tts_result", "close_tts"]);
      expect(play).not.toHaveBeenCalled();
    }
  });

  it("rejects a split when the overflowing lease has not acknowledged closure", async () => {
    const text = { ...notification, text: "Use 984375000 kWh and 827391000 litres." };
    for (const close of [
      async () => { throw new Error("Sidecar disconnected."); },
      async () => ({ state: "active" } as const)
    ]) {
      const host = fakeHost(eventId => ({ state: "tts_error", code: "waveform_too_large", eventId }));
      const request = vi.fn((input: SpeechRequest) => input.operation === "close_tts" ? close() : host(input));
      const play = vi.fn();
      await expect(createLocalNotificationSynthesis(options, request, play)!.speak(text, new AbortController().signal))
        .rejects.toThrow("could not release");
      expect(request.mock.calls.map(([input]) => input.operation)).toEqual(["open_tts", "tts_result", "close_tts"]);
      expect(play).not.toHaveBeenCalled();
    }
  });

  it("stops before the next child if the played child cannot release its lease", async () => {
    let renderCount = 0;
    let closeCount = 0;
    const text = { ...notification, text: "Use 984375000 kWh and 827391000 litres." };
    const host = fakeHost(eventId => ++renderCount === 1
      ? { state: "tts_error", code: "waveform_too_large", eventId }
      : { state: "tts_complete", eventId, waveformBase64: wave });
    const request = vi.fn(async (input: SpeechRequest): Promise<SpeechResponse> => {
      if (input.operation === "close_tts" && ++closeCount === 2) throw new Error("Sidecar disconnected.");
      return host(input);
    });
    const play = vi.fn(async () => {});
    await expect(createLocalNotificationSynthesis(options, request, play)!.speak(text, new AbortController().signal))
      .rejects.toThrow("could not release");
    expect(request.mock.calls.map(([input]) => input.operation)).toEqual([
      "open_tts", "tts_result", "close_tts", "open_tts", "tts_result", "close_tts"
    ]);
    expect(play).toHaveBeenCalledOnce();
  });

  it("discards a result after a scope change or when the event differs", async () => {
    let current = true;
    const signal = new AbortController().signal;
    const play = vi.fn();
    const stale = fakeHost(eventId => {
      current = false;
      return { state: "tts_complete", eventId, waveformBase64: wave };
    });
    await expect(createLocalNotificationSynthesis({ ...options, current: () => current }, stale, play)!.speak(notification, signal))
      .rejects.toMatchObject({ name: "AbortError" });
    const wrong = fakeHost(() => ({ state: "tts_complete", eventId: "wrong", waveformBase64: wave }));
    await expect(createLocalNotificationSynthesis(options, wrong, play)!.speak(notification, signal)).rejects.toThrow("installed voice");
    expect(play).not.toHaveBeenCalled();
    expect(stale.mock.calls.at(-1)?.[0].operation).toBe("close_tts");
    expect(wrong.mock.calls.at(-1)?.[0].operation).toBe("close_tts");
  });

  it("closes an acknowledged grant when a new run replaces the original in the same workspace", async () => {
    const originalRun = "run-1";
    let activeRun = originalRun;
    const host = fakeHost();
    const request = vi.fn(async (input: SpeechRequest) => {
      if (input.operation === "open_tts") activeRun = "run-2";
      return host(input);
    });
    const play = vi.fn();
    const adapter = createLocalNotificationSynthesis({ ...options, current: () => activeRun === originalRun }, request, play)!;
    await expect(adapter.speak(notification, new AbortController().signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(request.mock.calls.map(([input]) => input.operation)).toEqual(["open_tts", "close_tts"]);
    expect(play).not.toHaveBeenCalled();
  });

});
