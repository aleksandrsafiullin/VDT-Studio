"use client";

import { useId, type ReactNode, type Ref } from "react";
import { LoaderCircle, Mic, MicOff, Pause, Square, Volume2, VolumeX, X } from "lucide-react";
import type { useVoiceDialogue } from "./use-voice-dialogue";
import styles from "./agent-chat.module.css";

type VoiceDialogue = ReturnType<typeof useVoiceDialogue>;
type Dialogue = Pick<VoiceDialogue, "phase" | "active" | "muted" | "spokenMuted" | "error" | "finish" | "toggleMute" | "toggleSpokenMute">
  & { notifications: Pick<VoiceDialogue["notifications"], "playback" | "status" | "interrupt"> };

function VoiceIcon({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={styles.iconButton} title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

export function SpokenUpdateControls({ dialogue, showError = false }: {
  dialogue: Pick<Dialogue, "notifications" | "spokenMuted" | "toggleSpokenMute">;
  showError?: boolean;
}) {
  return <>
    <VoiceIcon label={dialogue.spokenMuted ? "Unmute spoken updates" : "Mute spoken updates"} onClick={dialogue.toggleSpokenMute}>
      {dialogue.spokenMuted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
    </VoiceIcon>
    {dialogue.notifications.playback === "speaking" ? <VoiceIcon label="Interrupt playback" onClick={dialogue.notifications.interrupt}>
      <Pause size={14} aria-hidden="true" />
    </VoiceIcon> : null}
    {showError && dialogue.notifications.playback === "error" ? <p role="status" className={styles.dialogueStatus}>Could not play the spoken update.</p> : null}
  </>;
}

export function VoiceConversationControls({ dialogue, ready, canSpeak, hasSynthesis, question = false, controlsRef, primaryRef, onSpeak, onEnd }: {
  dialogue: Dialogue;
  ready: boolean;
  canSpeak: boolean;
  hasSynthesis: boolean;
  question?: boolean;
  onSpeak: () => void;
  onEnd: () => void;
  controlsRef?: Ref<HTMLDivElement> | undefined;
  primaryRef?: Ref<HTMLButtonElement> | undefined;
}) {
  const statusId = useId();
  const listening = dialogue.phase === "listening";
  const speaking = dialogue.notifications.playback === "speaking";
  const busy = dialogue.active && !listening;
  let status: string;
  switch (dialogue.phase) {
    case "starting": status = "Opening the microphone…"; break;
    case "listening": status = "Listening. Stop speaking or select Finish."; break;
    case "recognizing": status = "Transcribing on this computer…"; break;
    case "submitting": status = "Sending your voice turn…"; break;
    default: status = speaking ? "Playing spoken update…" : dialogue.notifications.playback === "error"
      ? question ? "Could not play the spoken question." : "Could not play the spoken update."
      : dialogue.muted ? "Microphone muted."
      : !ready ? "Voice input is unavailable." : !canSpeak ? dialogue.notifications.status.text : "Ready to listen.";
  }
  const primaryLabel = listening ? question ? "Finish answer" : "Finish turn" : question ? "Speak your answer" : "Speak";
  return <div ref={controlsRef} tabIndex={-1} role="group" aria-label={question ? "Voice answer" : "Voice conversation"}
    className={styles.dialogueControls} data-testid={question ? "agent-question-voice" : "agent-voice-dialogue"}>
    <div className={styles.dialogueActions}>
      <button ref={primaryRef} type="button" className={styles.dialoguePrimary} aria-describedby={statusId}
        disabled={!listening && (!ready || !canSpeak || busy || dialogue.muted || speaking)}
        data-testid="agent-dialogue-primary" onClick={listening ? dialogue.finish : onSpeak}>
        {listening ? <Square size={13} fill="currentColor" aria-hidden="true" />
          : busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
        {primaryLabel}
      </button>
      <div className={styles.dialogueUtilities}>
        <VoiceIcon label={dialogue.muted ? "Unmute microphone" : "Mute microphone"} onClick={dialogue.toggleMute}>
          {dialogue.muted ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
        </VoiceIcon>
        {hasSynthesis ? <SpokenUpdateControls dialogue={dialogue} /> : null}
        <VoiceIcon label="End voice conversation" onClick={onEnd}><X size={16} aria-hidden="true" /></VoiceIcon>
      </div>
    </div>
    <p id={statusId} role="status" className={styles.dialogueStatus}>{status}</p>
    {dialogue.error ? <p className="text-xs text-red-700" role="alert">{dialogue.error}</p> : null}
  </div>;
}
