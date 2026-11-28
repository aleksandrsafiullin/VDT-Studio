"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createAgentClient } from "@/lib/agent-client";
import { VoiceEventFeed, VoiceNotificationQueue, type VoicePlayback, type VoiceSynthesis } from "@/lib/voice-notification-queue";
import { isDismissedVoiceQuestion, projectCurrentVoiceReadback, projectVoiceSnapshot, recoverLiveVoiceQuestion, voiceRunStatus, type VoiceNotification, type VoiceRunEvent, type VoiceRunSnapshot } from "@/lib/voice-notifications";

export interface VerifiedVoiceNotificationsOptions {
  /** Dispose audio whenever project, VDT, revision or provider ownership changes. */
  scope: string;
  /** Stable only across an independently verified, byte-identical workspace refresh. */
  observationScope?: string | undefined;
  runId: string | null | undefined;
  snapshot: VoiceRunSnapshot | undefined;
  canonicalQuestionsOnly?: boolean;
  enabled: boolean;
  muted: boolean;
  locale: string;
  /** Null unless the user explicitly granted verified synthesis. */
  synthesis: VoiceSynthesis | null;
  currentReadbackOnly?: boolean;
  /** Live owner check, including state changes ahead of React rendering. */
  canPlay?: () => boolean;
}

