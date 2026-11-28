import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { bindVoiceAnswerJob, consumeVoiceAnswerProof, issueVoiceAnswerProof, reserveVoiceAnswerCapture, revokeVoiceAnswerCapture } from "./voice-answer-proof-host";
import { requiresNumericReadback } from "./voice-confirmation";

it("requires editable readback for common inflected quantities and numeric units", () => {
  for (const transcript of [
    "с двумя насосами", "до ста тонн", "с тремя линиями", "за восьмичасовую смену", "при восемнадцати событиях",
    "от пятидесяти до шестидесяти тонн", "до четырёхсот тонн", "с двумястами тоннами", "с миллионом тонн",
    "около полутора суток", "не дольше полчаса", "получасовой простой", "до трёх четвертей", "около полусотни вагонов",
    "не больше десятка рейсов", "a dozen trucks", "at fifty-five tonnes", "до ٣ тонн"
  ]) expect(requiresNumericReadback(transcript), transcript).toBe(true);
  for (const transcript of ["Материал выходит из дробилки", "Этот поток идёт на грохот", "Учитываем простой за смену", "The material is screened downstream"]) {
    expect(requiresNumericReadback(transcript), transcript).toBe(false);
  }
});

it("expires exact recognition receipts without issuing authority for an unbound or second job", () => {
  const sessionId = randomUUID(), jobId = randomUUID();
  let now = 1_000_000;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  const target = { runId: "run", projectId: "project", vdtId: "vdt", questionSetId: "set", questionEventId: "event", questionId: "question", turnId: randomUUID() };
  try {
    expect(issueVoiceAnswerProof(sessionId, jobId, "Recognized text")).toBeUndefined();
    expect(reserveVoiceAnswerCapture(sessionId, target)).toBe(true);
    expect(bindVoiceAnswerJob(sessionId, jobId)).toBe(true);
    expect(bindVoiceAnswerJob(sessionId, randomUUID())).toBe(false);
    expect(issueVoiceAnswerProof(sessionId, randomUUID(), "Recognized text")).toBeUndefined();
    const recognitionProof = issueVoiceAnswerProof(sessionId, jobId, "Recognized text")!;
    expect(consumeVoiceAnswerProof({ ...target, captureSessionId: sessionId, recognitionProof }, "Changed text")).toBe(false);
    now += 30_000;
    expect(consumeVoiceAnswerProof({ ...target, captureSessionId: sessionId, recognitionProof }, "Recognized text")).toBe(false);
    expect(issueVoiceAnswerProof(sessionId, jobId, "Recognized text")).toBeUndefined();
  } finally {
    revokeVoiceAnswerCapture(sessionId);
    clock.mockRestore();
  }
});
