"use client";

import { Bot, Database, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelCollapseButton, PanelCollapseTab, PanelHeader } from "@/components/ui/panel";
import { useDesktopLayout } from "@/lib/use-desktop-layout";
import { useVdtStudioStore } from "./vdt-store";

export function SetupRail() {
  const brief = useVdtStudioStore((state) => state.brief);
  const providerId = useVdtStudioStore((state) => state.providerId);
  const providerConfig = useVdtStudioStore((state) => state.providerConfig);
  const isGenerating = useVdtStudioStore((state) => state.isGenerating);
  const aiError = useVdtStudioStore((state) => state.aiError);
  const leftPanelCollapsed = useVdtStudioStore((state) => state.ui.leftPanelCollapsed);
  const isDesktop = useDesktopLayout();
  const showCollapsed = isDesktop && leftPanelCollapsed;
  const setBriefField = useVdtStudioStore((state) => state.setBriefField);
  const setProviderId = useVdtStudioStore((state) => state.setProviderId);
  const setProviderConfigField = useVdtStudioStore((state) => state.setProviderConfigField);
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
          <div className="space-y-3">
            <Field label="Provider">
              <SelectInput value={providerId} onChange={(event) => setProviderId(event.target.value as "mock")}>
                <option value="mock">Built-in mock</option>
                <option value="openai_compatible">OpenAI-compatible</option>
              </SelectInput>
            </Field>
            {providerId === "openai_compatible" ? (
              <>
                <Field label="Base URL">
                  <TextInput
                    value={providerConfig.baseUrl ?? ""}
                    onChange={(event) => setProviderConfigField("baseUrl", event.target.value)}
                  />
                </Field>
                <Field label="Model">
                  <TextInput
                    value={providerConfig.model ?? ""}
                    onChange={(event) => setProviderConfigField("model", event.target.value)}
                  />
                </Field>
                <Field label="API key">
                  <TextInput
                    type="password"
                    value={providerConfig.apiKey ?? ""}
                    onChange={(event) => setProviderConfigField("apiKey", event.target.value)}
                  />
                </Field>
              </>
            ) : null}
          </div>
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
        <Button className="w-full" icon={<RotateCcw className="h-4 w-4" />} onClick={loadExample}>
          Load demo model
        </Button>
        <div className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-muted">
          <Database className="h-4 w-4 shrink-0" />
          Browser-local state is saved automatically.
        </div>
      </div>
    </Panel>
  );
}
