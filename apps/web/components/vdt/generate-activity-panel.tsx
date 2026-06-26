"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Clock3, Loader2, X } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import type { GenerateActivityState } from "./vdt-store";

function formatElapsed(startedAt: string, completedAt?: string) {
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "0:00";
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatPhase(phase: string) {
  return phase
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(activity: GenerateActivityState) {
  if (activity.status === "ready") return activity.schemaId === "deepen-node-v1" ? "Patch ready" : "VDT ready";
  if (activity.status === "needs_user_input") return "Needs input";
  if (activity.status === "error") return "Needs attention";
  if (activity.status === "cancelled") return "Cancelled";
  if (activity.cancelRequested) return "Cancelling";
  return "Running";
}

function formatMetadata(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function technicalRows(activity: GenerateActivityState): Array<[string, string | undefined]> {
  return [
    ["Backend", activity.backendId],
    ["Provider", activity.providerId],
    ["Schema", activity.schemaId],
    ["Request", activity.requestId],
    ["Agent run", activity.agentRun?.runId],
    ["Agent status", activity.agentRun?.status],
    ["Agent phase", activity.agentRun?.phase],
    ["App mode", activity.appMode],
    ["Model", activity.model],
    ["Output", activity.outputBytes ? `${activity.outputBytes.toLocaleString()} bytes` : undefined],
    ["Schema valid", activity.schemaValid === undefined ? undefined : activity.schemaValid ? "yes" : "no"],
    ["Repair", activity.repairAttempted ? (activity.repairSucceeded ? "succeeded" : "attempted") : undefined],
    ["Timeout", activity.timeoutMs ? `${Math.round(activity.timeoutMs / 1000)}s` : undefined]
  ];
}

export function GenerateActivityPanel({
  activity,
  onCancel
}: {
  activity: GenerateActivityState;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(() => formatElapsed(activity.startedAt, activity.completedAt));
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setElapsed(formatElapsed(activity.startedAt, activity.completedAt));
    if (activity.status !== "running" && activity.status !== "needs_user_input") return undefined;
    const timer = window.setInterval(() => {
      setElapsed(formatElapsed(activity.startedAt));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activity.completedAt, activity.startedAt, activity.status]);

  const events = useMemo(() => activity.agentEvents ?? activity.agentRun?.events ?? [], [activity.agentEvents, activity.agentRun]);
  const selectedSkills = activity.selectedSkills ?? activity.agentRun?.selectedSkills ?? [];
  const questions = activity.questionsForUser ?? activity.agentRun?.questionsForUser ?? [];
  const finalReport = activity.finalReport ?? activity.agentRun?.finalReport;
  const phase = activity.agentRun?.phase ? formatPhase(activity.agentRun.phase) : formatPhase(activity.phase);
  const isWorking = activity.status === "running" || activity.status === "needs_user_input";

  return (
    <section
      className="px-1 py-3"
      data-testid="generate-activity-panel"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {isWorking ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" /> : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">{phase}</div>
            <div className="truncate text-xs text-muted">{activity.providerLabel} - {statusLabel(activity)}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          <span data-testid="generate-activity-elapsed">{elapsed}</span>
        </div>
      </div>

      {activity.message ? (
        <p className={clsx("mt-4 text-sm leading-6", activity.status === "error" ? "text-red-700" : "text-muted")}>
          {activity.message}
        </p>
      ) : null}

      <div className="mt-4 space-y-3" data-testid="generate-agent-events">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">Agent Activity</div>
        {events.length > 0 ? (
          events.map((event) => (
            <article key={event.id} className="border-l border-line pl-3">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold text-ink">{event.title}</div>
                <time className="shrink-0 text-[11px] text-muted" dateTime={event.timestamp}>
                  {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </time>
              </div>
              <p className="mt-1 text-sm leading-6 text-graphite">{event.message}</p>
              {event.metadata ? (
                <dl className="mt-2 grid gap-1 text-xs text-muted">
                  {Object.entries(event.metadata).slice(0, 4).map(([key, value]) => {
                    const formatted = formatMetadata(value);
                    return formatted ? (
                      <div key={key} className="flex gap-2">
                        <dt className="shrink-0 font-medium text-graphite">{key}</dt>
                        <dd className="min-w-0 truncate">{formatted}</dd>
                      </div>
                    ) : null;
                  })}
                </dl>
              ) : null}
            </article>
          ))
        ) : (
          <p className="text-sm leading-6 text-muted">Waiting for runtime events.</p>
        )}
      </div>

      {selectedSkills.length > 0 ? (
        <div className="mt-5" data-testid="generate-selected-skills">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Selected Skills</div>
          <div className="mt-2 space-y-2">
            {selectedSkills.map((skill) => (
              <div key={skill.id} className="text-sm leading-6 text-ink">
                <span className="font-semibold">{skill.id}</span>
                <span className="text-muted"> - {skill.reason}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activity.status === "needs_user_input" && questions.length > 0 ? (
        <div className="mt-5" data-testid="generate-questions">
          <div className="text-sm font-semibold text-ink">Questions</div>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-ink">
            {questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {activity.status === "ready" && finalReport ? (
        <div className="mt-5" data-testid="generate-final-report">
          <div className="text-sm font-semibold text-ink">Final Report</div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink">{finalReport}</p>
        </div>
      ) : activity.status === "ready" && activity.summary ? (
        <div className="mt-5" data-testid="generate-final-report">
          <div className="text-sm font-semibold text-ink">Final Report</div>
          <p className="mt-2 text-sm leading-7 text-ink">{activity.summary}</p>
        </div>
      ) : null}

      <div className="mt-5" data-testid="generate-run-details">
        <button
          type="button"
          className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <ChevronDown
            className={clsx("h-3.5 w-3.5 transition-transform", detailsOpen ? "rotate-180" : undefined)}
            aria-hidden="true"
          />
          Run details
        </button>
        {detailsOpen ? (
          <dl className="mt-3 grid gap-2 text-xs text-muted">
            {technicalRows(activity).map(([label, value]) => value ? (
              <div key={label} className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium text-graphite">{label}</dt>
                <dd className="min-w-0 truncate">{value}</dd>
              </div>
            ) : null)}
            {(activity.details ?? []).map((detail) => (
              <div key={detail.id} className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium text-graphite">{detail.status}</dt>
                <dd className="min-w-0 truncate">{detail.label}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {isWorking ? (
        <div className="mt-5 flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="text-sm text-muted">{activity.status === "needs_user_input" ? "Waiting for input" : "Working"}</span>
          <Button
            size="sm"
            variant="ghost"
            icon={<X className="h-3.5 w-3.5" />}
            className="ml-auto"
            disabled={!activity.canCancel || activity.cancelRequested}
            onClick={onCancel}
            data-testid="cancel-generate"
          >
            {activity.cancelRequested ? "Cancelling" : "Cancel"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
