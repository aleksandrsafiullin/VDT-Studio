import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createLocalNotificationSynthesis } from "@/lib/local-notification-synthesis";
import type { SpeechRequest, SpeechResponse } from "@vdt-studio/local-runner/speech-catalog";
import { SpeechSettings, SystemVoicePreview } from "./speech-settings";
import { installedAppleVoices, selectedAppleVoice, useSpeechStore } from "./speech-store";

const fixture = vi.hoisted(() => ({ apple: false }));

vi.mock("./vdt-store", async () => {
  const { DEFAULT_EXECUTION_SETTINGS } = await import("@/lib/execution-mode-catalog");
  return {
    useVdtStudioStore: (selector: (state: { executionSettings: typeof DEFAULT_EXECUTION_SETTINGS }) => unknown) =>
      selector({ executionSettings: fixture.apple
        ? { ...DEFAULT_EXECUTION_SETTINGS, executionMode: "byok", analyticalSourceChoice: "apple_manual" }
        : DEFAULT_EXECUTION_SETTINGS })
  };
});

it("renders the analytics connection separately and starts with voice components off", () => {
  expect(useSpeechStore.getInitialState()).toMatchObject({ stt: "off", tts: "off", realtime: "off", autoSpeak: false });
  const html = renderToStaticMarkup(<SpeechSettings />);
  expect(html).toContain("<dt>Analytics</dt>");
  expect(html).toContain("Local dictation keeps your audio on this computer.");
  expect(html).toContain("<dt>Speech recognition</dt><dd>Off</dd>");
  expect(html).toContain("<dt>Spoken responses</dt><dd>Off</dd>");
  expect(html).toContain("<dt>Realtime voice</dt><dd>Off</dd>");
});

it("labels the selected Apple analytical provider as on-device", () => {
  fixture.apple = true;
  try {
    const html = renderToStaticMarkup(<SpeechSettings />);
    expect(html).toContain("<dt>Analytics</dt><dd>Local · Apple on-device</dd>");
    expect(html).not.toContain("<dt>Analytics</dt><dd>API keys");
    expect(html).not.toContain("apple_foundation_models");
  } finally {
    fixture.apple = false;
  }
});

it("shows the Pro credit and direct API key setup even when the OpenAI diagnostic is disabled", () => {
  vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
  vi.stubEnv("NEXT_PUBLIC_VDT_OPENAI_SPEECH_BYOK_ENABLED", "");
  try {
    const html = renderToStaticMarkup(<SpeechSettings />);
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Using ChatGPT Pro with voice<\/summary>/);
    expect(html).toContain('aria-label="Copy link to OpenAI’s eligibility and activation guide"');
    expect(html).toContain('aria-label="Copy link to ChatGPT Settings → Billing"');
    expect(html).toContain('title="https://platform.openai.com/settings/organization/billing/credit-grants"');
    expect(html).toContain('title="https://platform.openai.com/api-keys"');
    expect(html).not.toContain('href="https://chatgpt.com/settings/billing"');
    expect(html).toContain("Settings → Execution mode → API keys");
    expect(html).toContain("off in this build");
    expect(html).toContain("Signed-in Codex has its own usage allowance.");
    expect(html).toContain("Codex CLI with ChatGPT sign-in");
    expect(html).toContain("Account voice availability is unknown");
    expect(html).not.toContain("Check active OpenAI connection");
  } finally {
    vi.unstubAllEnvs();
  }
});

it("provides direct OpenAI setup links in the local browser", () => {
  vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "development_web");
  try {
    const html = renderToStaticMarkup(<SpeechSettings />);
    expect(html).toContain('href="https://chatgpt.com/settings/billing" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('href="https://platform.openai.com/api-keys"');
    expect(html).not.toContain('aria-label="Copy link to ChatGPT Settings → Billing"');
  } finally {
    vi.unstubAllEnvs();
  }
});

