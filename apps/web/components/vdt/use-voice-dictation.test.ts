import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  capture: vi.fn<(callback: (pcm: Float32Array) => void) => Promise<{ stop(): Promise<void> }>>(),
  stop: vi.fn(async () => undefined),
  transcribe: vi.fn(),
  openLocal: vi.fn(),
  update: vi.fn(),
  target: { runId: "run", analyticsBindingId: "binding", scope: { projectId: "project", vdtId: "tree", revisionId: "revision", commitGeneration: 3 } },
  cleanup: [] as (() => void)[]
}));
vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, fixture.update],
  useEffect: (effect: () => (() => void) | void) => { const cleanup = effect(); if (cleanup) fixture.cleanup.push(cleanup); }
}));
vi.mock("@/lib/live-dictation", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/live-dictation")>(), captureMicrophone: fixture.capture
}));
vi.mock("@/lib/openai-byok-speech-client", () => ({
  openAiSpeechCredentialTarget: () => fixture.target, transcribeOpenAiDictation: fixture.transcribe
}));
vi.mock("@/lib/speech-client", () => ({
  openSpeechSession: fixture.openLocal, closeSpeechSession: vi.fn(), keepSpeechSession: vi.fn(), transcribeSpeech: vi.fn(),
  selectedSpeechAnalytics: () => ({ mode: "api_keys", providerId: "openai_compatible", modelId: "selected" }),
  speechAnalyticsConnectionKey: () => "openai"
}));
vi.mock("./vdt-store", () => ({ useVdtStudioStore: { getState: () => ({ workspace: { activeProjectId: "project", activeVdtId: "tree" } }), subscribe: () => () => {} } }));
vi.mock("./speech-store", () => ({ useSpeechStore: { getState: () => ({ stt: "whisper_local", modelId: "base", language: "en" }), subscribe: () => () => {} } }));
vi.mock("./api-key-storage", () => ({ useApiKeyStorage: { subscribe: () => () => {} } }));

const { useVoiceDictation } = await import("./use-voice-dictation");
const selected = { target: fixture.target, selection: { recognitionLanguage: "en", synthesisLanguage: "en", localSynthesis: "apple_local" } } as const;
const spoken = () => new Float32Array(16_000).fill(0.1);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal("window", new EventTarget());
  fixture.capture.mockResolvedValue({ stop: fixture.stop });
  fixture.transcribe.mockResolvedValue("editable draft");
});
afterEach(() => { fixture.cleanup.splice(0).reverse().forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });

it("shares capture ownership and does not request paid recognition before capture closes", async () => {
  const draft = vi.fn();
  const voice = useVoiceDictation(draft, "tree");
  await voice.startOpenAi("Prefix", 6, 6, { ...selected, isCurrent: () => true });
  await voice.start("Prefix", 6, 6, "base", "en");
  expect(fixture.capture).toHaveBeenCalledOnce();
  expect(fixture.openLocal).not.toHaveBeenCalled();
  const samples = fixture.capture.mock.lastCall![0];
  samples(spoken()); samples(spoken());
  expect(fixture.transcribe).not.toHaveBeenCalled();
  await voice.stop();
  expect(fixture.transcribe).toHaveBeenCalledExactlyOnceWith(fixture.target, expect.any(Float32Array), selected.selection,
    expect.any(AbortSignal), expect.any(Function));
  expect(fixture.stop.mock.invocationCallOrder[0]).toBeLessThan(fixture.transcribe.mock.invocationCallOrder[0]!);
  expect(draft).toHaveBeenCalledExactlyOnceWith("Prefix editable draft");
});

it("does not send captured audio after the target becomes stale", async () => {
  let current = true;
  const draft = vi.fn();
  const voice = useVoiceDictation(draft, "tree");
  await voice.startOpenAi("Prefix", 6, 6, { ...selected, isCurrent: () => current });
  fixture.capture.mock.lastCall![0](spoken());
  current = false;
  await voice.stop();
  expect(fixture.transcribe).not.toHaveBeenCalled();
  expect(draft).not.toHaveBeenCalled();
});

it("keeps playback cleanup pending through late microphone permission and actual closure", async () => {
  const opening = deferred<{ stop(): Promise<void> }>();
  const closure = deferred<void>();
  const close = vi.fn(() => closure.promise);
  fixture.capture.mockReturnValueOnce(opening.promise);
  const voice = useVoiceDictation(vi.fn(), "tree");
  const start = voice.startOpenAi("Prefix", 6, 6, { ...selected, isCurrent: () => true });
  await vi.waitFor(() => expect(fixture.capture).toHaveBeenCalledOnce());
  voice.onManualEdit();
  const firstClosed = vi.fn();
  void voice.waitForRelease()?.then(firstClosed);
  // A canceled retry must keep the first capture's shutdown in the release chain.
  const retry = voice.startOpenAi("Edited", 6, 6, { ...selected, isCurrent: () => true });
  voice.onManualEdit();
  const secondClosed = vi.fn();
  void voice.waitForRelease()?.then(secondClosed);
  opening.resolve({ stop: close });
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(firstClosed).not.toHaveBeenCalled();
  expect(secondClosed).not.toHaveBeenCalled();
  closure.resolve();
  await Promise.all([start, retry, voice.waitForRelease()]);
  expect(firstClosed).toHaveBeenCalledOnce();
  expect(secondClosed).toHaveBeenCalledOnce();
  expect(fixture.capture).toHaveBeenCalledOnce();
  expect(fixture.transcribe).not.toHaveBeenCalled();
});

it("cancel during worklet flush prevents recognition state, transcript, and a second microphone stop", async () => {
  const closure = deferred<void>();
  const close = vi.fn(() => closure.promise);
  fixture.capture.mockResolvedValueOnce({ stop: close });
  const draft = vi.fn();
  const voice = useVoiceDictation(draft, "tree");
  await voice.startOpenAi("Prefix", 6, 6, { ...selected, isCurrent: () => true });
  fixture.capture.mock.lastCall![0](spoken());
  const stopping = voice.stop();
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  voice.onManualEdit();
  fixture.update.mockClear();
  closure.resolve();
  await Promise.all([stopping, voice.waitForRelease()]);
  expect(close).toHaveBeenCalledOnce();
  expect(fixture.transcribe).not.toHaveBeenCalled();
  expect(fixture.update).not.toHaveBeenCalled();
  expect(draft).not.toHaveBeenCalled();
});
