"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowLeft, FileSpreadsheet, Folder, GitBranch, Route, ShieldCheck } from "lucide-react";
import {
  calculateGraph,
  EXCEL_MIME_TYPE,
  exportProjectExcel,
  validateGraph
} from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { downloadBinaryFile, getExcelDownloadFilename } from "@/lib/download";
import { formatNumber } from "@/lib/format";
import { ScenarioModal } from "./scenario-modal";
import { SettingsModal } from "./settings-modal";
import { VersionHistoryPanel } from "./version-history-panel";
import { hasActiveWorkspaceVdt, useVdtStudioStore } from "./vdt-store";

interface TopBarProps {
  projectId: string;
}

export function TopBar({ projectId }: TopBarProps) {
  const project = useVdtStudioStore((state) => state.project);
  const workspace = useVdtStudioStore((state) => state.workspace);
  const activeScenarioId = useVdtStudioStore((state) => state.activeScenarioId);
  const scenarioModalOpen = useVdtStudioStore((state) => state.scenarioModalOpen);
  const openScenarioModal = useVdtStudioStore((state) => state.openScenarioModal);
  const scenarioModalTriggerRef = useRef<HTMLButtonElement>(null);
  const [exportError, setExportError] = useState<string>();

  const activeProjectSummary =
    workspace.projectSummaries.find((entry) => entry.project.id === projectId) ??
    workspace.projectSummaries.find((entry) => entry.project.id === workspace.activeProjectId);

  if (workspace.activePanel === "project" || !hasActiveWorkspaceVdt(workspace)) {
    return (
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-black/5 bg-white/70 px-5 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-graphite transition hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            data-testid="back-to-projects"
            aria-label="Back to projects"
            title="Back to projects"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
            <Folder className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-medium tracking-tight text-ink">
              {activeProjectSummary?.project.name ?? "Project workspace"}
            </h1>
            <p className="truncate text-xs text-muted">
              {activeProjectSummary
                ? `${activeProjectSummary.counts.vdts} VDT${activeProjectSummary.counts.vdts === 1 ? "" : "s"} · ${activeProjectSummary.counts.revisions} revision${activeProjectSummary.counts.revisions === 1 ? "" : "s"}`
                : "Project not found"}
            </p>
          </div>
        </div>
        <SettingsModal />
      </header>
    );
  }

  const calculation = calculateGraph(project);
  const validation = validateGraph(project.graph, project.rootNodeId);
  const graphStatusLabel = validation.valid ? "Model graph valid" : `${validation.errors.length} graph issues`;
  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const activeScenario =
    project.scenarios.find((scenario) => scenario.id === activeScenarioId) ?? project.scenarios[0];
  const activeScenarioTitle = activeScenario?.name
    ? `Scenario: ${activeScenario.name}`
    : "Open scenario mode";

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-white px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-graphite transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          data-testid="back-to-project-workspace"
          aria-label="Back to project workspace"
          title="Back to project workspace"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
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
        <Tooltip label={graphStatusLabel}>
          <div
            className="hidden h-8 w-8 items-center justify-center rounded-md border border-line bg-slate-50 text-muted md:flex"
            role="status"
            aria-label={graphStatusLabel}
            data-testid="graph-validation-status"
          >
            <ShieldCheck className="h-4 w-4 text-teal" />
          </div>
        </Tooltip>
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
          aria-label="Export Excel"
          data-testid="export-excel"
          icon={<FileSpreadsheet className="h-4 w-4" />}
          onClick={() => {
            try {
              downloadBinaryFile(
                getExcelDownloadFilename(project.name),
                exportProjectExcel(project, { scenarioId: activeScenarioId }),
                EXCEL_MIME_TYPE
              );
              setExportError(undefined);
            } catch (error) {
              setExportError(error instanceof Error ? error.message : "Excel workbook could not be exported.");
            }
          }}
        >
          <span className="hidden sm:inline">Export Excel</span>
        </Button>
        <VersionHistoryPanel />
        <SettingsModal />
        <ScenarioModal triggerRef={scenarioModalTriggerRef} />
      </div>
      {exportError ? (
        <div
          className="absolute right-4 top-12 z-20 max-w-[420px] rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 shadow-sm"
          role="alert"
        >
          {exportError}
        </div>
      ) : null}
    </header>
  );
}
