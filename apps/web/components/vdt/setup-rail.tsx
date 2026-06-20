"use client";

import { useState } from "react";
import { Bot, CheckCircle2, Database, PlugZap, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelCollapseButton, PanelCollapseTab, PanelHeader } from "@/components/ui/panel";
import { useDesktopLayout } from "@/lib/use-desktop-layout";
import {
  EXAMPLE_PROJECT_OPTIONS,
  LOCAL_RUNNER_PRESETS,
  useVdtStudioStore,
  type ExampleProjectId,
  type LocalRunnerPresetId,
  type ProviderId
} from "./vdt-store";

type ProviderTestStatus = {
  kind: "success" | "error";
  message: string;
};

export function SetupRail() {
  const [selectedExampleId, setSelectedExampleId] = useState<ExampleProjectId>("production_volume");
  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const [providerTestStatus, setProviderTestStatus] = useState<ProviderTestStatus | undefined>();
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

  function applyLocalRunnerPreset(presetId: LocalRunnerPresetId) {
    const preset = LOCAL_RUNNER_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) {
      return;
    }

    setProviderTestStatus(undefined);
    setProviderConfigField("localRunnerPresetId", preset.id);
    setProviderConfigField("runnerProviderId", preset.runnerProviderId);
    if (preset.baseUrl !== undefined) {
      setProviderConfigField("localBaseUrl", preset.baseUrl);
    }
    if (preset.model !== undefined) {
      setProviderConfigField("localModel", preset.model);
    }
    if (preset.command !== undefined) {
      setProviderConfigField("command", preset.command);
    }
    if (preset.argsText !== undefined) {
      setProviderConfigField("argsText", preset.argsText);
    }
  }

  async function testLocalRunnerProvider() {
    setIsTestingProvider(true);
    setProviderTestStatus(undefined);

    const runnerProviderId = providerConfig.runnerProviderId ?? "local_http_stub";
    const timeoutSec = providerConfig.timeoutSec ?? 60;
    const body =
      runnerProviderId === "cli_stub"
        ? {
            providerId: runnerProviderId,
            providerConfig: {
              name: "Local CLI Model",
              command: providerConfig.command ?? "",
              args: providerConfig.argsText?.trim() ? providerConfig.argsText.trim().split(/\s+/) : undefined,
              inputMode: "stdin",
              outputMode: "stdout_json",
              timeoutSec
            },
            timeoutSec
          }
        : {
            providerId: runnerProviderId,
            providerConfig: {
              baseUrl: providerConfig.localBaseUrl ?? "http://127.0.0.1:11434/v1",
              model: providerConfig.localModel ?? "qwen3",
              apiKey: providerConfig.localApiKey || undefined
            },
            timeoutSec
          };

    try {
      const response = await fetch(`${(providerConfig.runnerUrl ?? "http://127.0.0.1:8765").replace(/\/$/, "")}/test-provider`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        models?: string[];
        error?: { message?: string };
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? `Local runner test failed with ${response.status}.`);
      }

      const modelList = payload.models?.length ? ` Models: ${payload.models.slice(0, 3).join(", ")}.` : "";
      setProviderTestStatus({ kind: "success", message: `Connection test passed.${modelList}` });
    } catch (error) {
      setProviderTestStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Local runner test failed."
      });
    } finally {
      setIsTestingProvider(false);
    }
  }

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
              <SelectInput value={providerId} onChange={(event) => setProviderId(event.target.value as ProviderId)}>
                <option value="mock">Built-in mock</option>
                <option value="openai_compatible">OpenAI-compatible</option>
                <option value="local_runner">Local runner</option>
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
            {providerId === "local_runner" ? (
              <>
                <Field label="Runner URL">
                  <TextInput
                    value={providerConfig.runnerUrl ?? "http://127.0.0.1:8765"}
                    onChange={(event) => setProviderConfigField("runnerUrl", event.target.value)}
                  />
                </Field>
                <Field label="Preset">
                  <SelectInput
                    value={providerConfig.localRunnerPresetId ?? "ollama_openai"}
                    onChange={(event) => applyLocalRunnerPreset(event.target.value as LocalRunnerPresetId)}
                  >
                    {LOCAL_RUNNER_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Runner adapter">
                  <SelectInput
                    value={providerConfig.runnerProviderId ?? "local_http_stub"}
                    onChange={(event) => {
                      setProviderTestStatus(undefined);
                      setProviderConfigField("runnerProviderId", event.target.value as "local_http_stub" | "cli_stub");
                    }}
                  >
                    <option value="local_http_stub">Local HTTP</option>
                    <option value="cli_stub">CLI JSON stdout</option>
                  </SelectInput>
                </Field>
                {providerConfig.runnerProviderId === "cli_stub" ? (
                  <>
                    <Field label="Command">
                      <TextInput
                        value={providerConfig.command ?? ""}
                        onChange={(event) => {
                          setProviderTestStatus(undefined);
                          setProviderConfigField("command", event.target.value);
                        }}
                      />
                    </Field>
                    <Field label="Args">
                      <TextInput
                        value={providerConfig.argsText ?? ""}
                        onChange={(event) => {
                          setProviderTestStatus(undefined);
                          setProviderConfigField("argsText", event.target.value);
                        }}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Base URL">
                      <TextInput
                        value={providerConfig.localBaseUrl ?? "http://127.0.0.1:11434/v1"}
                        onChange={(event) => {
                          setProviderTestStatus(undefined);
                          setProviderConfigField("localBaseUrl", event.target.value);
                        }}
                      />
                    </Field>
                    <Field label="Model">
                      <TextInput
                        value={providerConfig.localModel ?? "qwen3"}
                        onChange={(event) => {
                          setProviderTestStatus(undefined);
                          setProviderConfigField("localModel", event.target.value);
                        }}
                      />
                    </Field>
                    <Field label="API key">
                      <TextInput
                        type="password"
                        value={providerConfig.localApiKey ?? ""}
                        onChange={(event) => setProviderConfigField("localApiKey", event.target.value)}
                      />
                    </Field>
                  </>
                )}
                <Button
                  className="w-full"
                  size="sm"
                  icon={<PlugZap className="h-4 w-4" />}
                  disabled={isTestingProvider}
                  onClick={() => void testLocalRunnerProvider()}
                >
                  {isTestingProvider ? "Testing..." : "Test connection"}
                </Button>
                {providerTestStatus ? (
                  <div
                    className={
                      providerTestStatus.kind === "success"
                        ? "flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800"
                        : "flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700"
                    }
                    role="status"
                    aria-live="polite"
                  >
                    {providerTestStatus.kind === "success" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span>{providerTestStatus.message}</span>
                  </div>
                ) : null}
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
