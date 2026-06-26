"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, FileImage, FileJson, GitBranch, Route, ShieldCheck, Sparkles, Upload } from "lucide-react";
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
import { ScenarioModal } from "./scenario-modal";
import { SettingsModal } from "./settings-modal";
import { VersionHistoryPanel } from "./version-history-panel";
import { useVdtStudioStore } from "./vdt-store";

const exportMenuItemClass =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-graphite hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function TopBar() {
  const project = useVdtStudioStore((state) => state.project);
  const replaceProject = useVdtStudioStore((state) => state.replaceProject);
  const runAiAction = useVdtStudioStore((state) => state.runAiAction);
  const isRunningAiAction = useVdtStudioStore((state) => state.isRunningAiAction);
  const activeScenarioId = useVdtStudioStore((state) => state.activeScenarioId);
  const scenarioModalOpen = useVdtStudioStore((state) => state.scenarioModalOpen);
  const openScenarioModal = useVdtStudioStore((state) => state.openScenarioModal);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scenarioModalTriggerRef = useRef<HTMLButtonElement>(null);
  const [importError, setImportError] = useState<string>();
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  useEffect(() => {
    if (!exportMenuOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExportMenuOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [exportMenuOpen]);
  const calculation = calculateGraph(project);
  const validation = validateGraph(project.graph, project.rootNodeId);
  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const activeScenario =
    project.scenarios.find((scenario) => scenario.id === activeScenarioId) ?? project.scenarios[0];
  const activeScenarioTitle = activeScenario?.name
    ? `Scenario: ${activeScenario.name}`
    : "Open scenario mode";

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
          ref={scenarioModalTriggerRef}
          size="sm"
          data-testid="open-scenario-modal"
          icon={<Route className="h-4 w-4" />}
          onClick={() => openScenarioModal()}
          aria-label="Open scenario mode"
          aria-haspopup="dialog"
          aria-expanded={scenarioModalOpen}
          title={activeScenarioTitle}
        >
          <span className="hidden sm:inline">Scenario</span>
        </Button>
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
          icon={<Download className="h-4 w-4" />}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="hidden sm:inline">Import</span>
        </Button>
        <div className="relative">
          <Button
            size="sm"
            aria-label="Export"
            aria-controls="export-menu"
            aria-expanded={exportMenuOpen}
            aria-haspopup="menu"
            data-testid="export-menu-button"
            icon={<Upload className="h-4 w-4" />}
            onClick={() => setExportMenuOpen((current) => !current)}
          >
            <span className="hidden sm:inline">Export</span>
          </Button>

          {exportMenuOpen ? (
            <div
              id="export-menu"
              role="menu"
              aria-label="Export options"
              className="absolute right-0 top-full z-30 mt-2 min-w-[10rem] rounded-md border border-line bg-white py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                data-testid="export-json"
                className={exportMenuItemClass}
                onClick={() => {
                  downloadTextFile(`${project.id}.json`, exportProjectJson(project), "application/json");
                  setExportMenuOpen(false);
                }}
              >
                <FileJson className="h-4 w-4" />
                JSON
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="export-svg"
                className={exportMenuItemClass}
                onClick={() => {
                  downloadTextFile(`${project.id}.svg`, exportProjectSvg(project), "image/svg+xml");
                  setExportMenuOpen(false);
                }}
              >
                <FileImage className="h-4 w-4" />
                SVG
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="export-markdown"
                className={exportMenuItemClass}
                onClick={() => {
                  downloadTextFile(`${project.id}.md`, exportProjectMarkdown(project), "text/markdown");
                  setExportMenuOpen(false);
                }}
              >
                <Download className="h-4 w-4" />
                Markdown
              </button>
            </div>
          ) : null}
        </div>
        <VersionHistoryPanel />
        <SettingsModal />
        <ScenarioModal triggerRef={scenarioModalTriggerRef} />
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
