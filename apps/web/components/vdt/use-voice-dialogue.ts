"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { kpiCanonicalJson, type VdtProject } from "@vdt-studio/vdt-core";
import type { ExecutionSettings } from "@/lib/execution-mode-catalog";
import { audioBase64, captureMicrophone, type MicrophoneCapture } from "@/lib/live-dictation";
import { closeSpeechSession, openSpeechSession, transcribeSpeechWithProof } from "@/lib/speech-client";
import type { WorkspaceDraftBase } from "@/lib/vdt-storage-client";
import { answerCaptureTarget, DialogueTurn, DialogueUtterance, dispatchFinalDialogueTurn, type DialogueDestination, type DialogueReceipt } from "@/lib/voice-dialogue";
import { useVerifiedVoiceNotifications, type VerifiedVoiceNotificationsOptions } from "./use-verified-voice-notifications";
import type { SpeechSelection, SpeechSessionAdmission } from "@vdt-studio/local-runner/speech-catalog";

import { useSpeechStore } from "./speech-store";

type Phase = "idle" | "starting" | "listening" | "recognizing" | "submitting";
type Selection = {
  scope: string;
  selection: SpeechSelection;
  destination: DialogueDestination | undefined;
  idleApple?: {
    base: WorkspaceDraftBase;
    project: VdtProject;
    executionSettings: ExecutionSettings;
    microphoneKey: string;
    bindingId?: string | undefined;
    verifiedFirstLaunch: boolean;
  } | undefined;
};

interface DialogueOptions {
  selected: () => Selection;
  canCapture?: () => boolean;
  dispatch: (destination: DialogueDestination, text: string, turn: DialogueReceipt) => Promise<boolean>;
  preserve: (text: string) => void;
  speakNotifications?: boolean;
  notifications: Omit<VerifiedVoiceNotificationsOptions, "enabled" | "muted">;
}

interface CaptureTurn {
  id: string;
  selection: Selection;
  controller: AbortController;
  pcm: DialogueUtterance;
  admission?: SpeechSessionAdmission;
  opening?: Promise<SpeechSessionAdmission>;
  capture?: Promise<MicrophoneCapture>;
  timer?: ReturnType<typeof setTimeout>;
  finishing?: boolean;
}

function canRebindIdleApple(previous: Selection, current: Selection): boolean {
  const before = previous.idleApple;
  const after = current.idleApple;
  if (!before || !after?.bindingId || before.microphoneKey !== after.microphoneKey
    || previous.destination?.kind === "review" || current.destination?.kind === "review") return false;

  const settings = before.executionSettings;
  const currentSettings = after.executionSettings;
  const initialDefault = !before.bindingId && settings.analyticalSourceChoice === "untouched"
    && currentSettings.analyticalSourceChoice === "apple_default" && after.verifiedFirstLaunch;
  const unchangedBinding = before.bindingId === after.bindingId && settings === currentSettings;
  if (!unchangedBinding) {
    if (!initialDefault) return false;
    const expectedSettings = { ...settings, analyticalSourceChoice: "apple_default" };
    const keys = Object.keys(expectedSettings) as (keyof ExecutionSettings)[];
    if (keys.length !== Object.keys(currentSettings).length
      || keys.some(key => !Object.is(expectedSettings[key], currentSettings[key]))) return false;
  }

  return (before.base === after.base || kpiCanonicalJson(before.base) === kpiCanonicalJson(after.base))
    && (before.project === after.project || kpiCanonicalJson(before.project) === kpiCanonicalJson(after.project));
}

