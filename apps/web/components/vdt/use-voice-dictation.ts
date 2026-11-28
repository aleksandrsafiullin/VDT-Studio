"use client";

import { useEffect, useRef, useState } from "react";
import { audioBase64, captureMicrophone, emptyMicrophoneLevels, insertDictation, LiveDictationSession, MicrophoneLevelMeter, type MicrophoneCapture } from "@/lib/live-dictation";
import { openAiSpeechCredentialTarget, transcribeOpenAiDictation, type OpenAiSpeechCredentialTarget } from "@/lib/openai-byok-speech-client";
import { closeSpeechSession, keepSpeechSession, openSpeechSession, selectedSpeechAnalytics, speechAnalyticsConnectionKey, transcribeSpeech } from "@/lib/speech-client";
import { DialogueUtterance } from "@/lib/voice-dialogue";
import type { SpeechLanguage, SpeechModelId, SpeechSelection, SpeechSessionAdmission } from "@vdt-studio/local-runner/speech-catalog";

import { useApiKeyStorage } from "./api-key-storage";
import { useSpeechStore } from "./speech-store";
import { useVdtStudioStore } from "./vdt-store";

interface VoiceSession {
  id: string;
  controller: AbortController;
  session: Pick<LiveDictationSession, "push" | "finish" | "cancel">;
  capture?: MicrophoneCapture;
  captureOpening?: Promise<MicrophoneCapture>;
  captureClosing?: Promise<void>;
  admission?: SpeechSessionAdmission;
  opening?: Promise<SpeechSessionAdmission>;
  heartbeat?: ReturnType<typeof setInterval>;
  limit?: ReturnType<typeof setTimeout>;
  selectionKey: string;
  isCurrent?: () => boolean;
  transcribing?: Promise<string | undefined>;
  original: string;
  stopping?: Promise<void>;
}

export type VoiceDictationState = "idle" | "starting" | "listening" | "finishing";

interface OpenAiDictationChoice {
  target: OpenAiSpeechCredentialTarget;
  selection: Parameters<typeof transcribeOpenAiDictation>[2];
  isCurrent: () => boolean;
}

function currentVoiceChoice(): { selection: SpeechSelection; key: string } {
  const { workspace, executionSettings, project } = useVdtStudioStore.getState();
  const { modelId, language, stt } = useSpeechStore.getState();
  const selection: SpeechSelection = {
    version: 1,
    scopeId: JSON.stringify([workspace.activeProjectId ?? null, workspace.activeVdtId ?? null]),
    analytics: selectedSpeechAnalytics(executionSettings),
    language,
    stt: stt === "apple_local" ? { providerId: "apple_local", modelId: "system" }
      : stt === "whisper_local" ? { providerId: "whisper_local", modelId } : null,
    tts: null,
    realtime: null
  };
  return { selection, key: JSON.stringify([selection, workspace.activeVdtId ?? project?.id ?? null, speechAnalyticsConnectionKey(executionSettings)]) };
}

