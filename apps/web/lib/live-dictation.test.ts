import { describe, expect, it, vi } from "vitest";
import { SPEECH_SAMPLE_RATE as RATE } from "@vdt-studio/local-runner/speech-catalog";
import { validateSpeechWave } from "@vdt-studio/local-runner/speech";
import { insertDictation, LiveDictationSession, PcmResampler, pcmWave } from "./live-dictation";

const voice = (seconds: number) => new Float32Array(Math.round(RATE * seconds)).fill(0.2);
const silence = (seconds: number) => new Float32Array(Math.round(RATE * seconds));

describe("live local dictation", () => {
  it("shows provisional words before stop and replaces them with the refined phrase without duplicates", async () => {
    const updates: string[] = [];
    const recognize = vi.fn().mockResolvedValueOnce("Создай дерево").mockResolvedValueOnce("Создай дерево прибыли");
    const session = new LiveDictationSession(recognize, (text) => updates.push(text), () => undefined);
    session.push(voice(2));
    await vi.waitFor(() => expect(updates).toEqual(["Создай дерево"]));
    session.push(voice(1));
    await session.finish();
    expect(updates.at(-1)).toBe("Создай дерево прибыли");
    expect(updates.at(-1)).not.toContain("Создай дерево Создай");
  });

  it("retains finalized phrases while the next phrase is refined", async () => {
    const updates: string[] = [];
    let calls = 0;
    const session = new LiveDictationSession(async () => ++calls <= 2 ? "Построй дерево." : "Добавь расходы.", (text) => updates.push(text), () => undefined);
    session.push(voice(1));
    session.push(silence(0.8));
    await vi.waitFor(() => expect(updates.at(-1)).toBe("Построй дерево."));
    session.push(voice(2));
    await session.finish();
    expect(updates.at(-1)).toBe("Построй дерево. Добавь расходы.");
  });

  it("does not transcribe an empty or silent recording", async () => {
    const recognize = vi.fn();
    const session = new LiveDictationSession(recognize, () => undefined, () => undefined);
    for (let i = 0; i < 50; i++) session.push(silence(0.1));
    await session.finish();
    expect(recognize).not.toHaveBeenCalled();
  });

  it("discards late recognition after cancellation or a manual draft edit", async () => {
    let resolve: (text: string) => void = () => undefined;
    const update = vi.fn();
    const session = new LiveDictationSession(() => new Promise<string>((done) => { resolve = done; }), update, () => undefined);
    session.push(voice(2));
    session.cancel();
    resolve("Must not overwrite manual edits");
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
  });

  it("coalesces stale provisional work on a slow CPU but keeps final audio", async () => {
    let release: (text: string) => void = () => undefined;
    const recognize = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; })).mockResolvedValue("Final text");
    const session = new LiveDictationSession(recognize, () => undefined, () => undefined);
    session.push(voice(2));
    session.push(voice(2));
    session.push(voice(2));
    const done = session.finish();
    release("Early text");
    await done;
    expect(recognize).toHaveBeenCalledTimes(2);
    expect(recognize.mock.calls[1]?.[0].length).toBe(RATE * 6);
  });

  it("preserves surrounding text and replaces only the selected insertion range", () => {
    expect(insertDictation("Income. Expenses.", 7, 7, "Profit.")).toBe("Income. Profit. Expenses.");
    expect(insertDictation("Old request!", 0, 11, "New request")).toBe("New request!");
    expect(insertDictation("Existing draft", 14, 14, "")).toBe("Existing draft");
  });

  it("resamples across worklet boundaries without gaps or accumulating drift", () => {
    const resampler = new PcmResampler(48_000);
    const whole = new Float32Array(48_000).map((_, i) => Math.sin(i / 20));
    const parts = [whole.subarray(0, 2048), whole.subarray(2048, 4096), whole.subarray(4096)];
    const result = parts.flatMap((part) => [...resampler.push(part)]);
    expect(result).toHaveLength(RATE);
    expect(result[1500]).toBeCloseTo(whole[4500]!, 5);
  });

  it("encodes a bounded WAV accepted by the runtime and clips over-range samples", () => {
    const wav = Buffer.from(pcmWave(Float32Array.of(-2, 0, 2)));
    expect(() => validateSpeechWave(wav)).not.toThrow();
    expect(wav.readInt16LE(44)).toBe(-32768);
    expect(wav.readInt16LE(48)).toBe(32767);
  });
});
