import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyMicrophoneLevels } from "@/lib/live-dictation";
import { formatVoiceDuration, VoiceInputStatus } from "./voice-input-status";

const handlers = { onStop: () => undefined, onCancel: () => undefined, onDismiss: () => undefined };

describe("voice capture feedback", () => {
  it("stays absent when idle and distinguishes requesting a microphone from receiving audio", () => {
    expect(renderToStaticMarkup(<VoiceInputStatus state="idle" audio={emptyMicrophoneLevels()} recognizing={false} {...handlers} />)).toBe("");
    const starting = renderToStaticMarkup(<VoiceInputStatus state="starting" audio={emptyMicrophoneLevels()} recognizing={false} {...handlers} />);
    expect(starting).toContain("Opening microphone…");
    expect(starting).not.toContain("Live microphone audio level");
  });

  it("shows a real level history, recording duration and an explicit stop action while listening", () => {
    const html = renderToStaticMarkup(<VoiceInputStatus state="listening" audio={{ levels: [0, 0.5, 1], elapsedMs: 12_100, hasSpeech: true }} recognizing {...handlers} />);
    expect(html).toContain("Listening");
    expect(html).toContain("0:12");
    expect(html).toContain('aria-label="Live microphone audio level"');
    expect(html).toContain('height:3px');
    expect(html).toContain('height:32px');
    expect(html).toContain('aria-label="Finish recording"');
    expect(html).toContain("Recognizing speech locally…");
  });

  it("makes final transcription distinct from active recording and keeps cancellation available", () => {
    const html = renderToStaticMarkup(<VoiceInputStatus state="finishing" audio={emptyMicrophoneLevels()} recognizing {...handlers} />);
    expect(html).toContain("Transcribing audio…");
    expect(html).toContain("Recording stopped.");
    expect(html).toContain('aria-label="Cancel dictation"');
    expect(html).not.toContain('aria-label="Finish recording"');
    expect(html).not.toContain("Live microphone audio level");
  });

  it("explains silence and recognition failures without leaving a false listening state", () => {
    const silence = renderToStaticMarkup(<VoiceInputStatus state="listening" audio={{ ...emptyMicrophoneLevels(), elapsedMs: 3100 }} recognizing={false} {...handlers} />);
    expect(silence).toContain("No speech detected yet.");
    const error = renderToStaticMarkup(<VoiceInputStatus state="idle" error="The local voice runtime did not respond." audio={emptyMicrophoneLevels()} recognizing={false} {...handlers} />);
    expect(error).toContain('role="alert"');
    expect(error).toContain("Voice input stopped");
    expect(error).toContain("The local voice runtime did not respond.");
    expect(error).not.toContain("Live microphone audio level");
    expect(error).toContain('aria-label="Dismiss voice input error"');
  });

  it("formats elapsed capture and processing durations independently of transcript length", () => {
    expect(formatVoiceDuration(0)).toBe("0:00");
    expect(formatVoiceDuration(61_990)).toBe("1:01");
  });
});
