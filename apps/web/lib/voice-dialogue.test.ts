import { afterEach, describe, expect, it, vi } from "vitest";
import { SPEECH_SAMPLE_RATE } from "@vdt-studio/local-runner/speech-catalog";
import { audioBase64 } from "./live-dictation";
import { closeSpeechSession, openSpeechSession, transcribeSpeech } from "./speech-client";
import { DialogueTurn, DialogueUtterance, dialogueDestination, dispatchFinalDialogueTurn, heardQuestion, spokenAnswer } from "./voice-dialogue";

const instruction = dialogueDestination({});
const question = { id: "topology", question: "How does the material flow?", reason: "The answer changes the formula.", required: true, expectedAnswerType: "text" as const };
const waiting = { status: "needs_user_input", runId: "run-1", projectId: "project-1", vdtId: "vdt-1",
  questionSetId: "questions-1", questionEventId: "event-1", questions: [question] };
const answer = dialogueDestination(waiting)!;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("half-duplex voice turn", () => {
  it("ends a PCM utterance on silence, ignores ambient frames and returns one bounded final", () => {
    const utterance = new DialogueUtterance();
    expect(utterance.push(new Float32Array(512))).toBe(false);
    expect(utterance.finish()).toBeUndefined();
    expect(utterance.push(new Float32Array(SPEECH_SAMPLE_RATE / 2).fill(0.025))).toBe(false);
    expect(utterance.push(new Float32Array(SPEECH_SAMPLE_RATE))).toBe(true);
    expect(utterance.finish()?.length).toBe(512 + 1.5 * SPEECH_SAMPLE_RATE);
    const maximum = new DialogueUtterance();
    expect(maximum.push(new Float32Array(13 * SPEECH_SAMPLE_RATE).fill(0.025))).toBe(true);
    expect(maximum.finish()?.length).toBe(10 * SPEECH_SAMPLE_RATE);
  });

  it("routes one final transcript through the normal composer exactly once", async () => {
    const turn = new DialogueTurn("project-1/tree-1/provider-A", instruction!, "speech-1", "turn-1");
    const transport = { signal: new AbortController().signal, recognize: vi.fn(async () => "  Построй дерево  "),
      current: () => ({ scope: turn.scope, destination: instruction }), dispatch: vi.fn(async () => true) };
    expect(await dispatchFinalDialogueTurn(turn, transport)).toEqual({ state: "sent" });
    expect(await dispatchFinalDialogueTurn(turn, transport)).toEqual({ state: "stale" });
    expect(transport.dispatch).toHaveBeenCalledExactlyOnceWith({ kind: "instruction", runId: undefined, continuing: false }, "Построй дерево", { sessionId: "speech-1", turnId: "turn-1" });
  });

  it("submits only the real current plain-text question and uses the normal answer shape", async () => {
    expect(answer).toEqual({ kind: "answer", runId: "run-1", questionSetId: "questions-1", questionEventId: "event-1",
      projectId: "project-1", vdtId: "vdt-1", questionId: "topology" });
    const sendMessage = vi.fn(async (_runId, _message) => true);
    const turn = new DialogueTurn("scope", answer, "speech-1", "turn-1");
    const result = await dispatchFinalDialogueTurn(turn, {
      signal: new AbortController().signal,
      recognize: async () => ({ text: "Both stages are in series", recognitionProof: "issued-proof" }),
      current: () => ({ scope: "scope", destination: dialogueDestination(waiting) }),
      dispatch: (destination, text, capture) => destination.kind === "answer" && capture.recognitionProof ? sendMessage(destination.runId,
        { type: "user_answer", expectedQuestion: heardQuestion(destination, { ...capture, recognitionProof: capture.recognitionProof }), structuredAnswers: [spokenAnswer(destination, text)] }) : Promise.resolve(false)
    });
    expect(result).toEqual({ state: "sent" });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith("run-1", {
      type: "user_answer", expectedQuestion: {
        runId: "run-1", projectId: "project-1", vdtId: "vdt-1", questionSetId: "questions-1", questionEventId: "event-1",
        questionId: "topology", captureSessionId: "speech-1", turnId: "turn-1", recognitionProof: "issued-proof"
      }, structuredAnswers: [{ questionId: "topology", fields: { answer: "Both stages are in series" } }]
    });
  });

  it("retains a transcript in the draft when the capture host cannot issue an answer proof", async () => {
    const dispatch = vi.fn();
    expect(await dispatchFinalDialogueTurn(new DialogueTurn("scope", answer, "speech-1", "turn-1"), {
      signal: new AbortController().signal, recognize: async () => ({ text: "Ore enters the plant" }),
      current: () => ({ scope: "scope", destination: answer }), dispatch
    })).toEqual({ state: "draft", transcript: "Ore enters the plant" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("never turns audio into an approval, method pick or a response to an ambiguous question set", () => {
    expect(dialogueDestination({ ...waiting, status: "waiting_approval" })).toBeUndefined();
    expect(dialogueDestination({ ...waiting, status: "running" })).toBeUndefined();
    expect(dialogueDestination({ ...waiting, status: "running", questions: undefined }))
      .toEqual({ kind: "instruction", runId: "run-1", continuing: true });
    expect(dialogueDestination({ ...waiting, questionSetId: undefined })).toBeUndefined();
    expect(dialogueDestination({ ...waiting, questions: [question, { ...question, id: "second" }] })).toBeUndefined();
    expect(dialogueDestination({ ...waiting, questions: [{ ...question, options: ["Apply", "Decline"] }] })).toBeUndefined();
    expect(dialogueDestination({ ...waiting, questions: [{ ...question, expectedAnswerType: "number" }] })).toMatchObject({ kind: "readback" });
    expect(dialogueDestination({ ...waiting, questions: [{ ...question, freeTextAllowed: false }] })).toBeUndefined();
  });

  it.each(["workspace", "provider", "run", "questionSet", "replayedQuestionId", "hidden", "muted", "manualEdit"])("discards late recognition after %s changes", async change => {
    const turn = new DialogueTurn("project/tree/provider", answer, "speech-1", "turn-1");
    const controller = new AbortController();
    const dispatch = vi.fn(async () => true);
    let complete!: (text: string) => void;
    let current = { scope: turn.scope, destination: answer } as { scope: string; destination: typeof answer } | undefined;
    const result = dispatchFinalDialogueTurn(turn, { signal: controller.signal, dispatch, current: () => current,
      recognize: () => new Promise<string>(resolve => { complete = resolve; }) });
    if (change === "workspace" || change === "provider") current = { ...current!, scope: "other" };
    if (change === "run") current = { ...current!, destination: dialogueDestination({ ...waiting, runId: "run-2" })! };
    if (change === "questionSet") current = { ...current!, destination: dialogueDestination({ ...waiting, questionSetId: "questions-2" })! };
    if (change === "replayedQuestionId") current = { ...current!, destination: dialogueDestination({ ...waiting, questionEventId: "event-2" })! };
    if (change === "hidden") current = undefined;
    if (change === "muted" || change === "manualEdit") controller.abort();
    complete("yes");
    expect(await result).toEqual({ state: "stale" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(["12 tonnes", "Twenty five tonnes", "двадцать пять тонн"])("keeps a number in the draft for a value and unit read-back (%s)", async transcript => {
    const turn = new DialogueTurn("scope", answer, "speech-1", "turn-1");
    const dispatch = vi.fn();
    expect(await dispatchFinalDialogueTurn(turn, {
      signal: new AbortController().signal, recognize: async () => transcript, current: () => ({ scope: "scope", destination: answer }), dispatch
    })).toEqual({ state: "readback", transcript });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("uses a review-only destination and discards speech after a proposal is re-previewed", async () => {
    const proposal = { runId: "run-1", projectId: "project-1", vdtId: "vdt-1", proposalId: "proposal", baseRevisionId: "rev-1", baseRevision: 1 };
    const review = dialogueDestination({ ...waiting, status: "waiting_approval", proposal })!;
    expect(review).toEqual({ kind: "review", runId: "run-1", proposal });
    const dispatch = vi.fn(async () => true);
    const signal = new AbortController().signal;
    const recorded = new DialogueTurn("scope", review, "speech", "turn");
    expect(await dispatchFinalDialogueTurn(recorded, {
      signal, recognize: async () => "yes", dispatch,
      current: () => ({ scope: "scope", destination: dialogueDestination({ ...waiting, status: "waiting_approval", proposal: { ...proposal, baseRevisionId: "rev-2" } }) })
    })).toEqual({ state: "stale" });
    expect(dispatch).not.toHaveBeenCalled();
    expect(await dispatchFinalDialogueTurn(new DialogueTurn("scope", review, "speech", "fresh-turn"), {
      signal, recognize: async () => "no", dispatch, current: () => ({ scope: "scope", destination: review })
    })).toEqual({ state: "sent" });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(review, "no", { sessionId: "speech", turnId: "fresh-turn" });
  });

  it("preserves a failed same-scope send for editing and drops it when scope changed during send", async () => {
    const controller = new AbortController();
    const run = (switchScope: boolean) => {
      const turn = new DialogueTurn("scope", instruction!, "speech-1", "turn-1");
      let scope = "scope";
      return dispatchFinalDialogueTurn(turn, { signal: controller.signal, recognize: async () => "Keep this",
        current: () => ({ scope, destination: instruction }),
        dispatch: async () => { if (switchScope) scope = "other"; throw new Error("network"); } });
    };
    expect(await run(false)).toEqual({ state: "draft", transcript: "Keep this" });
    expect(await run(true)).toEqual({ state: "stale" });
  });
});

it.each(["desktop", "development_web"] as const)("uses guarded speech transport with injected local recognition in %s", async mode => {
  vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", mode);
  const selection = { version: 1, analytics: { mode: "local", providerId: "ollama", modelId: "qwen" },
    scopeId: "project/tree", stt: { providerId: "whisper_local", modelId: "base" }, tts: null, realtime: null, language: "en" } as const;
  const respond = vi.fn(async ({ operation, sessionId }: { operation: string; sessionId?: string }) => {
    if (operation === "open_session") return {
      ...selection, state: "open", sessionId: "guarded",
      stt: { ...selection.stt, boundary: "on_device", billing: "none", credential: { kind: "none" },
        consent: "explicit_component", scope: "bound_voice_session" }
    };
    expect(sessionId).toBe("guarded");
    if (operation === "transcribe") return { state: "complete", text: "Create a throughput tree" };
    if (operation === "close_session") return { state: "closed" };
    throw new Error("Unexpected operation");
  });
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => Response.json(await respond(JSON.parse(String(init.body)))));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("__TAURI__", { core: { invoke: (_command: string, payload: { request: { operation: string } }) => respond(payload.request) } });
  const { signal } = new AbortController();
  const admission = await openSpeechSession(selection, signal);
  try {
    const turn = new DialogueTurn(selection.scopeId, instruction!, admission.sessionId, "fixture-turn");
    const audio = new DialogueUtterance();
    audio.push(new Float32Array(3500).fill(0.03));
    const dispatch = vi.fn(async () => true);
    expect(await dispatchFinalDialogueTurn(turn, {
      signal, recognize: () => transcribeSpeech({ sessionId: turn.sessionId, audioBase64: audioBase64(audio.finish()!) }, signal),
      current: () => ({ scope: selection.scopeId, destination: instruction }), dispatch
    })).toEqual({ state: "sent" });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(instruction, "Create a throughput tree", { sessionId: admission.sessionId, turnId: "fixture-turn" });
  } finally { await closeSpeechSession(admission.sessionId); }
  expect(respond.mock.calls.map(([request]) => request.operation)).toEqual(["open_session", "transcribe", "close_session"]);
  if (mode === "desktop") expect(fetcher).not.toHaveBeenCalled();
});
