"use client";

import { Download, FileJson, GitBranch, ShieldCheck } from "lucide-react";
import { calculateGraph, exportProjectJson, exportProjectMarkdown, validateGraph } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { downloadTextFile } from "@/lib/download";
import { formatNumber } from "@/lib/format";
import { useVdtStudioStore } from "./vdt-store";

export function TopBar() {
  const project = useVdtStudioStore((state) => state.project);
  const calculation = calculateGraph(project);
  const validation = validateGraph(project.graph, project.rootNodeId);
  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-white px-4">
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
          icon={<FileJson className="h-4 w-4" />}
          onClick={() => downloadTextFile(`${project.id}.json`, exportProjectJson(project), "application/json")}
        >
          Export JSON
        </Button>
        <Button
          size="sm"
          icon={<Download className="h-4 w-4" />}
          onClick={() => downloadTextFile(`${project.id}.md`, exportProjectMarkdown(project), "text/markdown")}
        >
          Export Markdown
        </Button>
      </div>
    </header>
  );
}
