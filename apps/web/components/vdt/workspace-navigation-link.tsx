"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ComponentProps } from "react";
import { navigateAfterWorkspaceSave } from "./workspace-navigation";
import { useVdtStudioStore } from "./vdt-store";

export function WorkspaceNavigationLink({ href, onSavedNavigate, ...props }: Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & { href: string; onSavedNavigate?: (() => void) | undefined }) {
  const router = useRouter();
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const canReload = useVdtStudioStore(({ workspace }) =>
    Boolean(workspace.activeVdtId && !workspace.draftRevisionBase && !workspace.pendingRevisionCommit)
  );

  async function reloadSavedVersion() {
    const { workspace, selectWorkspaceVdt } = useVdtStudioStore.getState();
    if (saving.current || !workspace.activeVdtId) return;
    saving.current = true;
    setBusy(true);
    try {
      const reloaded = await selectWorkspaceVdt(workspace.activeVdtId, {
        expectedProjectId: workspace.activeProjectId,
        discardLocalEdits: true
      });
      setError(reloaded ? undefined : useVdtStudioStore.getState().workspace.error ?? "The saved version could not be loaded.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return <>
    <Link {...props} href={href} aria-busy={busy} aria-disabled={busy} onNavigate={(event) => {
      event.preventDefault();
      if (saving.current) return;
      saving.current = true;
      setBusy(true);
      setError(undefined);
      void navigateAfterWorkspaceSave(href, useVdtStudioStore.getState(), (destination) => onSavedNavigate ? onSavedNavigate() : router.push(destination))
        .then((navigated) => {
          if (!navigated) setError(useVdtStudioStore.getState().workspace.error ?? "Could not save your changes. Stay in this VDT and retry.");
        })
        .catch(() => setError("Could not save your changes. Stay in this VDT and retry."))
        .finally(() => { saving.current = false; setBusy(false); });
    }} />
    {error ? <div role="alert" data-testid="workspace-navigation-error" className="fixed bottom-5 left-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
      <p>{error}</p>
      {canReload ? <button type="button" disabled={busy} className="mt-2 font-medium underline" onClick={() => void reloadSavedVersion()}>
        Discard local edits and reload
      </button> : null}
    </div> : null}
  </>;
}