export function useVoiceDictation(onDraft: (draft: string) => void, scopeId: string | undefined) {
  const [state, setState] = useState<VoiceDictationState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [audio, setAudio] = useState(emptyMicrophoneLevels);
  const [recognizing, setRecognizing] = useState(false);
  const current = useRef<VoiceSession | undefined>(undefined);
  const closing = useRef<Promise<void> | undefined>(undefined);
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;

  function closeCapture(active: VoiceSession): Promise<void> | undefined {
    if (active.captureOpening) {
      active.captureClosing ??= active.captureOpening.then(capture => capture.stop());
    }
    return active.captureClosing;
  }

  function release(active: VoiceSession): Promise<void> {
    active.controller.abort();
    active.session.cancel();
    clearInterval(active.heartbeat);
    clearTimeout(active.limit);
    const done = Promise.allSettled([closing.current, closeCapture(active), active.opening, active.transcribing]).then(async () => {
      if (active.admission) await closeSpeechSession(active.admission.sessionId);
    });
    closing.current = done;
    return done;
  }

  function abandon(restore = false) {
    const active = current.current;
    if (!active) return;
    current.current = undefined;
    void release(active);
    if (restore) onDraftRef.current(active.original);
    setState("idle");
    setRecognizing(false);
  }

  useEffect(() => {
    // Subscribe to both owning stores so an execution/scope switch revokes the
    // host session before delayed recognizer callbacks can touch another draft.
    const onSelectionChange = () => {
      const active = current.current;
      if (active && (active.selectionKey !== currentVoiceChoice().key || active.isCurrent?.() === false)) {
        abandon();
        setAudio(emptyMicrophoneLevels());
        setError(undefined);
      }
    };
    const owner = useVdtStudioStore.subscribe((state, previous) => {
      if (current.current?.isCurrent || state.workspace !== previous.workspace || state.executionSettings !== previous.executionSettings
        || state.project.id !== previous.project.id) onSelectionChange();
    });
    const preferences = useSpeechStore.subscribe(onSelectionChange);
    const credentials = useApiKeyStorage.subscribe(() => { if (current.current?.isCurrent) onSelectionChange(); });
    const retireOpenAi = () => { if (current.current?.isCurrent) abandon(); };
    const hidden = () => { if (document.hidden) retireOpenAi(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", retireOpenAi);
    return () => {
      owner();
      preferences();
      credentials();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", retireOpenAi);
      const active = current.current;
      current.current = undefined;
      if (active) void release(active);
    };
  }, []);

  useEffect(() => {
    abandon();
    setError(undefined);
    setAudio(emptyMicrophoneLevels());
  }, [scopeId]);

  function stop(): Promise<void> {
    const active = current.current;
    if (!active) return Promise.resolve();
    if (active.stopping) return active.stopping;
    if (!active.capture) {
      abandon();
      return closing.current ?? Promise.resolve();
    }
    active.stopping = (async () => {
      setState("finishing");
      try {
        await closeCapture(active);
        if (current.current !== active || active.controller.signal.aborted || active.isCurrent?.() === false) return;
        await active.session.finish();
      } catch (failure) {
        if (current.current === active) {
          abandon();
          setError(failure instanceof Error ? failure.message : "Voice input could not be finished. Please retry.");
        }
      } finally {
        if (current.current === active) {
          current.current = undefined;
          void release(active);
          setState("idle");
          setRecognizing(false);
        }
      }
    })();
    return active.stopping;
  }

  async function start(draft: string, selectionStart: number, selectionEnd: number, modelId: SpeechModelId, language: SpeechLanguage) {
    if (current.current) return;
    const { selection, key } = currentVoiceChoice();
    if (!selection.stt || selection.language !== language
      || (selection.stt.providerId === "whisper_local" && selection.stt.modelId !== modelId)) return;
    const controller = new AbortController();
    const session = new LiveDictationSession(
      async (samples, signal) => {
        if (current.current?.session === session) setRecognizing(true);
        const admission = active.admission;
        if (!admission) throw new Error("The voice session is unavailable.");
        try { return await transcribeSpeech({ audioBase64: audioBase64(samples), sessionId: admission.sessionId }, signal); }
        finally { if (current.current?.session === session) setRecognizing(false); }
      },
      (text) => { if (current.current?.session === session) onDraftRef.current(insertDictation(draft, selectionStart, selectionEnd, text)); },
      (failure) => { if (current.current?.session === session) { abandon(); setError(failure.message); } }
    );
    const active: VoiceSession = { id: crypto.randomUUID(), controller, session, original: draft, selectionKey: key };
    await beginCapture(active, async () => {
      active.opening = openSpeechSession(selection, controller.signal);
      active.admission = await active.opening;
      controller.signal.throwIfAborted();
      const sessionId = active.admission.sessionId;
      active.heartbeat = setInterval(() => {
        void keepSpeechSession(sessionId).catch((failure: unknown) => {
          if (current.current !== active) return;
          abandon();
          setError(failure instanceof Error ? failure.message : "The voice session ended. Start dictation again.");
        });
      }, 30_000);
    });
  }

  async function startOpenAi(draft: string, selectionStart: number, selectionEnd: number, choice: OpenAiDictationChoice) {
    if (current.current) return;
    const targetKey = JSON.stringify(choice.target);
    const isCurrent = () => !document.hidden && choice.isCurrent()
      && JSON.stringify(openAiSpeechCredentialTarget(useVdtStudioStore.getState())) === targetKey;
    if (!isCurrent()) return;
    const controller = new AbortController();
    const pcm = new DialogueUtterance();
    const active: VoiceSession = { id: crypto.randomUUID(), controller, original: draft, selectionKey: currentVoiceChoice().key, isCurrent, session: {
      push(samples) { if (pcm.push(samples)) void stop(); },
      cancel() {},
      async finish() {
        const samples = pcm.finish();
        if (!samples || current.current !== active || controller.signal.aborted || !isCurrent()) return;
        setRecognizing(true);
        active.transcribing = transcribeOpenAiDictation(choice.target, samples, choice.selection, controller.signal,
          () => current.current === active && isCurrent());
        const text = await active.transcribing;
        if (text && current.current === active && isCurrent()) {
          onDraftRef.current(insertDictation(draft, selectionStart, selectionEnd, text));
        }
      }
    } };
    await beginCapture(active);
  }

  async function beginCapture(active: VoiceSession, admit?: () => Promise<void>) {
    setError(undefined);
    setAudio(emptyMicrophoneLevels());
    setRecognizing(false);
    setState("starting");
    const { controller, session } = active;
    const meter = new MicrophoneLevelMeter();
    current.current = active;
    try {
      await closing.current;
      controller.signal.throwIfAborted();
      if (active.isCurrent?.() === false) { abandon(); return; }
      await admit?.();
      controller.signal.throwIfAborted();
      active.captureOpening = captureMicrophone((samples) => {
        if (current.current !== active || controller.signal.aborted) return;
        if (active.isCurrent?.() === false) { abandon(); return; }
        const feedback = meter.push(samples);
        if (feedback) setAudio(feedback);
        session.push(samples);
      }, controller.signal, () => { void stop(); });
      active.capture = await active.captureOpening;
      if (current.current !== active || controller.signal.aborted) { await closeCapture(active); return; }
      if (active.isCurrent?.() === false) { abandon(); return; }
      if (active.isCurrent) active.limit = setTimeout(() => { void stop(); }, 10_000);
      setState("listening");
    } catch (failure) {
      if (current.current !== active) return;
      abandon();
      setError(failure instanceof DOMException && failure.name === "NotAllowedError"
        ? "Microphone access was denied. Allow microphone access for VDT Studio and try again."
        : failure instanceof Error ? failure.message : "The microphone could not be started.");
    }
  }

  return { state, error, audio, recognizing, active: state !== "idle", openAi: Boolean(current.current?.isCurrent),
    hasCapture: () => current.current !== undefined, captureToken: () => current.current?.capture && !current.current.stopping ? current.current.id : undefined, waitForRelease: () => closing.current, start, startOpenAi, stop, cancel: () => abandon(true), onManualEdit: () => abandon(), clearError: () => setError(undefined) };
}
