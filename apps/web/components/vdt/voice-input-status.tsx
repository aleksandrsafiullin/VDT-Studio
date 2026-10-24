"use client";

import { useEffect, useState } from "react";
import { CircleAlert, LoaderCircle, Square, X } from "lucide-react";
import type { MicrophoneLevels } from "@/lib/live-dictation";
import type { VoiceDictationState } from "./use-voice-dictation";
import styles from "./agent-chat.module.css";

export function formatVoiceDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

interface VoiceInputStatusProps {
  state: VoiceDictationState;
  error?: string | undefined;
  audio: MicrophoneLevels;
  recognizing: boolean;
  onStop: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}

export function VoiceInputStatus({ state, error, audio, recognizing, onStop, onCancel, onDismiss }: VoiceInputStatusProps) {
  const [processingMs, setProcessingMs] = useState(0);
  useEffect(() => {
    setProcessingMs(0);
    if (state !== "finishing") return;
    const started = Date.now();
    const timer = setInterval(() => setProcessingMs(Date.now() - started), 500);
    return () => clearInterval(timer);
  }, [state]);

  if (state === "idle" && !error) return null;
  if (error) {
    return <div className={styles.voiceError} data-testid="voice-input-status">
      <CircleAlert size={16} aria-hidden="true" />
      <div role="alert"><strong>Voice input stopped</strong><p>{error}</p></div>
      <button type="button" className={styles.iconButton} aria-label="Dismiss voice input error" onClick={onDismiss}><X size={14} aria-hidden="true" /></button>
    </div>;
  }

  const listening = state === "listening";
  const finishing = state === "finishing";
  const label = listening ? "Listening" : finishing ? "Transcribing audio…" : "Opening microphone…";
  const hint = finishing
    ? "Recording stopped. Finishing the last phrase locally."
    : state === "starting"
      ? "Allow microphone access to begin."
      : !audio.hasSpeech && audio.elapsedMs >= 3000
        ? "No speech detected yet. Check your microphone."
        : recognizing ? "Recognizing speech locally…" : "Words appear below as phrases are recognized.";

  return <section className={styles.voiceFeedback} data-testid="voice-input-status" data-voice-state={state} aria-label="Voice dictation">
    <div className={styles.voiceHeading}>
      <span className={styles.voiceState} role="status">
        {listening ? <span className={styles.recordingDot} aria-hidden="true" /> : <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />}
        {label}
      </span>
      <span className={styles.voiceDuration} aria-label={finishing ? "Transcription elapsed time" : "Recording duration"}>
        {formatVoiceDuration(finishing ? processingMs : audio.elapsedMs)}
      </span>
      <button type="button" className={styles.voiceAction} aria-label="Cancel dictation" title="Cancel dictation and restore the original draft" onClick={onCancel}><X size={13} aria-hidden="true" /></button>
    </div>
    {state !== "starting" ? <div className={styles.voiceSignal}>
      <div className={styles.voiceWaveform} role="img" aria-label={listening ? "Live microphone audio level" : "Recorded microphone audio levels"}>
        {audio.levels.map((level, index) => <span key={index} style={{ height: `${3 + Math.max(0, Math.min(1, level)) * 29}px` }} />)}
      </div>
      {listening ? <button type="button" className={styles.voiceFinish} onClick={onStop} aria-label="Finish recording" title="Stop recording and finish transcription"><Square size={11} fill="currentColor" aria-hidden="true" /></button> : null}
    </div> : null}
    <p className={styles.voiceHint}>{hint}</p>
  </section>;
}
