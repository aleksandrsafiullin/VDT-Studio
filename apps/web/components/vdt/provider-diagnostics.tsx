"use client";

import { clsx } from "clsx";
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import type { ProviderTestStatus } from "./vdt-store";

export const PROVIDER_USAGE_LIMITS_COPY =
  "Usage and limits are managed by the provider and depend on the user's plan, selected model, and current provider policy.";

interface ProviderTestStatusBannerProps {
  status: ProviderTestStatus;
  testId?: string;
  className?: string;
}

export function ProviderTestStatusBanner({ status, testId = "provider-test-status", className }: ProviderTestStatusBannerProps) {
  return (
    <div
      className={clsx(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-5",
        status.kind === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : status.kind === "info"
            ? "border-slate-200 bg-slate-50 text-slate-700"
            : "border-red-200 bg-red-50 text-red-700",
        className
      )}
      role="status"
      aria-live="polite"
      data-testid={testId}
    >
      {status.kind === "success" ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      ) : status.kind === "info" ? (
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>{status.message}</span>
    </div>
  );
}

interface ProviderUsageNoteProps {
  className?: string;
  testId?: string;
  message?: string;
}

export function ProviderUsageNote({
  className,
  testId = "provider-usage-note",
  message = PROVIDER_USAGE_LIMITS_COPY
}: ProviderUsageNoteProps) {
  return (
    <p className={clsx("text-xs leading-5 text-muted", className)} data-testid={testId}>
      {message}
    </p>
  );
}
