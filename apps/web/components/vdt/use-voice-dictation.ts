"use client";

import { useEffect, useRef, useState } from "react";
import { audioBase64, captureMicrophone, emptyMicrophoneLevels, insertDictation, LiveDictationSession, MicrophoneLevelMeter, type MicrophoneCapture } from "@/lib/live-dictation";
import { transcribeSpeech } from "@/lib/speech-client";
import type { SpeechLanguage, SpeechModelId } from "@vdt-studio/local-runner/speech-catalog";

interface VoiceSession {
  controller: AbortController;
  session: LiveDictationSession;
  capture?: MicrophoneCapture;
  original: string;
  stopping?: Promise<void>;
}

export type VoiceDictationState = "idle" | "starting" | "listening" | "finishing";

export function useVoiceDictation(onDraft: (draft: string) => void, scopeId: string | undefined) {
  const [state, setState] = useState<VoiceDictationState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [audio, setAudio] = useState(emptyMicrophoneLevels);
  const [recognizing, setRecognizing] = useState(false);
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
    setRecognizing(false);
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
  useEffect(() => { setState("idle"); setError(undefined); setAudio(emptyMicrophoneLevels()); setRecognizing(false); }, [scopeId]);

  function stop(): Promise<void> {
    const active = current.current;
    if (!active) return Promise.resolve();
    if (active.stopping) return active.stopping;
    active.stopping = (async () => {
      setState("finishing");
      try {
        await active.capture?.stop();
        await active.session.finish();
      } catch (failure) {
        if (current.current === active) {
          abandon();
          setError(failure instanceof Error ? failure.message : "Voice input could not be finished. Please retry.");
        }
      } finally {
        if (current.current === active) {
          current.current = undefined;
          active.controller.abort();
          setState("idle");
          setRecognizing(false);
        }
      }
    })();
    return active.stopping;
  }

  async function start(draft: string, selectionStart: number, selectionEnd: number, modelId: SpeechModelId, language: SpeechLanguage) {
    if (current.current) return;
    setError(undefined);
    setAudio(emptyMicrophoneLevels());
    setRecognizing(false);
    setState("starting");
    const controller = new AbortController();
    const session = new LiveDictationSession(
      async (samples, signal) => {
        if (current.current?.session === session) setRecognizing(true);
        try { return await transcribeSpeech({ audioBase64: audioBase64(samples), modelId, language }, signal); }
        finally { if (current.current?.session === session) setRecognizing(false); }
      },
      (text) => { if (current.current?.session === session) onDraftRef.current(insertDictation(draft, selectionStart, selectionEnd, text)); },
      (failure) => { if (current.current?.session === session) { abandon(); setError(failure.message); } }
    );
    const active: VoiceSession = { controller, session, original: draft };
    const meter = new MicrophoneLevelMeter();
    current.current = active;
    try {
      active.capture = await captureMicrophone((samples) => {
        if (current.current !== active || controller.signal.aborted) return;
        const feedback = meter.push(samples);
        if (feedback) setAudio(feedback);
        session.push(samples);
      }, controller.signal, () => { void stop(); });
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

  return { state, error, audio, recognizing, active: state !== "idle", start, stop, cancel: () => abandon(true), onManualEdit: () => abandon(), clearError: () => setError(undefined) };
}
