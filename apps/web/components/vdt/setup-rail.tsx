"use client";

import { useState } from "react";
import { Check, CircleAlert, Send, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelCollapseTab, PanelToggleButton, PanelHeader } from "@/components/ui/panel";
import { hasByokFieldErrors, validateByokSettings } from "@/lib/byok-validation";
import { formatExecutionModeSummary } from "@/lib/format-execution-summary";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { useDesktopLayout } from "@/lib/use-desktop-layout";
import { useVdtStudioStore } from "./vdt-store";
import { GenerateActivityPanel } from "./generate-activity-panel";
import { SettingsModal } from "./settings-modal";

export function SetupRail() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [instructionText, setInstructionText] = useState("");
  const brief = useVdtStudioStore((state) => state.brief);
  const project = useVdtStudioStore((state) => state.project);
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const isGenerating = useVdtStudioStore((state) => state.isGenerating);
  const isRunningAiAction = useVdtStudioStore((state) => state.isRunningAiAction);
  const generateActivity = useVdtStudioStore((state) => state.generateActivity);
  const pendingChangeSet = useVdtStudioStore((state) => state.pendingChangeSet);
  const changeSetSelection = useVdtStudioStore((state) => state.changeSetSelection);
  const aiError = useVdtStudioStore((state) => state.aiError);
  const leftPanelCollapsed = useVdtStudioStore((state) => state.ui.leftPanelCollapsed);
  const isDesktop = useDesktopLayout();
  const showCollapsed = isDesktop && leftPanelCollapsed;
  const setBriefField = useVdtStudioStore((state) => state.setBriefField);
  const startAgentRun = useVdtStudioStore((state) => state.startAgentRun);
  const sendAgentAnswers = useVdtStudioStore((state) => state.sendAgentAnswers);
  const sendAgentInstruction = useVdtStudioStore((state) => state.sendAgentInstruction);
  const cancelGenerate = useVdtStudioStore((state) => state.cancelGenerate);
  const runAiAction = useVdtStudioStore((state) => state.runAiAction);
  const selectNode = useVdtStudioStore((state) => state.selectNode);
  const applyPendingChangeSet = useVdtStudioStore((state) => state.applyPendingChangeSet);
  const discardPendingChangeSet = useVdtStudioStore((state) => state.discardPendingChangeSet);
  const toggleLeftPanel = useVdtStudioStore((state) => state.toggleLeftPanel);
  const executionSummary = formatExecutionModeSummary(executionSettings);
  const resolvedExecution = resolveExecutionSettings(executionSettings);
  const canRunDeepenAction = resolvedExecution.providerId !== "mock";
  const byokValidationBlocked = executionSettings.executionMode === "byok" &&
    hasByokFieldErrors(validateByokSettings(executionSettings));
  const canUseConfiguredRuntime = canRunDeepenAction && !byokValidationBlocked;
  const topLevelDrivers = project.graph.edges
    .filter((edge) => edge.sourceNodeId === project.rootNodeId)
    .map((edge) => project.graph.nodes.find((node) => node.id === edge.targetNodeId))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  const deepenTargetId = topLevelDrivers[0]?.id;
  const pendingChangeCount = pendingChangeSet
    ? pendingChangeSet.additions.length +
      pendingChangeSet.updates.length +
      pendingChangeSet.deletions.length +
      pendingChangeSet.edgeChanges.length
    : 0;
  const canSendInstruction =
    instructionText.trim().length > 0 &&
    !isGenerating &&
    !isRunningAiAction &&
    canUseConfiguredRuntime;

  async function submitAgentInstruction() {
    const text = instructionText.trim();
    if (!text || isGenerating || isRunningAiAction) return;
    if (!canUseConfiguredRuntime) return;
    setInstructionText("");
    await sendAgentInstruction(text, generateActivity ? deepenTargetId : undefined);
    if (!generateActivity) {
      await startAgentRun();
      return;
    }
    if (!deepenTargetId) return;
    selectNode(deepenTargetId);
    await runAiAction("deepen_node", {
      nodeId: deepenTargetId,
      context: { goal: text }
    });
  }

  if (showCollapsed) {
    return (
      <PanelCollapseTab
        label="Setup"
        panel="left"
        testId="collapse-left-panel"
        expandTestId="expand-left-panel"
        onToggle={toggleLeftPanel}
      />
    );
  }

  return (
    <Panel className="flex h-full min-h-0 flex-col border-r">
      <PanelHeader
        title="VDT Agent"
        action={
          <PanelToggleButton
            panel="left"
            testId="collapse-left-panel"
            onToggle={toggleLeftPanel}
          />
        }
      />
      <div className="flex-1 overflow-auto">
        <section className="space-y-3 border-b border-line px-4 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-normal text-muted">Current brief</p>
            <p className="mt-1 truncate text-sm font-semibold text-ink">{brief.rootKpi || "Untitled VDT"}</p>
          </div>

          <div className="space-y-2">
            <Field label="Root KPI">
              <TextInput
                className="py-2"
                value={brief.rootKpi}
                onChange={(event) => setBriefField("rootKpi", event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Unit">
                <TextInput
                  className="py-2"
                  value={brief.unit ?? ""}
                  onChange={(event) => setBriefField("unit", event.target.value)}
                />
              </Field>
              <Field label="Period">
                <TextInput
                  className="py-2"
                  value={brief.timePeriod ?? ""}
                  onChange={(event) => setBriefField("timePeriod", event.target.value)}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="space-y-3 px-4 py-4">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {generateActivity ? (
              <div className="border-b border-slate-100 px-3 py-3">
                <GenerateActivityPanel
                  activity={generateActivity}
                  onCancel={cancelGenerate}
                  onAnswer={(answers) => void sendAgentAnswers(answers)}
                />
              </div>
            ) : null}

            <form
              className="bg-white p-3"
              data-testid="agent-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void submitAgentInstruction();
              }}
            >
              <TextArea
                className="min-h-52 resize-none rounded-xl border-slate-200 bg-white p-3 text-sm leading-6 shadow-none focus:bg-white"
                value={instructionText}
                onChange={(event) => setInstructionText(event.target.value)}
                placeholder="Describe the situation, data, constraints, and what to do next..."
                data-testid="agent-instruction-input"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className={[
                    "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-slate-50 px-2.5 text-left transition",
                    "hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  ].join(" ")}
                  onClick={() => setSettingsOpen(true)}
                  data-testid="execution-mode-configure"
                  aria-label="Configure execution mode"
                >
                  <span
                    className={[
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      canUseConfiguredRuntime ? "bg-emerald-500" : "bg-amber-500"
                    ].join(" ")}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate" data-testid="execution-mode-summary">
                    <span className="truncate text-xs font-semibold text-ink">{executionSummary.primary}</span>
                    <span className="ml-1 truncate text-[11px] text-muted">
                      {executionSummary.secondary ?? executionSummary.modeLabel}
                    </span>
                  </span>
                  <Settings2 className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                </button>
                <Button
                  className="h-9 shrink-0 px-3"
                  size="sm"
                  variant="primary"
                  icon={<Send className="h-4 w-4" />}
                  disabled={!canSendInstruction}
                  data-testid="agent-send-instruction"
                >
                  Send
                </Button>
              </div>
            </form>

            {pendingChangeSet ? (
              <div className="mt-3 rounded-md border border-emerald-200 bg-white p-3" data-testid="agent-patch-ready">
                <div className="text-xs font-semibold uppercase tracking-normal text-emerald-700">Patch ready</div>
                <p className="mt-1 text-sm leading-5 text-ink">
                  AI prepared {pendingChangeCount} graph change{pendingChangeCount === 1 ? "" : "s"}. Review or apply them.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Check className="h-4 w-4" />}
                    disabled={isRunningAiAction || changeSetSelection.size === 0}
                    onClick={applyPendingChangeSet}
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    icon={<X className="h-4 w-4" />}
                    disabled={isRunningAiAction}
                    onClick={discardPendingChangeSet}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            ) : null}

            {aiError ? (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{aiError}</span>
              </div>
            ) : null}
          </div>
        </section>
      </div>
      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialSection="execution"
        hideTrigger
      />
    </Panel>
  );
}