export function useVerifiedVoiceNotifications({
  scope, observationScope = scope, runId, snapshot, enabled, muted, locale, synthesis,
  canonicalQuestionsOnly = false, currentReadbackOnly = false, canPlay
}: VerifiedVoiceNotificationsOptions) {
  const latest = useRef({ snapshot, runId });
  const observation = useRef<{
    since: number;
    initialRunId: typeof runId;
    currentRun: { id: string; recover: boolean; questionSnapshot?: VoiceRunSnapshot } | undefined;
    visitedRuns: Set<string>;
    questionKeys: Set<string>;
  } | undefined>(undefined);
  const paused = useRef(false);
  const owner = useRef<{
    apply(snapshot: VoiceRunSnapshot | undefined): void;
    authorized(): boolean;
    queue: VoiceNotificationQueue;
  } | undefined>(undefined);
  const [playback, setPlayback] = useState<VoicePlayback>("idle");
  const observing = enabled && !muted && synthesis !== null && Boolean(scope);
  const active = observing && Boolean(runId);

  useEffect(() => { latest.current = { snapshot, runId }; }, [snapshot, runId]);
  useEffect(() => {
    // Begin observing before a spoken instruction has returned its run ID.
    observation.current = observing ? {
      since: Date.now(), initialRunId: latest.current.runId, currentRun: undefined,
      visitedRuns: new Set(), questionKeys: new Set()
    } : undefined;
  }, [observing, observationScope, locale]);
  useEffect(() => {
    setPlayback("idle");
    const observed = observation.current;
    if (!observed) return;
    if (!active || !runId || !synthesis) {
      observed.currentRun = undefined;
      return;
    }
    if (observed.currentRun?.id !== runId) {
      observed.currentRun = { id: runId, recover: !observed.visitedRuns.has(runId) };
      observed.visitedRuns.add(runId);
      if (observed.visitedRuns.size > 8_192) observed.visitedRuns.delete(observed.visitedRuns.values().next().value!);
    }
    const runObservation = observed.currentRun;
    const currentSnapshot = latest.current.snapshot;
    let previous = currentSnapshot?.runId === runId ? currentSnapshot : undefined;
    let previousReadback: VoiceNotification | undefined;
    const adoptQuestionSnapshot = (next: VoiceRunSnapshot | undefined) => {
      if (!next || (next.events.at(-1)?.seq ?? 0) < (runObservation.questionSnapshot?.events.at(-1)?.seq ?? 0)) return false;
      runObservation.questionSnapshot = next;
      return true;
    };
    adoptQuestionSnapshot(previous);
    const remember = (key: string) => {
      observed.questionKeys.add(key);
      if (observed.questionKeys.size > 8_192) observed.questionKeys.delete(observed.questionKeys.values().next().value!);
    };
    const authorized = () => canPlay?.() !== false;
    const queue = new VoiceNotificationQueue({
      speak: async (notification, signal) => {
        if (!authorized()) return;
        if (notification.kind === "question") {
          if (observed.questionKeys.has(notification.key) || isDismissedVoiceQuestion(runObservation.questionSnapshot, notification.key, locale)) return;
          remember(notification.key);
        }
        return synthesis.speak(notification, signal);
      }
    }, setPlayback);
    if (paused.current) queue.pause();
    const feed = new VoiceEventFeed(runId, Date.now(), previous?.events);
    const push = (items: readonly VoiceNotification[], confirmedQuestion = false) => {
      queue.push(items.filter(item => item.kind !== "question"
        || ((!canonicalQuestionsOnly || confirmedQuestion) && !observed.questionKeys.has(item.key)
          && !isDismissedVoiceQuestion(runObservation.questionSnapshot, item.key, locale))));
    };
    const recover = (next: VoiceRunSnapshot | undefined) => {
      const question = recoverLiveVoiceQuestion(next, runId, locale, observed.since, observed.initialRunId !== runId, canonicalQuestionsOnly);
      if (question) push([question], true);
    };
    const pending: VoiceRunEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const flush = () => {
      timer = undefined;
      if (!disposed) push(feed.take(pending.splice(0), locale));
    };
    const receive = (event: VoiceRunEvent) => {
      if (disposed || event.runId !== runId) return;
      pending.push(event);
      timer ??= setTimeout(flush, 30);
    };
    const apply = (next: VoiceRunSnapshot | undefined) => {
      if (currentReadbackOnly) {
        const current = next?.runId === runId ? projectCurrentVoiceReadback(next, locale) : undefined;
        if (previousReadback && (previousReadback.key !== current?.key || previousReadback.text !== current?.text)) {
          queue.dismiss(previousReadback.kind === "question" ? "question" : "approval");
        }
        previousReadback = current;
        if (current) queue.push([current]);
        return;
      }
      if (!next || next.runId !== runId || previous === next) return;
      const old = previous;
      previous = next;
      const questionEvent = (value: VoiceRunSnapshot | undefined) => value?.events.slice().reverse().find(event => event.type === "clarifying_questions")?.id;
      const priorQuestion = runObservation.questionSnapshot;
      const currentQuestion = adoptQuestionSnapshot(next);
      if (currentQuestion) {
        if (priorQuestion?.status === "needs_user_input" && (next.status !== "needs_user_input" || questionEvent(priorQuestion) !== questionEvent(next))) {
          const dismissed = recoverLiveVoiceQuestion(priorQuestion, runId, locale, observed.since, false, canonicalQuestionsOnly);
          if (dismissed) remember(dismissed.key);
          queue.dismiss("question");
        }
      }
      const proposalChanged = old?.pendingMutationProposal?.id !== next.pendingMutationProposal?.id
        || old?.pendingMutationProposal?.baseRevisionId !== next.pendingMutationProposal?.baseRevisionId;
      if (old?.status === "waiting_approval" && (next.status !== "waiting_approval" || proposalChanged)) queue.dismiss("approval");
      push(feed.take([...pending.splice(0), ...next.events], locale));
      if (runObservation.recover && currentQuestion) recover(next);
      const current = voiceRunStatus(next, locale);
      const prior = voiceRunStatus(old, locale);
      if (next.status === "running" && current.nodeCount !== null && current.nodeCount !== prior.nodeCount) {
        queue.push([{ key: `${runId}:count:${next.events.at(-1)?.seq ?? 0}:${current.nodeCount}`,
          kind: "progress", priority: "progress", text: current.text }]);
      }
      if (old?.status !== next.status || old?.finishOutcome !== next.finishOutcome
        || proposalChanged) {
        queue.push(projectVoiceSnapshot(next, locale));
      }
    };
    owner.current = { queue, apply, authorized };
    const unsubscribe = currentReadbackOnly ? undefined : createAgentClient().subscribe(runId, { onEvent: receive, onCanonicalEvent: receive });
    if (currentReadbackOnly) apply(previous);
    else if (runObservation.recover) recover(runObservation.questionSnapshot);
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe?.();
      queue.dispose();
      owner.current = undefined;
    };
  }, [active, canonicalQuestionsOnly, currentReadbackOnly, locale, observationScope, runId, scope, synthesis]);
  useEffect(() => { owner.current?.apply(snapshot); }, [snapshot]);

  const reviewReadback = useCallback((key: string, text: string) => {
    if (!currentReadbackOnly && owner.current?.authorized()) owner.current.queue.push([{ key: `review:${key}`, kind: "approval", priority: "urgent", text }]);
  }, [currentReadbackOnly]);
  const interrupt = useCallback(() => owner.current?.queue.interrupt(), []);
  const pause = useCallback(() => { paused.current = true; owner.current?.queue.pause(); }, []);
  const pauseForCapture = useCallback(() => {
    if (owner.current && !owner.current.queue.pauseForCapture()) return false;
    paused.current = true;
    return true;
  }, []);
  const resume = useCallback(() => {
    paused.current = false;
    const current = owner.current;
    if (!current) return;
    if (!current.authorized()) current.queue.interrupt();
    current.queue.resume();
  }, []);
  return {
    playback: active ? playback : "idle" as const,
    status: voiceRunStatus(snapshot?.runId === runId ? snapshot : undefined, locale),
    interrupt, pause, pauseForCapture, resume, reviewReadback
  };
}
