import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { VoiceConversationControls } from "./voice-conversation-controls";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof VoiceConversationControls>;

function controls(overrides: Partial<Props["dialogue"]> = {}, view: Partial<Omit<Props, "dialogue">> = {}) {
  const dialogue: Props["dialogue"] = { phase: "idle", active: false, muted: false, spokenMuted: false, error: undefined,
    notifications: { playback: "idle", status: { status: undefined, nodeCount: null, text: "Waiting for your answer." }, interrupt: vi.fn() },
    finish: vi.fn(), toggleMute: vi.fn(), toggleSpokenMute: vi.fn(), ...overrides };
  return renderToStaticMarkup(<VoiceConversationControls dialogue={dialogue} ready canSpeak hasSynthesis onSpeak={vi.fn()} onEnd={vi.fn()} {...view} />);
}

function primary(html: string) {
  return html.match(/<button[^>]*data-testid="agent-dialogue-primary"[^>]*>.*?<\/button>/)?.[0];
}

it("shows a single labelled primary microphone alongside quiet accessible icon controls", () => {
  const html = controls();
  expect(html.match(/data-testid="agent-dialogue-primary"/g)).toHaveLength(1);
  expect(primary(html)).toContain(">Speak</button>");
  expect(primary(html)).not.toContain("disabled");
  expect(html).toContain("Ready to listen.");
  for (const label of ["Mute microphone", "Mute spoken updates", "End voice conversation"]) {
    expect(html).toContain(`title="${label}" aria-label="${label}"`);
    expect(html).not.toContain(`>${label}</button>`);
  }
  expect(html).not.toContain("Interrupt playback");
  expect(html).not.toContain("Cancel response");
});

it("keeps one question-specific Finish action available while listening", () => {
  const html = controls({ phase: "listening", active: true }, { question: true });
  expect(html).toContain('data-testid="agent-question-voice"');
  expect(primary(html)).toContain(">Finish answer</button>");
  expect(primary(html)).not.toContain("disabled");
  expect(html).toContain("Listening.");
  expect(html).not.toContain("Speak your answer");
});

it.each([
  ["starting", "Opening the microphone"], ["recognizing", "Transcribing on this computer"], ["submitting", "Sending your voice turn"]
] as const)("keeps the single microphone unavailable while %s and exposes the current state", (phase, message) => {
  const html = controls({ phase, active: true });
  expect(primary(html)).toContain('disabled=""');
  expect(html).toContain(message);
});

it("keeps mic mute and spoken mute distinct and adds playback interruption only while playing", () => {
  const html = controls({ muted: true, spokenMuted: true });
  expect(primary(html)).toContain('disabled=""');
  expect(html).toContain("Microphone muted.");
  expect(html).toContain('aria-label="Unmute microphone"');
  expect(html).toContain('aria-label="Unmute spoken updates"');
  expect(html).not.toContain("Interrupt playback");
  const speaking = controls({ notifications: { playback: "speaking", status: { status: undefined, nodeCount: null, text: "Ready." }, interrupt: vi.fn() } });
  expect(primary(speaking)).toContain('disabled=""');
  expect(speaking).toContain("Playing spoken update");
  expect(speaking).toContain('title="Interrupt playback" aria-label="Interrupt playback"');
});

it("surfaces playback failure beside the question with one usable microphone action", () => {
  const html = controls({ notifications: { playback: "error", status: { status: undefined, nodeCount: null, text: "Waiting for an answer." }, interrupt: vi.fn() } }, { question: true });
  expect(html).toContain("Could not play the spoken question.");
  expect(html).not.toContain("Ready to listen.");
  expect(html).not.toContain("Interrupt playback");
  expect(primary(html)).toContain(">Speak your answer</button>");
  expect(primary(html)).not.toContain("disabled");
});
