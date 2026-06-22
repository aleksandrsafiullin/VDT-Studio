"use client";

import type { VdtChangeSet, VdtProject } from "@vdt-studio/vdt-core";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const TASK_TITLES: Partial<Record<VdtChangeSet["taskType"], string>> = {
  deepen_node: "Deepen node",
  simplify_branch: "Simplify branch",
  suggest_alternative: "Suggest alternative",
  suggest_formula: "Suggest formula"
};

interface ChangeSetPreviewPanelProps {
  project: VdtProject;
  changeSet: VdtChangeSet;
  selection: Set<string>;
  isRunning?: boolean;
  error?: string | undefined;
  onToggle: (changeId: string) => void;
  onApply: () => void;
  onDiscard: () => void;
}

function AdvisoryBlock({
  title,
  items
}: {
  title: string;
  items: string[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-normal text-muted">{title}</div>
      <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function formatUpdateSummary(project: VdtProject, nodeId: string, patch: Record<string, unknown>) {
  const existing = project.graph.nodes.find((node) => node.id === nodeId);
  const parts: string[] = [];

  if (typeof patch.formula === "string") {
    parts.push(`Formula: ${existing?.formula ?? "—"} → ${patch.formula}`);
  }
  if (typeof patch.name === "string") {
    parts.push(`Name: ${existing?.name ?? nodeId} → ${patch.name}`);
  }
  if (typeof patch.unit === "string") {
    parts.push(`Unit: ${existing?.unit ?? "—"} → ${patch.unit}`);
  }

  return parts.length > 0 ? parts.join(" · ") : `Update ${nodeId}`;
}

export function ChangeSetPreviewPanel({
  project,
  changeSet,
  selection,
  isRunning = false,
  error,
  onToggle,
  onApply,
  onDiscard
}: ChangeSetPreviewPanelProps) {
  const isDestructive = changeSet.taskType === "simplify_branch" && changeSet.deletions.length > 0;
  const title = TASK_TITLES[changeSet.taskType] ?? "Proposed changes";

  const groups = [
    {
      label: "Add",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
      rows: changeSet.additions.map((addition) => ({
        id: addition.id,
        label: `${addition.name} (${addition.nodeId})`,
        detail: addition.unit ? `Unit: ${addition.unit}` : undefined
      }))
    },
    {
      label: "Update",
      tone: "border-blue-200 bg-blue-50 text-blue-900",
      rows: changeSet.updates.map((update) => ({
        id: update.id,
        label: update.nodeId,
        detail: formatUpdateSummary(project, update.nodeId, update.patch)
      }))
    },
    {
      label: "Remove",
      tone: "border-orange-200 bg-orange-50 text-orange-900",
      rows: changeSet.deletions.map((deletion) => ({
        id: deletion.id,
        label: deletion.nodeId,
        detail: "Node will be removed from the graph"
      }))
    },
    {
      label: "Edges",
      tone: "border-slate-200 bg-slate-50 text-slate-900",
      rows: changeSet.edgeChanges.map((change) => ({
        id: change.id,
        label:
          change.action === "add"
            ? `${change.edge.sourceNodeId} → ${change.edge.targetNodeId}`
            : change.action === "remove"
              ? `Remove ${change.edgeId}`
              : `Update ${change.edgeId}`,
        detail: change.action
      }))
    }
  ].filter((group) => group.rows.length > 0);

  return (
    <div
      className={[
        "rounded-md border p-3",
        isDestructive ? "border-orange-300 bg-orange-50" : "border-blue-200 bg-blue-50"
      ].join(" ")}
      data-testid="change-set-preview"
    >
      <div className="flex items-start gap-2">
        {isDestructive ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-700" aria-hidden />
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">Preview: {title}</h3>
          <p className="mt-1 text-sm leading-5 text-muted">
            {isDestructive
              ? "This proposal removes nodes or edges. Review carefully before applying."
              : "Select changes to apply. The model will not change until you confirm."}
          </p>
        </div>
      </div>

      {isRunning ? (
        <div
          className="mt-3 flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm text-muted"
          data-testid="change-set-loading"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Running AI action…
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-md border border-orange-200 bg-white px-3 py-2 text-sm text-orange-800">{error}</div>
      ) : null}

      <div className="mt-3 space-y-3">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="text-xs font-semibold uppercase tracking-normal text-muted">{group.label}</div>
            <div className="mt-2 space-y-2">
              {group.rows.map((row) => (
                <label
                  key={row.id}
                  className={[
                    "flex items-start gap-2 rounded-md border bg-white px-3 py-2 text-sm",
                    group.tone
                  ].join(" ")}
                  data-testid={`change-set-row-${row.id}`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selection.has(row.id)}
                    aria-label={`Include change ${row.label}`}
                    onChange={() => onToggle(row.id)}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{row.label}</span>
                    {row.detail ? <span className="mt-0.5 block text-xs leading-5 opacity-80">{row.detail}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {changeSet.assumptions.length > 0 || changeSet.questions.length > 0 || changeSet.warnings.length > 0 ? (
        <div className="mt-3 space-y-3 rounded-md border border-line bg-white p-3">
          <AdvisoryBlock title="Assumptions" items={changeSet.assumptions} />
          <AdvisoryBlock title="Questions" items={changeSet.questions} />
          {changeSet.warnings.length > 0 ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-normal text-muted">Warnings</div>
              <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
                {changeSet.warnings.map((warning) => (
                  <li key={warning.id}>{warning.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="primary"
          data-testid="change-set-apply"
          disabled={isRunning || selection.size === 0}
          onClick={onApply}
        >
          Apply selected
        </Button>
        <Button size="sm" data-testid="change-set-discard" disabled={isRunning} onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  );
}