it("uses bounded settings for the installed voice on the private notification request and discards a stale grant", async () => {
  const previous = useSpeechStore.getState();
  const storage = vi.fn();
  vi.stubGlobal("localStorage", { setItem: storage });
  const voices = [
    { id: "english-default", label: "Default", locale: "en-US", quality: 1 },
    { id: "english-selected", label: "Selected", locale: "en-GB", quality: 2 },
    { id: "russian", label: "Russian", locale: "ru-RU", quality: 1 }
  ];
  useSpeechStore.setState({ appleStatus: { state: "apple_voice_status", supported: true, recognition: [], voices },
    tts: "apple_local", ttsLocale: "en", autoSpeak: true, appleVoicePreferences: {} });
  try {
    const { setAppleVoicePreference, setTtsLocale } = useSpeechStore.getState();
    setAppleVoicePreference("ru", { voiceId: "russian", ratePercent: 93, volumePercent: 40 });
    setAppleVoicePreference("en", { voiceId: "english-selected", ratePercent: 140, volumePercent: -10 });
    const preferences = JSON.parse(storage.mock.calls.at(-1)?.[1] ?? "{}");
    expect(preferences.appleVoicePreferences).toEqual({
      ru: { voiceId: "russian", ratePercent: 93, volumePercent: 40 },
      en: { voiceId: "english-selected", ratePercent: 125, volumePercent: 0 }
    });
    setTtsLocale("ru");
    expect(selectedAppleVoice(useSpeechStore.getState())).toEqual({ ...preferences.appleVoicePreferences.ru, locale: "ru" });
    setTtsLocale("en");
    const voice = selectedAppleVoice(useSpeechStore.getState())!;
    expect(voice).toEqual({ ...preferences.appleVoicePreferences.en, locale: "en" });
    const port = vi.fn(async (request: SpeechRequest): Promise<SpeechResponse> => {
      if (request.operation === "open_tts") {
        setAppleVoicePreference("en", { volumePercent: 42 });
        return { state: "tts_open", sessionId: "lease", scopeId: request.selection.scopeId, eventId: request.eventId,
          boundary: "on_device", billing: "none", consent: "explicit_component" };
      }
      return { state: "closed" };
    });
    const play = vi.fn();
    const adapter = createLocalNotificationSynthesis({ scope: "project/tree",
      analytics: { mode: "local", providerId: "ollama", modelId: "qwen" }, voice, autoSpeak: true,
      current: () => selectedAppleVoice(useSpeechStore.getState())?.volumePercent === voice.volumePercent
    }, port, play)!;
    await expect(adapter.speak({ key: "verified-event", kind: "finish", priority: "urgent", text: "The model is saved." },
      new AbortController().signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(port.mock.calls[0]?.[0]).toMatchObject({ operation: "open_tts", preview: voice });
    expect(port.mock.calls.at(-1)?.[0]).toEqual({ operation: "close_tts", sessionId: "lease" });
    expect(play).not.toHaveBeenCalled();
    setAppleVoicePreference("en", { voiceId: "russian" });
    expect(selectedAppleVoice(useSpeechStore.getState())).toBeUndefined();
    const html = renderToStaticMarkup(<SystemVoicePreview settings={useSpeechStore.getState()} />);
    expect(html).toContain("The saved voice is unavailable for this language.");
    expect(html).toContain("Choose an installed voice");
    expect(html).toContain('value="english-default"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Prepare voice preview/);
    setAppleVoicePreference("en", { voiceId: "english-default" });
    expect(selectedAppleVoice(useSpeechStore.getState())?.voiceId).toBe("english-default");
    expect(renderToStaticMarkup(<SystemVoicePreview settings={useSpeechStore.getState()} />)).not.toContain("The saved voice is unavailable");
    useSpeechStore.setState({ appleStatus: { state: "apple_voice_status", supported: true, recognition: [], voices: voices.slice(1) } });
    expect(selectedAppleVoice(useSpeechStore.getState())).toBeUndefined();
  } finally {
    useSpeechStore.setState(previous);
    vi.unstubAllGlobals();
  }
});

it("ranks installed quality before the preferred language's system default and stable identifiers", () => {
  const voices = [
    { id: "a-voice", label: "Other English", locale: "en-GB", quality: 1 },
    { id: "z-system", label: "System English", locale: "en-US", quality: 1, systemDefault: true },
    { id: "enhanced", label: "Enhanced English", locale: "en-GB", quality: 2 },
    { id: "premium", label: "Premium English", locale: "en-US", quality: 3 },
    { id: "ru-premium", label: "Premium Russian", locale: "ru-RU", quality: 3, systemDefault: true }
  ];
  const status = { state: "apple_voice_status", supported: true, recognition: [], voices } as const;
  const appleStatus = { ...status, recognition: [], voices };
  const settings = { ttsLocale: "en" as const, appleStatus, appleVoicePreferences: {} };
  expect(installedAppleVoices(appleStatus, "en").map(voice => voice.id)).toEqual(["premium", "enhanced", "z-system", "a-voice"]);
  expect(selectedAppleVoice(settings)?.voiceId).toBe("premium");
  const standardOnly = { ...settings, appleStatus: { ...appleStatus, voices: voices.slice(0, 2) } };
  expect(selectedAppleVoice(standardOnly)?.voiceId).toBe("z-system");
  expect(selectedAppleVoice({ ...standardOnly, appleStatus: { ...appleStatus, voices: [
    { ...voices[1]!, systemDefault: false }, voices[0]!
  ] } })?.voiceId).toBe("a-voice");
  expect(selectedAppleVoice({ ...settings, appleVoicePreferences: {
    en: { voiceId: "a-voice", ratePercent: 100, volumePercent: 70 }
  } })?.voiceId).toBe("a-voice");
  expect(selectedAppleVoice(settings, true)).toBeUndefined();
});

it("requires a voice pin for legacy Auto Speak and pins the displayed voice on explicit consent", () => {
  const previous = useSpeechStore.getState();
  const storage = vi.fn();
  vi.stubGlobal("localStorage", { setItem: storage });
  useSpeechStore.setState({ tts: "apple_local", ttsLocale: "en", autoSpeak: true, appleVoicePreferences: {},
    appleStatus: { state: "apple_voice_status", supported: true, recognition: [], voices: [
      { id: "english", label: "English", locale: "en-US", quality: 1 },
      { id: "russian", label: "Russian", locale: "ru-RU", quality: 1 }
    ] }
  });
  try {
    const { setAutoSpeak, setTtsLocale, setSpokenMuted } = useSpeechStore.getState();
    expect(selectedAppleVoice(useSpeechStore.getState())?.voiceId).toBe("english");
    expect(selectedAppleVoice(useSpeechStore.getState(), true)).toBeUndefined();
    setAutoSpeak(true);
    expect(selectedAppleVoice(useSpeechStore.getState(), true)?.voiceId).toBe("english");
    setSpokenMuted(true);
    setTtsLocale("ru");
    expect(selectedAppleVoice(useSpeechStore.getState(), true)?.voiceId).toBe("russian");
    const saved = JSON.parse(storage.mock.calls.at(-1)?.[1] ?? "{}");
    expect(saved.appleVoicePreferences).toMatchObject({ en: { voiceId: "english" }, ru: { voiceId: "russian" } });
    expect(saved).not.toHaveProperty("spokenMuted");
    expect(useSpeechStore.getState().spokenMuted).toBe(true);
  } finally {
    useSpeechStore.setState(previous);
    vi.unstubAllGlobals();
  }
});
