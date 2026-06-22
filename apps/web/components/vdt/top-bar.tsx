"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Download, FileImage, FileJson, GitBranch, ShieldCheck, Sparkles, Upload } from "lucide-react";
import {
  calculateGraph,
  exportProjectJson,
  exportProjectMarkdown,
  exportProjectSvg,
  importProjectJson,
  validateGraph
} from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { downloadTextFile } from "@/lib/download";
import { formatNumber } from "@/lib/format";
import { SettingsModal } from "./settings-modal";
import { VersionHistoryPanel } from "./version-history-panel";
import { useVdtStudioStore } from "./vdt-store";

export function TopBar() {
  const project = useVdtStudioStore((state) => state.project);
  const replaceProject = useVdtStudioStore((state) => state.replaceProject);
  const runAiAction = useVdtStudioStore((state) => state.runAiAction);
  const isRunningAiAction = useVdtStudioStore((state) => state.isRunningAiAction);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string>();
  const calculation = calculateGraph(project);
  const validation = validateGraph(project.graph, project.rootNodeId);
  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);

  async function handleProjectImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const importedProject = importProjectJson(await file.text());
      replaceProject(importedProject);
      setImportError(undefined);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Project JSON could not be imported.");
    }
  }

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-white px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
          <GitBranch className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-ink">{project.name}</h1>
          <p className="truncate text-xs text-muted">
            {rootNode?.name ?? project.rootNodeId}: {formatNumber(calculation.rootValue)} {rootNode?.unit ?? ""}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded-md border border-line bg-slate-50 px-3 py-1.5 text-xs font-medium text-muted md:flex">
          <ShieldCheck className="h-4 w-4 text-teal" />
          {validation.valid ? "Model graph valid" : `${validation.errors.length} graph issues`}
        </div>
        <Button
          size="sm"
          data-testid="review-model-button"
          icon={<Sparkles className="h-4 w-4" />}
          disabled={isRunningAiAction}
          onClick={() => void runAiAction("review_model", {})}
        >
          <span className="hidden sm:inline">Review model</span>
        </Button>
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept=".json,application/json"
          onChange={(event) => void handleProjectImport(event)}
        />
        <Button
          size="sm"
          aria-label="Import"
          icon={<Upload className="h-4 w-4" />}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="hidden sm:inline">Import</span>
        </Button>
        <Button
          size="sm"
          aria-label="JSON"
          icon={<FileJson className="h-4 w-4" />}
          onClick={() => downloadTextFile(`${project.id}.json`, exportProjectJson(project), "application/json")}
        >
          <span className="hidden sm:inline">JSON</span>
        </Button>
        <Button
          size="sm"
          aria-label="SVG"
          icon={<FileImage className="h-4 w-4" />}
          onClick={() => downloadTextFile(`${project.id}.svg`, exportProjectSvg(project), "image/svg+xml")}
        >
          <span className="hidden sm:inline">SVG</span>
        </Button>
        <Button
          size="sm"
          aria-label="Markdown"
          icon={<Download className="h-4 w-4" />}
          onClick={() => downloadTextFile(`${project.id}.md`, exportProjectMarkdown(project), "text/markdown")}
        >
          <span className="hidden sm:inline">Markdown</span>
        </Button>
        <VersionHistoryPanel />
        <SettingsModal />
      </div>
      {importError ? (
        <div
          className="absolute right-4 top-12 z-20 max-w-[420px] rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 shadow-sm"
          role="alert"
        >
          {importError}
        </div>
      ) : null}
    </header>
  );
}
