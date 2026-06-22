"use client";

import type {
  AiAdvisoryResult,
  CheckUnitsResult,
  IdentifyDuplicateDriversResult,
  IdentifyMissingDriversResult,
  ReviewModelResult
} from "@vdt-studio/ai-harness";
import type { VdtChangeSet } from "@vdt-studio/vdt-core";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RunAiActionTaskType } from "./vdt-store";

const TASK_LABELS: Partial<Record<RunAiActionTaskType, string>> = {
  review_model: "Model review",
  check_units: "Unit check",
  identify_missing_drivers: "Missing drivers",
  identify_duplicate_drivers: "Duplicate drivers"
};

function severityClass(severity: string) {
  if (severity === "error") {
    return "border-red-200 bg-red-50 text-red-800";
  }
  if (severity === "warning") {
    return "border-orange-200 bg-orange-50 text-orange-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-800";
}

function hasSuggestedChanges(result: AiAdvisoryResult): result is AiAdvisoryResult & { suggestedChanges: VdtChangeSet } {
  return "suggestedChanges" in result && result.suggestedChanges !== undefined;
}

interface AdvisoryFindingsPanelProps {
  taskType: RunAiActionTaskType;
  result: AiAdvisoryResult;
  isRunning?: boolean;
  onSaveToProject?: () => void;
  onApplySuggestedChanges?: () => void;
  onSelectNode?: (nodeId: string) => void;
}

export function AdvisoryFindingsPanel({
  taskType,
  result,
  isRunning = false,
  onSaveToProject,
  onApplySuggestedChanges,
  onSelectNode
}: AdvisoryFindingsPanelProps) {
  const title = TASK_LABELS[taskType] ?? "Advisory findings";

  return (
    <div className="rounded-md border border-line bg-white p-3" data-testid="advisory-findings-panel">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-xs text-muted">Advisory only — nothing is applied automatically.</p>

      {isRunning ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Running AI action…
        </div>
      ) : null}

      <div className="mt-3 space-y-2" data-testid="advisory-findings-list">
        {taskType === "review_model"
          ? (result as ReviewModelResult).findings.map((finding, index) => (
              <div
                key={`${finding.category}-${finding.message}-${index}`}
                className={["rounded-md border px-3 py-2 text-sm", severityClass(finding.severity)].join(" ")}
              >
                <div className="font-medium capitalize">{finding.category.replaceAll("_", " ")}</div>
                <p className="mt-1 leading-5">{finding.message}</p>
                {finding.nodeId && onSelectNode ? (
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold underline"
                    onClick={() => onSelectNode(finding.nodeId!)}
                  >
                    Open {finding.nodeId}
                  </button>
                ) : null}
              </div>
            ))
          : null}

        {taskType === "check_units"
          ? (result as CheckUnitsResult).unitFindings.map((finding) => (
              <div
                key={`${finding.nodeId}-${finding.message}`}
                className={["rounded-md border px-3 py-2 text-sm", severityClass(finding.severity)].join(" ")}
              >
                <p className="leading-5">{finding.message}</p>
                <div className="mt-1 text-xs opacity-80">
                  {finding.actualUnit ? `Actual: ${finding.actualUnit}` : null}
                  {finding.expectedUnit ? ` · Expected: ${finding.expectedUnit}` : null}
                </div>
                {onSelectNode ? (
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold underline"
                    onClick={() => onSelectNode(finding.nodeId)}
                  >
                    Open {finding.nodeId}
                  </button>
                ) : null}
              </div>
            ))
          : null}

        {taskType === "identify_missing_drivers"
          ? (result as IdentifyMissingDriversResult).missingDrivers.map((driver) => (
              <div key={`${driver.parentNodeId}-${driver.suggestedName}`} className="rounded-md border border-line bg-slate-50 px-3 py-2 text-sm">
                <div className="font-medium">{driver.suggestedName}</div>
                <p className="mt-1 leading-5 text-muted">{driver.rationale}</p>
                <p className="mt-1 text-xs text-muted">
                  Parent: {driver.parentNodeId}
                  {driver.unit ? ` · Unit: ${driver.unit}` : null}
                </p>
              </div>
            ))
          : null}

        {taskType === "identify_duplicate_drivers"
          ? (result as IdentifyDuplicateDriversResult).duplicateClusters.map((cluster, index) => (
              <div key={`${cluster.nodeIds.join("-")}-${index}`} className="rounded-md border border-line bg-slate-50 px-3 py-2 text-sm">
                <div className="font-medium">{cluster.nodeIds.join(", ")}</div>
                <p className="mt-1 leading-5 text-muted">{cluster.similarityReason}</p>
                {cluster.mergeSuggestion ? (
                  <p className="mt-1 text-xs text-muted">{cluster.mergeSuggestion}</p>
                ) : null}
              </div>
            ))
          : null}
      </div>

      {result.assumptions.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-normal text-muted">Assumptions</div>
          <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
            {result.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.questionsForUser.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-normal text-muted">Questions</div>
          <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
            {result.questionsForUser.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.warnings.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-normal text-muted">Warnings</div>
          <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
            {result.warnings.map((warning, index) => (
              <li key={`${warning.message}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {onSaveToProject ? (
          <Button size="sm" variant="secondary" onClick={onSaveToProject}>
            Save to project
          </Button>
        ) : null}
        {hasSuggestedChanges(result) && onApplySuggestedChanges ? (
          <Button size="sm" variant="primary" onClick={onApplySuggestedChanges}>
            Create preview from suggestions
          </Button>
        ) : null}
      </div>
    </div>
  );
}
