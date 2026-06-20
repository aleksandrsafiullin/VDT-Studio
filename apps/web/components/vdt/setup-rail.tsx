"use client";

import { useState } from "react";
import { Bot, Database, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelCollapseButton, PanelCollapseTab, PanelHeader } from "@/components/ui/panel";
import { useDesktopLayout } from "@/lib/use-desktop-layout";
import {
  EXAMPLE_PROJECT_OPTIONS,
  useVdtStudioStore,
  type ExampleProjectId
} from "./vdt-store";
import { AiProviderSettings } from "./ai-provider-settings";

export function SetupRail() {
  const [selectedExampleId, setSelectedExampleId] = useState<ExampleProjectId>("production_volume");
  const brief = useVdtStudioStore((state) => state.brief);
  const isGenerating = useVdtStudioStore((state) => state.isGenerating);
  const aiError = useVdtStudioStore((state) => state.aiError);
  const leftPanelCollapsed = useVdtStudioStore((state) => state.ui.leftPanelCollapsed);
  const isDesktop = useDesktopLayout();
  const showCollapsed = isDesktop && leftPanelCollapsed;
  const setBriefField = useVdtStudioStore((state) => state.setBriefField);
  const generateWithAi = useVdtStudioStore((state) => state.generateWithAi);
  const loadExample = useVdtStudioStore((state) => state.loadExample);
  const toggleLeftPanel = useVdtStudioStore((state) => state.toggleLeftPanel);

  if (showCollapsed) {
    return (
      <PanelCollapseTab
        label="Setup"
        side="left"
        testId="collapse-left-panel"
        expandTestId="expand-left-panel"
        onToggle={toggleLeftPanel}
      />
    );
  }

  return (
    <Panel className="flex h-full min-h-0 flex-col border-r">
      <PanelHeader
        title="New VDT"
        subtitle="Project brief and model provider"
        action={
          <PanelCollapseButton
            side="left"
            testId="collapse-left-panel"
            onToggle={toggleLeftPanel}
          />
        }
      />
      <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
        <div className="space-y-3">
          <Field label="Root KPI">
            <TextInput value={brief.rootKpi} onChange={(event) => setBriefField("rootKpi", event.target.value)} />
          </Field>
          <Field label="Industry">
            <TextInput value={brief.industry ?? ""} onChange={(event) => setBriefField("industry", event.target.value)} />
          </Field>
          <Field label="Unit">
            <TextInput value={brief.unit ?? ""} onChange={(event) => setBriefField("unit", event.target.value)} />
          </Field>
          <Field label="Time period">
            <TextInput
              value={brief.timePeriod ?? ""}
              onChange={(event) => setBriefField("timePeriod", event.target.value)}
            />
          </Field>
          <Field label="Business goal">
            <TextArea value={brief.goal ?? ""} onChange={(event) => setBriefField("goal", event.target.value)} />
          </Field>
          <Field label="Business context">
            <TextArea
              value={brief.businessContext ?? ""}
              onChange={(event) => setBriefField("businessContext", event.target.value)}
            />
          </Field>
          <Field label="Detail">
            <SelectInput
              value={brief.levelOfDetail ?? "medium"}
              onChange={(event) => setBriefField("levelOfDetail", event.target.value)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </SelectInput>
          </Field>
        </div>

        <div className="border-t border-line pt-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <Bot className="h-4 w-4 text-accent" />
            AI model harness
          </div>
          <AiProviderSettings />
        </div>

        {aiError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">{aiError}</div>
        ) : null}
      </div>
      <div className="space-y-2 border-t border-line px-4 py-4">
        <Button
          className="w-full"
          variant="primary"
          icon={<Sparkles className="h-4 w-4" />}
          disabled={isGenerating}
          onClick={() => void generateWithAi()}
        >
          {isGenerating ? "Generating..." : "Generate VDT with AI"}
        </Button>
        <Field label="Example model">
          <SelectInput
            value={selectedExampleId}
            onChange={(event) => setSelectedExampleId(event.target.value as ExampleProjectId)}
          >
            {EXAMPLE_PROJECT_OPTIONS.map((example) => (
              <option key={example.id} value={example.id}>
                {example.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Button className="w-full" icon={<RotateCcw className="h-4 w-4" />} onClick={() => loadExample(selectedExampleId)}>
          Open example
        </Button>
        <div className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-muted">
          <Database className="h-4 w-4 shrink-0" />
          Browser-local state is saved automatically.
        </div>
      </div>
    </Panel>
  );
}
