import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunEventV2, VdtAgentEvent, VdtAgentQuestion } from "@vdt-studio/vdt-agent-runtime";
import type { SpeechRequest, SpeechResponse } from "@vdt-studio/local-runner/speech-catalog";
import { createLocalNotificationSynthesis } from "@/lib/local-notification-synthesis";
import type { VoiceSynthesis } from "@/lib/voice-notification-queue";
import type { VoiceRunSnapshot } from "@/lib/voice-notifications";
import type { VerifiedVoiceNotificationsOptions } from "./use-verified-voice-notifications";

const observer = vi.hoisted(() => {
  type Slot = { ref?: { current: unknown }; deps?: readonly unknown[]; cleanup?: () => void };
  const slots: Slot[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const next = () => {
    const index = cursor++;
    return slots[index] ?? (slots[index] = {});
  };
  return {
    run<T>(hook: () => T) {
      cursor = 0;
      const result = hook();
      const pending = effects;
      effects = [];
      for (const apply of pending) apply();
      return result;
    },
    cleanup() {
      for (const slot of slots) slot.cleanup?.();
      slots.length = 0;
      effects = [];
    },
    subscribe: vi.fn(),
    hooks: {
      useRef: (value: unknown) => next().ref ??= { current: value },
      useState: (initial: unknown) => [initial, () => undefined],
      useCallback: (callback: unknown) => callback,
      useEffect(effect: () => (() => void) | void, deps: readonly unknown[]) {
        const slot = next();
        if (slot.deps?.length === deps.length && deps.every((value, i) => Object.is(value, slot.deps?.[i]))) return;
        slot.deps = deps;
        effects.push(() => {
          slot.cleanup?.();
          const cleanup = effect();
          if (cleanup) slot.cleanup = cleanup;
          else delete slot.cleanup;
        });
      }
    }
  };
});

vi.mock("react", () => observer.hooks);
vi.mock("@/lib/agent-client", () => ({ createAgentClient: () => ({ subscribe: observer.subscribe }) }));
const { useVerifiedVoiceNotifications } = await import("./use-verified-voice-notifications");

const now = Date.parse("2026-11-26T06:00:00Z");
const elapsed = (seconds: number) => new Date(now + seconds * 1_000).toISOString();
const runId = "run-fixture";
const question: VdtAgentQuestion = { id: "question-1", question: "Which reporting month?", reason: "Period required.", required: true };
const canonical: AgentRunEventV2 = {
  type: "question", source: "vdt_agent", schemaVersion: 2, id: "event-canonical", runId, seq: 3, timestamp: elapsed(2),
  sessionId: "session-fixture", messageId: "message-fixture", previousHash: null, hash: `sha256:${"a".repeat(64)}`,
  payload: { questionSetId: "set-1", checkpointId: "checkpoint-1", questions: [question] }
};
const started: VdtAgentEvent = {
  type: "run_started", runId, seq: 1, id: "event-started", timestamp: elapsed(1),
  title: "Run started", message: "Run started", phase: "classifying_request"
};
const mirror: VdtAgentEvent = {
  type: "clarifying_questions", runId, seq: 2, id: "event-public", timestamp: elapsed(2), questions: [question],
  title: "Question", message: "Question", phase: "asking_clarifying_questions", metadata: { eventV2Id: canonical.id, questionSetId: "set-1" }
};
const running: VoiceRunSnapshot = { runId, status: "running", events: [started] };
const waiting: VoiceRunSnapshot = { runId, status: "needs_user_input", events: [started, mirror], pendingQuestions: [question] };
const shown = "run-fixture:question:set-1:event-canonical";
const speak = vi.fn<VoiceSynthesis["speak"]>(async () => {});
const synthesis = { speak };
const base = { scope: "project:tree:revision", runId, snapshot: running, enabled: true, muted: false, locale: "en", synthesis };
const render = (change: Partial<VerifiedVoiceNotificationsOptions> = {}) =>
  observer.run(() => useVerifiedVoiceNotifications({ ...base, ...change }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  speak.mockClear();
  observer.subscribe.mockReset().mockImplementation(() => () => undefined);
});
afterEach(() => { observer.cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("arbitrates current paid readback with capture, discards local review text and cancels on scope loss", async () => {
  let playbackSignal: AbortSignal | undefined;
  const cloudSpeak = vi.fn<VoiceSynthesis["speak"]>(async (_, signal) => {
    playbackSignal = signal;
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  });
  const options = { currentReadbackOnly: true, synthesis: { speak: cloudSpeak } };
  const queue = render(options);
  expect(queue.pauseForCapture()).toBe(true);
  render({ ...options, snapshot: waiting });
  queue.reviewReadback("local-preview-only", "This text is for local readback");
  await vi.advanceTimersByTimeAsync(31);
  expect(cloudSpeak).not.toHaveBeenCalled();
  queue.resume();
  await vi.advanceTimersByTimeAsync(31);
  expect(cloudSpeak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: shown }), expect.any(AbortSignal));
  expect(observer.subscribe).not.toHaveBeenCalled();
  expect(queue.pauseForCapture()).toBe(false);
  render({ ...options, snapshot: waiting, scope: "another-revision", enabled: false });
  expect(playbackSignal?.aborted).toBe(true);
});

describe("verified live question recovery", () => {
  it("keeps the pre-question cutoff across a byte-identical Apple refresh and uses only the new synthesis lease", async () => {
    const observationScope = "same-apple-binding-saved-head-and-project-bytes";
    const beforeRefresh = vi.fn<VoiceSynthesis["speak"]>(async () => {});
    const afterRefresh = vi.fn<VoiceSynthesis["speak"]>(async () => {});
    const options = { observationScope, canonicalQuestionsOnly: true };
    render({ ...options, runId: undefined, snapshot: undefined });
    vi.setSystemTime(now + 1_005);
    render({ ...options, synthesis: { speak: beforeRefresh } });
    vi.setSystemTime(now + 2_000);
    observer.subscribe.mock.lastCall![1].onCanonicalEvent(canonical);
    await vi.advanceTimersByTimeAsync(31);
    expect(beforeRefresh).not.toHaveBeenCalled();

    // The persisted question is already timestamped when applying its snapshot
    // increments the UI revision and rebuilds the strict synthesis scope.
    render({ ...options, scope: "strict-ui-revision-after-refresh", snapshot: waiting, synthesis: { speak: afterRefresh } });
    await vi.advanceTimersByTimeAsync(31);
    expect(afterRefresh).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: shown }), expect.any(AbortSignal));
    const next = vi.fn<VoiceSynthesis["speak"]>(async () => {});
    render({ ...options, scope: "strict-ui-revision-after-second-refresh", snapshot: waiting, synthesis: { speak: next } });
    await vi.advanceTimersByTimeAsync(31);
    expect(next).not.toHaveBeenCalled();
  });

  it.each(["other VDT", "other saved revision", "changed draft"])("does not recover a prior question after a %s changes observation identity", async change => {
    render({ observationScope: "old-apple-workspace", canonicalQuestionsOnly: true });
    vi.setSystemTime(now + 2_031);
    render({ observationScope: change, scope: "new-strict-scope", canonicalQuestionsOnly: true, snapshot: waiting });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
  });

  it("keeps an older pending question silent when Apple observation starts after it", async () => {
    const options = { observationScope: "same-apple-workspace", canonicalQuestionsOnly: true };
    vi.setSystemTime(now + 2_031);
    render({ ...options, snapshot: waiting });
    render({ ...options, scope: "strict-ui-revision-after-refresh", snapshot: waiting });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
  });

  it("speaks only the exact pending Supervisor question after its provisional compatibility event", async () => {
    const provisional = { ...mirror, id: "provisional-question", metadata: undefined };
    const canonicalMirror = { ...mirror, seq: provisional.seq + 1 };
    const provisionalSnapshot = { ...waiting, events: [started, provisional] };
    const options = { canonicalQuestionsOnly: true };
    render(options);
    vi.setSystemTime(now + 2_000);
    const subscription = observer.subscribe.mock.calls[0]![1];
    subscription.onEvent(provisional);
    render({ ...options, snapshot: provisionalSnapshot });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
    subscription.onCanonicalEvent(canonical);
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
    render({ ...options, snapshot: { ...waiting, events: [started, provisional, canonicalMirror] } });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: shown }), expect.any(AbortSignal));
  });

  it("still speaks a legacy run's standalone pending question", async () => {
    const standalone = { ...mirror, metadata: undefined };
    render({ canonicalQuestionsOnly: false });
    vi.setSystemTime(now + 2_000);
    render({ snapshot: { ...waiting, events: [started, standalone] } });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: `${runId}:question:${standalone.id}` }), expect.any(AbortSignal));
  });

  it("preserves canonical multi-question announcements when the complete pending set matches", async () => {
    const questions = [question, { ...question, id: "question-2", question: "Which currency?" }];
    const options = { canonicalQuestionsOnly: true };
    render(options);
    vi.setSystemTime(now + 2_000);
    const snapshot = { ...waiting, events: [started, { ...mirror, questions }] };
    render({ ...options, snapshot });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
    render({ ...options, snapshot: { ...snapshot, pendingQuestions: questions } });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: shown,
      text: "Question. Which reporting month? Which currency?" }), expect.any(AbortSignal));
  });

  it("plays every bounded fragment of the signed serial question through the WebView audio API", async () => {
    const signedQuestion = { ...question, id: "skill_scope", question:
      "Does the same flow pass through every stage, or do separate lines produce independent, nonoverlapping outputs at the KPI boundary?" };
    const signedEvent = { ...canonical, payload: { ...canonical.payload, questions: [signedQuestion] } };
    const opened: Extract<SpeechRequest, { operation: "open_tts" }>[] = [];
    const request = vi.fn(async (input: SpeechRequest): Promise<SpeechResponse> => {
      if (input.operation === "open_tts") {
        opened.push(input);
        return { state: "tts_open", sessionId: input.eventId, eventId: input.eventId, scopeId: input.selection.scopeId,
          boundary: "on_device", billing: "none", consent: "explicit_component" };
      }
      if (input.operation === "tts_result") {
        // The signed helper failed to render the old 119-character fragment at 100%.
        const active = opened.at(-1)!;
        if (active.text.length > 48) return { state: "tts_error" };
        return { state: "tts_complete", eventId: active.eventId, waveformBase64: "UklGRgAAAABXQVZF" };
      }
      return { state: "closed" };
    });
    const play = vi.fn();
    vi.stubGlobal("Audio", class extends EventTarget {
      constructor(private readonly url: string) { super(); }
      async play() { play(this.url); this.dispatchEvent(new Event("ended")); }
      pause() {}
      removeAttribute() {}
    });
    const adapter = createLocalNotificationSynthesis({ scope: base.scope,
      analytics: { mode: "local", providerId: "apple_foundation_models", modelId: "SystemLanguageModel.default" },
      voice: { locale: "en", voiceId: "com.apple.voice.compact.en-US.Samantha", ratePercent: 100, volumePercent: 80 },
      autoSpeak: true, current: () => true }, request)!;

    const options = { synthesis: adapter, canonicalQuestionsOnly: true };
    render(options);
    vi.setSystemTime(now + 2_000);
    observer.subscribe.mock.calls[0]![1].onCanonicalEvent(signedEvent);
    render({ ...options, snapshot: { ...waiting, pendingQuestions: [signedQuestion],
      events: [started, { ...mirror, questions: [signedQuestion] }] } });
    await vi.advanceTimersByTimeAsync(31);
    await vi.waitFor(() => expect(opened.map(item => item.text).join(" ")).toBe(`Question. ${signedQuestion.question}`));
    await vi.waitFor(() => expect(request.mock.lastCall?.[0].operation).toBe("close_tts"));
    expect(new Set(opened.map(item => item.eventId)).size).toBe(opened.length);
    expect(play).toHaveBeenCalledTimes(opened.length);
    expect(play).toHaveBeenCalledWith(expect.stringMatching(/^blob:/));
  });

  it("uses the same occurrence once when the subscription receives the canonical question first", async () => {
    render();
    vi.setSystemTime(now + 2_000);
    observer.subscribe.mock.calls[0]![1].onCanonicalEvent(canonical);
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: shown, text: "Question. Which reporting month?" }), expect.any(AbortSignal));
    render({ snapshot: waiting });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).toHaveBeenCalledOnce();
  });

  it("recovers a fresh first snapshot after a spoken turn attaches its new run and respects capture pause", async () => {
    const initial = render({ runId: undefined, snapshot: undefined });
    expect(initial.pauseForCapture()).toBe(true);
    vi.setSystemTime(now + 2_000);
    const attached = render({ snapshot: waiting });
    observer.subscribe.mock.calls[0]![1].onCanonicalEvent(canonical);
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
    attached.resume();
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: shown }), expect.any(AbortSignal));
    render({ snapshot: waiting, synthesis: { speak } });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).toHaveBeenCalledOnce();
  });

  it("recovers when the run ID is assigned before its first snapshot", async () => {
    render({ runId: undefined, snapshot: undefined });
    vi.setSystemTime(now + 3_000);
    render({ snapshot: undefined });
    render({ snapshot: waiting });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: shown }), expect.any(AbortSignal));
  });

  it("recovers a live waiting snapshot before its delayed canonical stream event", async () => {
    render();
    vi.setSystemTime(now + 3_000);
    render({ snapshot: waiting });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: shown }), expect.any(AbortSignal));
    observer.subscribe.mock.calls[0]![1].onCanonicalEvent(canonical);
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).toHaveBeenCalledOnce();
  });

  it("drops a late canonical stream event after the snapshot has recorded its answer", async () => {
    render();
    vi.setSystemTime(now + 3_000);
    render({ snapshot: { ...waiting, status: "running", pendingQuestions: undefined, events: [...waiting.events,
      { ...mirror, seq: 3, type: "user_answer_received", id: "answer-fixture" }] } });
    render({ snapshot: waiting });
    observer.subscribe.mock.calls[0]![1].onCanonicalEvent(canonical);
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
    render({ snapshot: waiting, synthesis: { speak } });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
  });

  it("carries a recovered but unplayed question to a replacement queue in the same live scope", async () => {
    const initial = render({ runId: undefined, snapshot: undefined });
    initial.pause();
    vi.setSystemTime(now + 3_000);
    render({ snapshot: waiting });
    const replacement = vi.fn<VoiceSynthesis["speak"]>(async () => {});
    const attached = render({ snapshot: waiting, synthesis: { speak: replacement } });
    attached.resume();
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: shown }), expect.any(AbortSignal));
  });

  it("does not recover an unspoken question from a detached run when opening its history", async () => {
    render();
    render({ runId: undefined, snapshot: undefined });
    vi.setSystemTime(now + 3_000);
    render({ snapshot: waiting });
    render({ snapshot: waiting, synthesis: { speak } });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
  });

  it.each(["old history", "another run", "unmatched pending question", "answered occurrence", "scope changed", "muted", "multiple questions"])(
    "keeps %s silent", async value => {
      render({ runId: undefined, snapshot: undefined });
      vi.setSystemTime(now + 3_000);
      const overrides: Partial<VerifiedVoiceNotificationsOptions> = {};
      let snapshot = waiting;
      if (value === "old history") snapshot = { ...waiting, events: [{ ...started, timestamp: elapsed(-2) }, { ...mirror, timestamp: elapsed(-1) }] };
      if (value === "another run") snapshot = { ...waiting, events: [started, { ...mirror, runId: "unrelated" }] };
      if (value === "unmatched pending question") snapshot = { ...waiting, pendingQuestions: [{ ...question, question: "A different occurrence?" }] };
      if (value === "answered occurrence") snapshot = { ...waiting, events: [...waiting.events,
        { ...mirror, seq: 3, type: "user_answer_received", id: "answer-fixture" }] };
      if (value === "scope changed") overrides.scope = "other:tree:revision";
      if (value === "muted") overrides.muted = true;
      if (value === "multiple questions") snapshot = { ...waiting, pendingQuestions: [question, { ...question, id: "question-2" }] };
      render({ snapshot, ...overrides });
      await vi.advanceTimersByTimeAsync(31);
      expect(speak).not.toHaveBeenCalled();
    }
  );

  it("retires a queued question when its active occurrence is dismissed before capture releases", async () => {
    const initial = render({ runId: undefined, snapshot: undefined });
    initial.pause();
    vi.setSystemTime(now + 2_000);
    render({ snapshot: waiting });
    const resumed = render({ snapshot: { ...waiting, status: "running", pendingQuestions: undefined } });
    resumed.resume();
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
  });

  it("does not replay an existing approval or finish on attachment and preserves live approval and finish", async () => {
    const saved: VoiceRunSnapshot = { ...running, status: "succeeded", finishOutcome: {
      state: "final_persisted", outcome: "answer", policyVersion: "v1", projectRevision: 1, projectHash: `sha256:${"a".repeat(64)}`
    } };
    const waitingApproval: VoiceRunSnapshot = { ...running, status: "waiting_approval",
      pendingMutationProposal: { id: "review-1", baseRevisionId: "revision-1" } as VoiceRunSnapshot["pendingMutationProposal"] };
    render({ snapshot: waitingApproval });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
    render({ scope: "other:tree:revision", snapshot: saved });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).not.toHaveBeenCalled();
    render({ snapshot: running });
    render({ snapshot: waitingApproval });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: "approval" }), expect.any(AbortSignal));
    render({ snapshot: saved });
    await vi.advanceTimersByTimeAsync(31);
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "finish" }), expect.any(AbortSignal));
  });
});

it.each(["collapsed composer", "incompatible execution scope"])("blocks playback at the live boundary for %s before a render", async () => {
  let permitted = true;
  const queue = render({ canPlay: () => permitted });
  // A queue pump is scheduled, but synthesis must not start after ownership changes.
  queue.reviewReadback("queued", "Review the proposed changes.");
  permitted = false;
  await Promise.resolve();
  expect(speak).not.toHaveBeenCalled();

  permitted = true;
  queue.pause();
  queue.reviewReadback("release-race", "Review the proposed changes.");
  permitted = false;
  queue.resume();
  permitted = true;
  await vi.advanceTimersByTimeAsync(32);
  expect(speak).not.toHaveBeenCalled();
});