export function useVoiceDialogue(options: DialogueOptions) {
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedNow = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string>();
  const spokenMuted = useSpeechStore(state => state.spokenMuted);
  const notifications = useVerifiedVoiceNotifications({ ...options.notifications, enabled: enabled || options.speakNotifications === true, muted: spokenMuted });
  const latest = useRef({ ...options, ...notifications });
  latest.current = { ...options, ...notifications };
  const active = useRef<CaptureTurn | undefined>(undefined);
  const lease = useRef<Promise<void> | undefined>(undefined);
  const optedIn = useRef<Selection | undefined>(undefined);

  function release(turn: CaptureTurn) {
    turn.controller.abort();
    clearTimeout(turn.timer);
    setReleasing(true);
    const closeSession = Promise.resolve(turn.opening).then(async () => {
      if (turn.admission) await closeSpeechSession(turn.admission.sessionId);
    });
    const closing = Promise.allSettled([closeSession, turn.capture?.then(capture => capture.stop())]).then(() => {
      if (lease.current !== closing) return;
      latest.current.resume();
      lease.current = undefined;
      setReleasing(false);
    });
    lease.current = closing;
    return closing;
  }

  function cancelTurn() {
    const turn = active.current;
    active.current = undefined;
    if (turn) void release(turn);
    setPhase("idle");
  }

  const deactivate = () => {
    cancelTurn();
    optedIn.current = undefined;
    setEnabled(false);
    mutedNow.current = false;
    setMuted(false);
    latest.current.interrupt();
  };
  const deactivateRef = useRef(deactivate);
  deactivateRef.current = deactivate;

  const scope = options.selected().scope;
  useEffect(() => {
    const previous = optedIn.current;
    if (!previous || previous.scope === scope) return;
    const current = latest.current.selected();
    if (!active.current && phase === "idle" && !document.hidden && current.scope === scope
      && latest.current.notifications.scope === scope && canRebindIdleApple(previous, current)) {
      // The notification owner has already retired the old strict scope.
      // Keep the idle opt-in while giving the next capture a fresh scope.
      optedIn.current = current;
      return;
    }
    deactivateRef.current();
    setError(undefined);
  }, [scope, phase]);

  useEffect(() => {
    const visibility = () => { if (document.hidden) deactivateRef.current(); };
    const pageHide = () => deactivateRef.current();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pageHide);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pageHide);
      optedIn.current = undefined;
      const turn = active.current;
      active.current = undefined;
      if (turn) void release(turn);
      latest.current.interrupt();
    };
  }, []);

  async function finish(turn: CaptureTurn) {
    if (active.current !== turn || turn.finishing) return;
    turn.finishing = true;
    clearTimeout(turn.timer);
    const scopeAtCapture = turn.selection.scope;
    const target = turn.selection.destination;
    const signal = turn.controller.signal;
    try {
      setPhase("recognizing");
      const microphone = await turn.capture;
      await microphone?.stop();
      signal.throwIfAborted();
      const samples = turn.pcm.finish();
      if (!samples || !turn.admission || !target) return;
      const fence = new DialogueTurn(scopeAtCapture, target, turn.admission.sessionId, turn.id);
      const current = () => active.current === turn && turn.admission?.sessionId === fence.sessionId
        && !signal.aborted && !document.hidden && latest.current.canCapture?.() !== false ? latest.current.selected() : undefined;
      const result = await dispatchFinalDialogueTurn(fence, {
        signal,
        recognize: () => transcribeSpeechWithProof({ audioBase64: audioBase64(samples), sessionId: fence.sessionId }, signal),
        current,
        dispatch: async (destination, text, capture) => {
          setPhase("submitting");
          return latest.current.dispatch(destination, text, capture);
        }
      });
      const owner = current();
      if (owner?.scope !== scopeAtCapture || JSON.stringify(owner.destination) !== JSON.stringify(target)) return;
      if (result.state === "readback") {
        latest.current.preserve(result.transcript);
        setError("Review the transcribed value and unit before submitting it.");
      }
      if (result.state === "draft") {
        latest.current.preserve(result.transcript);
        setError(target.kind === "answer" ? "Review the voice answer in the draft and submit it in the question form."
          : "The voice turn could not be sent. Review it in the draft.");
      }
    } catch (failure) {
      if (active.current === turn && !signal.aborted && !document.hidden && latest.current.canCapture?.() !== false
        && latest.current.selected().scope === scopeAtCapture) {
        setError(failure instanceof Error ? failure.message : "The voice turn could not be completed.");
      }
    } finally {
      if (active.current === turn) {
        active.current = undefined;
        await release(turn);
        if (!active.current) setPhase("idle");
      }
    }
  }

  async function record() {
    if (active.current || mutedNow.current || document.hidden || latest.current.canCapture?.() === false) return;
    await lease.current;
    if (active.current || mutedNow.current || document.hidden || latest.current.canCapture?.() === false) return;
    const choice = latest.current.selected();
    if (optedIn.current?.scope !== choice.scope || !choice.destination || !choice.selection.stt) return;
    if (!latest.current.pauseForCapture()) {
      setError("Wait for spoken playback to finish, or interrupt it before speaking.");
      return;
    }
    setError(undefined);
    const turn: CaptureTurn = { id: crypto.randomUUID(), selection: choice, controller: new AbortController(), pcm: new DialogueUtterance() };
    active.current = turn;
    setPhase("starting");
    try {
      turn.opening = openSpeechSession(choice.selection, turn.controller.signal,
        choice.destination.kind === "answer" ? answerCaptureTarget(choice.destination, turn.id) : undefined).then(admission => {
        turn.admission = admission;
        return admission;
      });
      await turn.opening;
      turn.controller.signal.throwIfAborted();
      turn.capture = captureMicrophone(samples => {
        if (active.current !== turn || turn.controller.signal.aborted) return;
        if (turn.pcm.push(samples)) void finish(turn);
      }, turn.controller.signal, () => { if (active.current === turn) cancelTurn(); });
      await turn.capture;
      if (active.current !== turn || turn.finishing) return;
      turn.timer = setTimeout(() => void finish(turn), 10_000);
      setPhase("listening");
    } catch (failure) {
      if (active.current !== turn) return;
      cancelTurn();
      setError(failure instanceof DOMException && failure.name === "NotAllowedError"
        ? "Microphone access was denied. Allow microphone access and try again."
        : failure instanceof Error ? failure.message : "The microphone could not be started.");
    }
  }

  return {
    enabled, muted, spokenMuted, phase, error, active: phase !== "idle", notifications,
    captureBusy: phase !== "idle" || releasing,
    hasCapture: () => Boolean(active.current || lease.current),
    captureToken: () => active.current?.timer && !active.current.finishing ? active.current.id : undefined,
    toggleSpokenMute: () => {
      const voice = useSpeechStore.getState();
      if (!voice.spokenMuted) notifications.interrupt();
      voice.setSpokenMuted(!voice.spokenMuted);
    },
    enable: () => {
      if (latest.current.canCapture?.() === false) return;
      optedIn.current = latest.current.selected();
      setError(undefined);
      setEnabled(true);
    },
    deactivate,
    record,
    finish: () => { if (active.current?.capture) void finish(active.current); },
    toggleMute: () => {
      mutedNow.current = !mutedNow.current;
      if (mutedNow.current) cancelTurn();
      setMuted(mutedNow.current);
    },
    onManualEdit: cancelTurn
  };
}

// Memory-only composer draft cache. A remount can recover its own draft without
// loading drafts from another workspace or persisting transcript content to disk.
const draftCache = new Map<string, string>();

export function useScopedComposerDraft(scope: string) {
  const [, refresh] = useState(0);
  const update = useCallback((change: string | ((previous: string) => string)) => {
    const previous = draftCache.get(scope) ?? "";
    const next = typeof change === "string" ? change : change(previous);
    draftCache.delete(scope);
    if (next) draftCache.set(scope, next);
    if (draftCache.size > 24) draftCache.delete(draftCache.keys().next().value!);
    refresh(value => value + 1);
  }, [scope]);
  return [draftCache.get(scope) ?? "", update] as const;
}
