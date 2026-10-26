"use client";

import Link from "next/link";
import { ArrowLeft, Folder, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProjectWorkspaceRouteState({ error, onRetry }: {
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <main className="vdt-apple-workspace flex min-h-screen flex-col bg-apple-gray text-ink" aria-busy={!error} data-testid={error ? "project-workspace-error" : "project-workspace-loading"}>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-black/5 bg-white/70 px-5 backdrop-blur-xl">
        <Link href="/" aria-label="Back to projects" title="Back to projects" data-testid="back-to-projects" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-graphite hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
          <Folder className="h-4 w-4" />
        </span>
        <h1 className="text-[15px] font-medium tracking-tight">Project workspace</h1>
      </header>
      <section className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-black/5 bg-white/80 p-8 shadow-glass">
          {error ? (
            <>
              <h2 className="text-xl font-semibold tracking-tight">Could not open project</h2>
              <p role="alert" className="mt-3 text-sm leading-6 text-muted">{error}</p>
              <div className="mt-6 flex flex-wrap items-center gap-4">
                {onRetry ? <Button type="button" variant="primary" className="rounded-full px-5" onClick={onRetry}>Retry</Button> : null}
                <Link href="/" className="text-sm font-medium text-accent hover:underline">Back to projects</Link>
              </div>
            </>
          ) : (
            <>
              <p role="status" className="flex items-center gap-3 text-base font-medium">
                <Loader2 className="h-5 w-5 text-accent motion-safe:animate-spin" aria-hidden="true" />
                Loading project…
              </p>
              <div aria-hidden="true" className="mt-6 space-y-3 motion-safe:animate-pulse">
                <div className="h-4 w-3/4 rounded-md bg-slate-200/70" />
                <div className="h-4 w-full rounded-md bg-slate-200/50" />
                <div className="h-4 w-1/2 rounded-md bg-slate-200/50" />
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
