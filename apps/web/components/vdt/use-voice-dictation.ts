"use client";

import { useEffect, useRef, useState } from "react";
import { audioBase64, captureMicrophone, insertDictation, LiveDictationSession, type MicrophoneCapture } from "@/lib/live-dictation";
import { transcribeSpeech } from "@/lib/speech-client";
import type { SpeechLanguage, SpeechModelId } from "@vdt-studio/local-runner/speech-catalog";

interface VoiceSession {
  controller: AbortController;
  session: LiveDictationSession;
  capture?: MicrophoneCapture;
  original: string;
}

export function useVoiceDictation(onDraft: (draft: string) => void, scopeId: string | undefined) {
  const [state, setState] = useState<"idle" | "starting" | "listening" | "finishing">("idle");
  const [error, setError] = useState<string | undefined>();
  const current = useRef<VoiceSession | undefined>(undefined);
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;

  function abandon(restore = false) {
    const active = current.current;
    if (!active) return;
    current.current = undefined;
    active.controller.abort();
    active.session.cancel();
    void active.capture?.stop();
    if (restore) onDraftRef.current(active.original);
    setState("idle");
  }

  useEffect(() => {
    return () => {
      const active = current.current;
      current.current = undefined;
      active?.controller.abort();
      active?.session.cancel();
      void active?.capture?.stop();
    };
  }, [scopeId]);

  // Losing the owning VDT stops capture, even if the composer stays mounted.
  useEffect(() => { setState("idle"); }, [scopeId]);

  async function stop() {
    const active = current.current;
    if (!active) return;
    setState("finishing");
    await active.capture?.stop();
    await active.session.finish();
    if (current.current === active) { current.current = undefined; active.controller.abort(); setState("idle"); }
  }

  async function start(draft: string, selectionStart: number, selectionEnd: number, modelId: SpeechModelId, language: SpeechLanguage) {
    if (current.current) return;
    setError(undefined);
    setState("starting");
    const controller = new AbortController();
    const session = new LiveDictationSession(
      (audio, signal) => transcribeSpeech({ audioBase64: audioBase64(audio), modelId, language }, signal),
      (text) => { if (current.current?.session === session) onDraftRef.current(insertDictation(draft, selectionStart, selectionEnd, text)); },
      (failure) => { if (current.current?.session === session) { abandon(); setError(failure.message); } }
    );
    const active: VoiceSession = { controller, session, original: draft };
    current.current = active;
    try {
      active.capture = await captureMicrophone((audio) => session.push(audio), controller.signal, () => { void stop(); });
      if (current.current !== active || controller.signal.aborted) { await active.capture.stop(); return; }
      setState("listening");
    } catch (failure) {
      if (current.current !== active) return;
      abandon();
      setError(failure instanceof DOMException && failure.name === "NotAllowedError"
        ? "Microphone access was denied. Allow microphone access for VDT Studio and try again."
        : failure instanceof Error ? failure.message : "The microphone could not be started.");
    }
  }

  return { state, error, active: state !== "idle", start, stop, cancel: () => abandon(true), onManualEdit: () => abandon(), clearError: () => setError(undefined) };
}
