import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { DEFAULT_EXECUTION_SETTINGS } from "@/lib/execution-mode-catalog";

const harness = vi.hoisted(() => {
  type Slot = { initialized?: boolean; value?: unknown; ref?: { current: unknown }; deps?: readonly unknown[]; cleanup?: (() => void) | undefined };
  const slots: Slot[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const next = () => { const index = cursor++; return slots[index] ?? (slots[index] = {}); };
  return {
    render<T>(hook: () => T) {
      cursor = 0;
      const result = hook();
      const pending = effects;
      effects = [];
      for (const effect of pending) effect();
      return result;
    },
    cleanup() {
      for (const slot of slots) slot.cleanup?.();
      slots.length = 0;
      effects = [];
    },
    hooks: {
      useRef: (value: unknown) => next().ref ??= { current: value },
      useState(value: unknown) {
        const slot = next();
        if (!slot.initialized) { slot.initialized = true; slot.value = value; }
        return [slot.value, (result: unknown) => { slot.value = result; }];
      },
      useCallback: (callback: unknown) => callback,
      useEffect(effect: () => (() => void) | void, deps: readonly unknown[]) {
        const slot = next();
        if (slot.deps?.length === deps.length && deps.every((value, i) => Object.is(value, slot.deps?.[i]))) return;
        slot.deps = deps;
        effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
      }
    },
    open: vi.fn(async (_selection: unknown, _signal: AbortSignal, _answer?: unknown) => ({ sessionId: "new-capture" })),
    close: vi.fn(async () => undefined),
    recognize: vi.fn(),
    capture: vi.fn(async (_onPcm: (samples: Float32Array) => void) => ({ stop: vi.fn(async (): Promise<void> => undefined) })),
    retire: vi.fn(),
    interrupt: vi.fn(),
    pauseForCapture: vi.fn(() => true),
    resume: vi.fn()
  };
});

vi.mock("react", () => harness.hooks);
vi.mock("@/lib/live-dictation", () => ({ captureMicrophone: harness.capture, audioBase64: vi.fn() }));
vi.mock("@/lib/speech-client", () => ({ openSpeechSession: harness.open, closeSpeechSession: harness.close, transcribeSpeechWithProof: harness.recognize }));
vi.mock("./speech-store", () => ({ useSpeechStore: () => false }));
vi.mock("./use-verified-voice-notifications", () => ({
  useVerifiedVoiceNotifications({ scope }: { scope: string }) {
    harness.hooks.useEffect(() => () => harness.retire(scope), [scope]);
    return { interrupt: harness.interrupt, pauseForCapture: harness.pauseForCapture, resume: harness.resume };
  }
}));

const { useScopedComposerDraft, useVoiceDialogue } = await import("./use-voice-dialogue");
type Options = Parameters<typeof useVoiceDialogue>[0];
type Selection = ReturnType<Options["selected"]>;
type IdleApple = NonNullable<Selection["idleApple"]>;

const base: IdleApple["base"] = {
  projectId: "project", vdtId: "tree",
  expectedHead: { schemaVersion: "vdt_revision_cas.v1", activeRevisionId: "saved-review", commitGeneration: 1,
    activeContentIdentity: { scheme: "vdt_revision_payload_hash.v1", hash: `sha256:${"a".repeat(64)}` } },
  expectedRuntime: { schemaVersion: "project_runtime_cas.v1", runtimeGeneration: "v1", generationVersion: 1 }
};
const appleSettings = { ...DEFAULT_EXECUTION_SETTINGS, analyticalSourceChoice: "apple_default" } as const;
const appleSelection = { mode: "local", providerId: "apple_foundation_models", modelId: "SystemLanguageModel.default" } as const;
const appleScope: IdleApple = { base, project: productionVolumeProject, executionSettings: appleSettings,
  microphoneKey: "whisper-base:en", bindingId: "apple_native_verified", verifiedFirstLaunch: true };
const liveAnswer = { kind: "answer", runId: "new-run", questionSetId: "live-set", questionEventId: "live-occurrence",
  questionId: "live-question", projectId: base.projectId, vdtId: base.vdtId } as const;

let current: Selection;
let documentFixture: EventTarget & { hidden: boolean };
const initial: Selection = {
  scope: "strict-before",
  selection: { version: 1, scopeId: JSON.stringify([base.projectId, base.vdtId]), analytics: appleSelection, language: "en",
    stt: { providerId: "whisper_local", modelId: "base" }, tts: null, realtime: null },
  idleApple: appleScope,
  destination: { kind: "instruction", continuing: false }
};
const fromSameHead = (): Selection => ({
  ...initial, scope: "strict-admitted", destination: liveAnswer,
  idleApple: { ...appleScope, base: structuredClone(base), project: structuredClone(productionVolumeProject) }
});
const render = (canCapture?: () => boolean) => harness.render(() => useVoiceDialogue({
  selected: () => current, ...(canCapture ? { canCapture } : {}), dispatch: vi.fn(async () => true), preserve: vi.fn(),
  notifications: { scope: current.scope, runId: null, snapshot: undefined, locale: "en", synthesis: null }
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  current = initial;
  documentFixture = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", documentFixture);
  vi.stubGlobal("window", new EventTarget());
});
afterEach(async () => {
  harness.cleanup();
  await Promise.resolve();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("waits for manual dictation to release the microphone and its playback pause before enabling or recording", async () => {
  let released = false;
  const canCapture = () => released;
  render(canCapture).enable();
  expect(render(canCapture).enabled).toBe(false);
  await render(canCapture).record();
  expect(harness.pauseForCapture).not.toHaveBeenCalled();
  expect(harness.open).not.toHaveBeenCalled();

  released = true;
  render(canCapture).enable();
  expect(render(canCapture).enabled).toBe(true);
  const raced = render(canCapture).record();
  released = false;
  await raced;
  expect(harness.pauseForCapture).not.toHaveBeenCalled();

  released = true;
  await render(canCapture).record();
  expect(harness.pauseForCapture).toHaveBeenCalledOnce();
  expect(harness.open).toHaveBeenCalledOnce();
  expect(harness.capture).toHaveBeenCalledOnce();
});

it("retains microphone ownership after ending dialogue until capture closes and playback pause is released", async () => {
  let finishClosing!: () => void;
  const stop = vi.fn(() => new Promise<void>(resolve => { finishClosing = resolve; }));
  harness.capture.mockResolvedValueOnce({ stop });
  render().enable();
  await render().record();
  render().deactivate();
  const ended = render();
  expect(ended.enabled).toBe(false);
  expect(ended.captureBusy).toBe(true);
  expect(ended.hasCapture()).toBe(true);
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  expect(harness.resume).not.toHaveBeenCalled();
  finishClosing();
  await vi.waitFor(() => expect(harness.resume).toHaveBeenCalledOnce());
  expect(ended.hasCapture()).toBe(false);
  expect(render().captureBusy).toBe(false);
});

describe("idle Apple voice opt-in continuity", () => {
  it.each(["same saved snapshot", "verified first launch"] as const)("keeps opt-in through %s and requires a fresh answer capture", async change => {
    if (change === "verified first launch") current = {
      ...initial,
      selection: { ...initial.selection, analytics: { mode: "api_keys", providerId: "openai_compatible", modelId: "configured" } },
      idleApple: { ...appleScope, executionSettings: { ...DEFAULT_EXECUTION_SETTINGS, analyticalSourceChoice: "untouched" },
        bindingId: undefined, verifiedFirstLaunch: false }
    };
    render().enable();
    const previous = render();
    current = fromSameHead();
    await previous.record();
    expect(harness.open).not.toHaveBeenCalled();

    render();
    const rebound = render();
    expect(rebound.enabled).toBe(true);
    expect(harness.retire).toHaveBeenCalledExactlyOnceWith(initial.scope);
    expect(harness.open).not.toHaveBeenCalled();
    expect(harness.capture).not.toHaveBeenCalled();

    await rebound.record();
    expect(harness.open).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ analytics: appleSelection }), expect.any(AbortSignal),
      expect.objectContaining({ runId: liveAnswer.runId, questionSetId: liveAnswer.questionSetId,
        questionEventId: liveAnswer.questionEventId, questionId: liveAnswer.questionId, turnId: expect.any(String) })
    );
    expect(harness.retire.mock.invocationCallOrder[0]).toBeLessThan(harness.open.mock.invocationCallOrder[0]!);
    expect(harness.capture).toHaveBeenCalledOnce();
  });

  it.each(["edited project", "changed head", "changed VDT", "changed Apple binding", "changed model settings", "changed microphone language",
    "unverified default", "explicit Apple choice", "first launch with changed settings", "review", "not saved"] as const)("requires another opt-in after %s", async change => {
    if (change === "unverified default" || change === "explicit Apple choice" || change === "first launch with changed settings") current = {
      ...initial, idleApple: { ...appleScope, bindingId: undefined, verifiedFirstLaunch: false,
        executionSettings: { ...DEFAULT_EXECUTION_SETTINGS, analyticalSourceChoice: "untouched" } }
    };
    render().enable();
    const next = fromSameHead();
    const context = next.idleApple!;
    if (change === "edited project") context.project = { ...context.project, name: "Edited model" };
    if (change === "changed head") context.base.expectedHead.activeRevisionId = "new-saved-head";
    if (change === "changed VDT") context.base.vdtId = "other-tree";
    if (change === "changed Apple binding") context.bindingId = "apple_native_new_identity";
    if (change === "changed model settings") context.executionSettings = { ...appleSettings, model: "other-model" };
    if (change === "changed microphone language") context.microphoneKey = "whisper-base:ru";
    if (change === "unverified default") context.verifiedFirstLaunch = false;
    if (change === "explicit Apple choice") context.executionSettings = { ...appleSettings, analyticalSourceChoice: "apple_manual" };
    if (change === "first launch with changed settings") context.executionSettings = { ...appleSettings, model: "other-model" };
    if (change === "review") next.destination = { kind: "review", runId: "new-run", proposal: { runId: "new-run", projectId: base.projectId,
      vdtId: base.vdtId, proposalId: "review", baseRevisionId: "saved-review", baseRevision: 1 } };
    if (change === "not saved") next.idleApple = undefined;
    current = next;
    render();
    const disabled = render();
    expect(disabled.enabled).toBe(false);
    await disabled.record();
    expect(harness.open).not.toHaveBeenCalled();
  });

  it("cancels an in-flight capture even on a compatible saved snapshot", async () => {
    render().enable();
    await render().record();
    const captureSignal = harness.open.mock.calls[0]?.[1] as AbortSignal;
    expect(captureSignal.aborted).toBe(false);
    current = fromSameHead();
    render();
    expect(render().enabled).toBe(false);
    expect(captureSignal.aborted).toBe(true);
    expect(harness.open).toHaveBeenCalledOnce();
  });

  it.each(["End voice conversation", "hidden page"] as const)("preserves microphone mute and honors %s", mode => {
    render().enable();
    render().toggleMute();
    current = fromSameHead();
    render();
    const rebound = render();
    expect(rebound.enabled).toBe(true);
    expect(rebound.muted).toBe(true);
    if (mode === "End voice conversation") rebound.deactivate();
    else {
      documentFixture.hidden = true;
      documentFixture.dispatchEvent(new Event("visibilitychange"));
    }
    expect(render().enabled).toBe(false);
    expect(harness.open).not.toHaveBeenCalled();
  });
});

it("retains an editable draft across remounts and isolates project/VDT scopes", () => {
  const first = JSON.stringify(["typed-project", "shared-vdt"]);
  const otherProject = JSON.stringify(["other-project", "shared-vdt"]);
  const otherVdt = JSON.stringify(["typed-project", "other-vdt"]);
  const read = (scope: string) => harness.render(() => useScopedComposerDraft(scope));
  try {
    read(first)[1]("Typed prompt");
    read(first)[1](previous => previous + "\nRecognized phrase");
    harness.cleanup();
    expect(read(first)[0]).toBe("Typed prompt\nRecognized phrase");
    expect(read(otherProject)[0]).toBe("");
    expect(read(otherVdt)[0]).toBe("");
    read(first)[1]("Edited recognized phrase");
    harness.cleanup();
    expect(read(first)[0]).toBe("Edited recognized phrase");
  } finally {
    read(first)[1]("");
  }
});

it.each(["collapse", "mode switch"] as const)("retires a pending producer on %s and keeps the visible draft", async transition => {
  let visible = true;
  type Recognition = { text: string; recognitionProof: string };
  let complete!: (recognition: Recognition) => void;
  let observedRecognition!: () => void;
  const recognitionStarted = new Promise<void>(resolve => { observedRecognition = resolve; });
  harness.recognize.mockImplementationOnce(() => {
    observedRecognition();
    return new Promise<Recognition>(resolve => { complete = resolve; });
  });
  const dispatch = vi.fn(async () => false);
  const scope = JSON.stringify(["composer-project", "composer-vdt"]);
  const combined = () => harness.render(() => {
    const [draft, update] = useScopedComposerDraft(scope);
    const dialogue = useVoiceDialogue({
      selected: () => current, canCapture: () => visible, dispatch,
      preserve: text => update(previous => previous + "\n" + text),
      notifications: { scope: current.scope, runId: null, snapshot: undefined, locale: "en", synthesis: null }
    });
    return { draft, update, dialogue };
  });
  try {
    current = { ...initial, destination: liveAnswer };
    combined().update("Typed prompt\nAlready recognized phrase");
    combined().dialogue.enable();
    await combined().dialogue.record();
    const samples = harness.capture.mock.lastCall![0];
    samples(new Float32Array(16_000).fill(0.09));
    combined().dialogue.finish();
    await recognitionStarted;
    if (transition === "collapse") {
      // Model receipt races the close before the React effect retires opt-in.
      visible = false;
    } else {
      current = { ...initial, scope: "incompatible-api-key",
        selection: { ...initial.selection, analytics: { mode: "api_keys", providerId: "openai_compatible", modelId: "explicit" } },
        idleApple: undefined };
    }
    // The proof-bearing result settles before React sees either change.
    complete({ text: "The stages are in series", recognitionProof: "fixture-proof" });
    await vi.waitFor(() => expect(harness.close).toHaveBeenCalledOnce());
    expect(dispatch).not.toHaveBeenCalled();
    expect(combined().draft).toBe("Typed prompt\nAlready recognized phrase");
    if (transition === "collapse") combined().dialogue.deactivate();
    visible = true;
    await combined().dialogue.record();
    expect(combined().dialogue.enabled).toBe(false);
    expect(harness.open).toHaveBeenCalledOnce();
    expect(harness.capture).toHaveBeenCalledOnce();
  } finally {
    combined().update("");
  }
});
