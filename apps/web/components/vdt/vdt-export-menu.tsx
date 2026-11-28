"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { exportProjectJson, exportProjectMarkdown, type VdtProject } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { editorHandoffView, type EditorHandoffAttempt } from "@/lib/editor-handoff-controller";
import { useVdtStudioStore } from "./vdt-store";
import { downloadBinaryFile, getVdtDownloadFilename } from "@/lib/download";

const formats = [
  { extension: "json", label: "JSON", type: "application/json", serialize: exportProjectJson },
  { extension: "md", label: "Markdown", type: "text/markdown", serialize: exportProjectMarkdown }
] as const;
const disclosureId = "vdt-export-formats";

let openedHandoff: EditorHandoffAttempt | undefined;

export function openVdtExportMenu(handoff?: EditorHandoffAttempt): boolean {
  const disclosure = document.getElementById(disclosureId);
  if (!(disclosure instanceof HTMLDetailsElement)) return false;
  openedHandoff?.cancel();
  openedHandoff = handoff;
  disclosure.open = true;
  disclosure.querySelector("summary")?.focus();
  return true;
}

export function VdtExportMenu({ project }: { project: VdtProject }) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const [error, setError] = useState<string>();

  function close() {
    openedHandoff?.cancel();
    openedHandoff = undefined;
    if (disclosure.current) disclosure.current.open = false;
    trigger.current?.focus();
  }

  function download(format: (typeof formats)[number]) {
    try {
      const before = editorHandoffView(useVdtStudioStore.getState());
      if (openedHandoff && (!openedHandoff.matchesOrigin(before) || useVdtStudioStore.getState().project !== project)) {
        openedHandoff.cancel();
        openedHandoff = undefined;
        setError("The draft changed. Reopen the export from the current VDT.");
        return;
      }
      downloadBinaryFile(
        getVdtDownloadFilename(project.name, format.extension),
        new TextEncoder().encode(format.serialize(project)),
        `${format.type};charset=utf-8`
      );
      openedHandoff?.complete(before, editorHandoffView(useVdtStudioStore.getState()), { kind: "portable_download", format: format.extension });
      setError(undefined);
      close();
    } catch {
      setError(`Could not download the VDT as ${format.label}.`);
    }
  }

  return (
    <details id={disclosureId} ref={disclosure} className="relative" onToggle={(event) => {
      if (!event.currentTarget.open) {
        openedHandoff?.cancel();
        openedHandoff = undefined;
      }
    }} onKeyDown={(event) => {
      if (event.key === "Escape" && disclosure.current?.open) {
        event.stopPropagation();
        close();
      }
    }}>
      <summary ref={trigger} aria-label="More export formats" title="More export formats" data-testid="vdt-export-formats"
        className="inline-flex h-8 cursor-pointer list-none items-center gap-2 rounded-[10px] border border-line bg-white px-2 text-xs text-graphite hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">More exports</span>
      </summary>
      <div className="absolute right-0 top-full z-30 mt-2 grid min-w-max gap-1 rounded-lg border border-line bg-white p-2 shadow-lg">
        {formats.map((format) => (
          <Button key={format.extension} type="button" size="sm" variant="ghost" className="justify-start"
            onClick={() => download(format)}>
            Export to {format.label}
          </Button>
        ))}
        {error ? <p className="max-w-44 px-2 py-1 text-xs text-red-700" role="alert">{error}</p> : null}
      </div>
    </details>
  );
}
