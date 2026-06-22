"use client";

import { useState } from "react";
import type {
  AiExplanationResult,
  ExecutiveSummaryResult,
  ExplainNodeResult,
  ExplainScenarioResult
} from "@vdt-studio/ai-harness";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownText } from "./markdown-text";
import type { RunAiActionTaskType } from "./vdt-store";

const TASK_LABELS: Partial<Record<RunAiActionTaskType, string>> = {
  explain_node: "Node explanation",
  explain_scenario: "Scenario explanation",
  generate_executive_summary: "Executive summary"
};

function buildCopyText(taskType: RunAiActionTaskType, result: AiExplanationResult) {
  if (taskType === "explain_node") {
    const node = result as ExplainNodeResult;
    return [
      node.explanation,
      node.keyDrivers.length > 0 ? `\nKey drivers:\n${node.keyDrivers.map((driver) => `- ${driver}`).join("\n")}` : "",
      node.assumptions.length > 0 ? `\nAssumptions:\n${node.assumptions.map((item) => `- ${item}`).join("\n")}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (taskType === "explain_scenario") {
    const scenario = result as ExplainScenarioResult;
    return [
      scenario.narrative,
      scenario.impactHighlights.length > 0
        ? `\nHighlights:\n${scenario.impactHighlights.map((item) => `- ${item.message}`).join("\n")}`
        : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  const summary = result as ExecutiveSummaryResult;
  return [
    summary.headline,
    summary.keyDrivers.length > 0 ? `\nKey drivers:\n${summary.keyDrivers.map((item) => `- ${item}`).join("\n")}` : "",
    summary.risks.length > 0 ? `\nRisks:\n${summary.risks.map((item) => `- ${item}`).join("\n")}` : "",
    summary.recommendations.length > 0
      ? `\nRecommendations:\n${summary.recommendations.map((item) => `- ${item}`).join("\n")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

interface ExplanationPanelProps {
  taskType: RunAiActionTaskType;
  result: AiExplanationResult;
}

export function ExplanationPanel({ taskType, result }: ExplanationPanelProps) {
  const [copied, setCopied] = useState(false);
  const title = TASK_LABELS[taskType] ?? "Explanation";

  async function handleCopy() {
    await navigator.clipboard.writeText(buildCopyText(taskType, result));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-md border border-line bg-white p-3" data-testid="explanation-panel">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-xs text-muted">Read-only AI narrative — no apply controls.</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          data-testid="explanation-copy"
          icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          onClick={() => void handleCopy()}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {taskType === "explain_node" ? (
        <div className="mt-3 space-y-3">
          <MarkdownText text={(result as ExplainNodeResult).explanation} />
          {(result as ExplainNodeResult).keyDrivers.length > 0 ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-normal text-muted">Key drivers</div>
              <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
                {(result as ExplainNodeResult).keyDrivers.map((driver) => (
                  <li key={driver}>{driver}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {taskType === "explain_scenario" ? (
        <div className="mt-3 space-y-3">
          <MarkdownText text={(result as ExplainScenarioResult).narrative} />
          {(result as ExplainScenarioResult).impactHighlights.length > 0 ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-normal text-muted">Impact highlights</div>
              <ul className="mt-2 space-y-2 text-sm leading-5 text-muted">
                {(result as ExplainScenarioResult).impactHighlights.map((highlight) => (
                  <li key={`${highlight.nodeId}-${highlight.message}`} className="rounded-md border border-line bg-slate-50 px-3 py-2">
                    <div className="font-medium text-ink">{highlight.nodeId}</div>
                    <p className="mt-1">{highlight.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {taskType === "generate_executive_summary" ? (
        <div className="mt-3 space-y-3">
          <p className="text-base font-semibold leading-7 text-ink">{(result as ExecutiveSummaryResult).headline}</p>
          {[
            { label: "Key drivers", items: (result as ExecutiveSummaryResult).keyDrivers },
            { label: "Risks", items: (result as ExecutiveSummaryResult).risks },
            { label: "Recommendations", items: (result as ExecutiveSummaryResult).recommendations }
          ].map((section) =>
            section.items.length > 0 ? (
              <div key={section.label}>
                <div className="text-xs font-semibold uppercase tracking-normal text-muted">{section.label}</div>
                <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null
          )}
        </div>
      ) : null}

      {"assumptions" in result && result.assumptions.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-normal text-muted">Assumptions</div>
          <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
            {result.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {"questionsForUser" in result && result.questionsForUser.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-normal text-muted">Questions</div>
          <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
            {result.questionsForUser.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
