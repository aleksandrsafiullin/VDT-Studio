"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";
import { createPortal, flushSync } from "react-dom";
import { Plus, Pencil, Route, Sigma, Sparkles, Trash2, X } from "lucide-react";
import { clsx } from "clsx";
import {
  calculateGraph,
  calculateIsolatedRootEffects,
  calculateScenario,
  calculateScenarioMultiplicativeEffect,
  rankScenarioInputNodes,
  type VdtImpactNode,
  type VdtInputSensitivity
} from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { SelectInput, TextInput } from "@/components/ui/field";
import { formatChange, formatNumber, formatPercent } from "@/lib/format";
import { ExplanationPanel } from "./explanation-panel";
import { useVdtStudioStore } from "./vdt-store";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const OVERRIDE_EPSILON = 1e-6;

const OVERRIDE_TABLE_HEADER_CLASS =
  "px-3 py-2 text-left text-2xs font-semibold uppercase tracking-normal text-muted";
const OVERRIDE_TABLE_CELL_CLASS = "px-3 py-2.5 align-middle";

function trapFocus(event: KeyboardEvent, container: HTMLElement) {
  if (event.key !== "Tab") {
    return;
  }

  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement
  );

  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement as HTMLElement | null;

  if (event.shiftKey) {
    if (active === first || !container.contains(active)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (active === last) {
    event.preventDefault();
    first.focus();
  }
}

function parseFiniteInput(value: string) {
  if (value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sortImpacts(impacts: VdtImpactNode[]) {
  return [...impacts].sort((left, right) => Math.abs(right.absoluteChange ?? 0) - Math.abs(left.absoluteChange ?? 0));
}

function commitOverrideValue(
  updateScenarioOverride: (scenarioId: string, nodeId: string, value?: number) => void,
  scenarioId: string,
  nodeId: string,
  baselineValue: number | undefined,
  rawValue: string
) {
  const parsed = parseFiniteInput(rawValue);
  if (
    parsed !== undefined &&
    baselineValue !== undefined &&
    Math.abs(parsed - baselineValue) <= OVERRIDE_EPSILON
  ) {
    updateScenarioOverride(scenarioId, nodeId, undefined);
    return;
  }

  updateScenarioOverride(scenarioId, nodeId, parsed);
}

function ScenarioOverrideRow({
  node,
  overrideValue,
  activeScenarioId,
  disabled,
  isolatedEffect,
  updateScenarioOverride
}: {
  node: VdtInputSensitivity;
  overrideValue: number | undefined;
  activeScenarioId: string | undefined;
  disabled: boolean;
  isolatedEffect: number | undefined;
  updateScenarioOverride: (scenarioId: string, nodeId: string, value?: number) => void;
}) {
  const baselineValue = node.baselineValue;
  const scenarioValue = overrideValue ?? baselineValue;
  const displayValue = scenarioValue !== undefined ? String(scenarioValue) : "";

  const differsFromBaseline =
    scenarioValue !== undefined &&
    baselineValue !== undefined &&
    Math.abs(scenarioValue - baselineValue) > OVERRIDE_EPSILON;

  return (
    <tr data-testid={`scenario-override-card-${node.nodeId}`} className="border-b border-line last:border-b-0">
      <td className={OVERRIDE_TABLE_CELL_CLASS}>
        <span className="block truncate text-xs font-semibold text-ink">{node.nodeName}</span>
      </td>
      <td className={OVERRIDE_TABLE_CELL_CLASS}>
        <span className="block truncate text-xs text-muted">{node.unit ?? "—"}</span>
      </td>
      <td className={clsx(OVERRIDE_TABLE_CELL_CLASS, "text-right")}>
        <span className="text-xs font-medium text-ink tabular-nums">
          {baselineValue !== undefined ? formatNumber(baselineValue) : "n/a"}
        </span>
      </td>
      <td className={OVERRIDE_TABLE_CELL_CLASS}>
        <TextInput
          className="h-8 w-full max-w-full py-1 text-right text-xs tabular-nums"
          type="number"
          placeholder={baselineValue === undefined ? "n/a" : String(baselineValue)}
          value={displayValue}
          disabled={disabled || !activeScenarioId}
          aria-label={`Scenario value for ${node.nodeName}`}
          onChange={(event) =>
            activeScenarioId
              ? commitOverrideValue(
                  updateScenarioOverride,
                  activeScenarioId,
                  node.nodeId,
                  baselineValue,
                  event.target.value
                )
              : undefined
          }
        />
      </td>
      <td className={clsx(OVERRIDE_TABLE_CELL_CLASS, "text-right")}>
        <span className="text-xs font-semibold text-ink tabular-nums">
          {differsFromBaseline && isolatedEffect !== undefined ? formatChange(isolatedEffect) : "—"}
        </span>
      </td>
    </tr>
  );
}

function ScenarioOverridesTable({
  rankedInputNodes,
  activeScenario,
  disabled,
  isolatedEffects,
  updateScenarioOverride
}: {
  rankedInputNodes: VdtInputSensitivity[];
  activeScenario: { id: string; overrides: { nodeId: string; value: number }[] } | undefined;
  disabled: boolean;
  isolatedEffects: Record<string, number | undefined>;
  updateScenarioOverride: (scenarioId: string, nodeId: string, value?: number) => void;
}) {
  return (
    <div
      className="overflow-x-auto rounded-md border border-line bg-white shadow-sm"
      data-testid="scenario-overrides-table"
    >
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col />
          <col className="w-[3.5rem]" />
          <col className="w-[4.5rem]" />
          <col className="w-[6rem]" />
          <col className="w-[4.5rem]" />
        </colgroup>
        <thead className="border-b border-line bg-slate-50">
          <tr>
            <th scope="col" className={OVERRIDE_TABLE_HEADER_CLASS}>
              Name
            </th>
            <th scope="col" className={OVERRIDE_TABLE_HEADER_CLASS}>
              Unit
            </th>
            <th scope="col" className={clsx(OVERRIDE_TABLE_HEADER_CLASS, "text-right")}>
              Baseline
            </th>
            <th scope="col" className={clsx(OVERRIDE_TABLE_HEADER_CLASS, "text-right")}>
              Scenario
            </th>
            <th scope="col" className={clsx(OVERRIDE_TABLE_HEADER_CLASS, "text-right")}>
              Effect
            </th>
          </tr>
        </thead>
        <tbody>
          {rankedInputNodes.map((node) => {
            const override = activeScenario?.overrides.find((candidate) => candidate.nodeId === node.nodeId);
            return (
              <ScenarioOverrideRow
                key={node.nodeId}
                node={node}
                overrideValue={override?.value}
                activeScenarioId={activeScenario?.id}
                disabled={disabled}
                isolatedEffect={isolatedEffects[node.nodeId]}
                updateScenarioOverride={updateScenarioOverride}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioModalContent() {
  const project = useVdtStudioStore((state) => state.project);
  const activeScenarioId = useVdtStudioStore((state) => state.activeScenarioId);
  const updateScenarioOverride = useVdtStudioStore((state) => state.updateScenarioOverride);
  const runAiAction = useVdtStudioStore((state) => state.runAiAction);
  const isRunningAiAction = useVdtStudioStore((state) => state.isRunningAiAction);
  const pendingExplanation = useVdtStudioStore((state) => state.pendingExplanation);
  const pendingExplanationTaskType = useVdtStudioStore((state) => state.pendingExplanationTaskType);

  const baseline = calculateGraph(project);
  const activeScenario = project.scenarios.find((scenario) => scenario.id === activeScenarioId) ?? project.scenarios[0];
  const scenarioResult = activeScenario ? calculateScenario(project, activeScenario) : undefined;
  const rankedInputNodes = useMemo(() => rankScenarioInputNodes(project), [project]);
  const traceItems = scenarioResult?.calculationTrace ?? baseline.trace;
  const impactedNodes = sortImpacts(scenarioResult?.impactedNodes ?? []);
  const isolatedEffects = useMemo(() => {
    const entries = rankedInputNodes.flatMap((node) => {
      const override = activeScenario?.overrides.find((candidate) => candidate.nodeId === node.nodeId);
      const scenarioValue = override?.value ?? node.baselineValue;
      if (scenarioValue === undefined || !Number.isFinite(scenarioValue)) {
        return [];
      }

      return [{ nodeId: node.nodeId, value: scenarioValue }];
    });

    return calculateIsolatedRootEffects(project, entries);
  }, [project, rankedInputNodes, activeScenario?.overrides]);
  const multiplicativeEffect = useMemo(
    () => (activeScenario ? calculateScenarioMultiplicativeEffect(project, activeScenario) : undefined),
    [project, activeScenario]
  );
  const hasScenarioOverrides = (activeScenario?.overrides.length ?? 0) > 0;
  const showScenarioExplanation =
    pendingExplanation && pendingExplanationTaskType === "explain_scenario";

  function explainScenario() {
    if (!activeScenario) {
      return;
    }

    void runAiAction("explain_scenario", {
      scenarioId: activeScenario.id,
      calculationSummary: {
        rootNodeId: project.rootNodeId,
        baselineRootValue: baseline.rootValue,
        scenarioRootValue: scenarioResult?.scenarioValue,
        rootDelta: scenarioResult?.absoluteChange,
        nodeValues: (scenarioResult?.impactedNodes ?? []).slice(0, 20).map((impact) => ({
          nodeId: impact.nodeId,
          baselineValue: impact.baselineValue,
          scenarioValue: impact.scenarioValue
        }))
      }
    });
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(220px,280px)_minmax(320px,1fr)_minmax(260px,320px)]">
      <div className="min-h-0 overflow-y-auto border-b border-line px-4 py-4 lg:border-b-0 lg:border-r lg:py-3">
        <div className="grid grid-cols-2 gap-4">
          <Metric label="Baseline" value={formatNumber(scenarioResult?.baselineValue ?? baseline.rootValue)} />
          <Metric label="Scenario" value={formatNumber(scenarioResult?.scenarioValue)} tone="positive" />
          <Metric label="Absolute" value={formatChange(scenarioResult?.absoluteChange)} tone="positive" />
          <Metric label="Percent" value={formatPercent(scenarioResult?.percentageChange)} tone="positive" />
        </div>
        <Button
          size="sm"
          className="mt-3"
          icon={<Sparkles className="h-4 w-4" />}
          disabled={isRunningAiAction || !activeScenario}
          onClick={explainScenario}
        >
          Explain scenario
        </Button>
        {showScenarioExplanation && pendingExplanationTaskType ? (
          <div className="mt-3">
            <ExplanationPanel taskType={pendingExplanationTaskType} result={pendingExplanation} />
          </div>
        ) : null}
        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-2 text-2xs font-semibold uppercase tracking-normal text-muted">Impacted drivers</div>
          <div className="space-y-2">
            {impactedNodes.length === 0 ? (
              <div className="rounded-md border border-line bg-white px-3 py-2 text-xs text-muted">
                No changed drivers yet.
              </div>
            ) : (
              impactedNodes.map((impact) => (
                <div key={impact.nodeId} className="rounded-md border border-line bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs font-semibold text-ink">{impact.nodeName}</span>
                    <span className="shrink-0 text-xs font-semibold text-ink">
                      {formatChange(impact.absoluteChange)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-2xs text-muted">
                    {formatNumber(impact.baselineValue)} to {formatNumber(impact.scenarioValue)}{" "}
                    {impact.unit ?? ""}
                  </div>
                </div>
              ))
            )}
            {hasScenarioOverrides && multiplicativeEffect ? (
              <div
                className="rounded-md border border-accent/30 bg-blue-50/60 px-3 py-2"
                data-testid="scenario-multiplicative-effect"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-semibold text-ink">Multiplicative effect</span>
                  <span className="shrink-0 text-xs font-semibold text-ink">
                    {multiplicativeEffect.multiplicativeEffect !== undefined &&
                    Math.abs(multiplicativeEffect.multiplicativeEffect) > OVERRIDE_EPSILON
                      ? formatChange(multiplicativeEffect.multiplicativeEffect)
                      : "—"}
                  </span>
                </div>
                <p className="mt-1 text-2xs leading-4 text-muted">
                  Combined root impact minus the sum of isolated driver effects (
                  {formatChange(multiplicativeEffect.totalRootEffect)} −{" "}
                  {formatChange(multiplicativeEffect.sumOfIsolatedEffects)})
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto border-b border-line px-4 py-4 lg:border-b-0 lg:py-3">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-muted">
          <Sigma className="h-4 w-4" />
          Overrides
        </div>
        <ScenarioOverridesTable
          rankedInputNodes={rankedInputNodes}
          activeScenario={activeScenario}
          disabled={!activeScenario}
          isolatedEffects={isolatedEffects}
          updateScenarioOverride={updateScenarioOverride}
        />
      </div>

      <div className="min-h-0 overflow-y-auto px-4 py-4 lg:border-l lg:py-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-normal text-muted">Calculation trace</div>
        <div className="space-y-2">
          {traceItems.map((item) => (
            <div key={item.nodeId} className="rounded-md border border-line bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-xs font-semibold text-ink">{item.nodeName}</span>
                <span className="shrink-0 text-xs font-semibold text-ink">{formatNumber(item.value)}</span>
              </div>
              {item.resolvedFormula ? (
                <div className="mt-1 truncate font-mono text-2xs text-muted">{item.resolvedFormula}</div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ScenarioModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerRef?: RefObject<HTMLElement | null>;
  children?: ReactNode;
}

export function ScenarioModal({
  open: controlledOpen,
  onOpenChange,
  triggerRef,
  children
}: ScenarioModalProps = {}) {
  const scenarioModalOpen = useVdtStudioStore((state) => state.scenarioModalOpen);
  const setScenarioModalOpen = useVdtStudioStore((state) => state.setScenarioModalOpen);
  const open = controlledOpen ?? scenarioModalOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) {
        setScenarioModalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange, setScenarioModalOpen]
  );

  const closeModal = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => {
      triggerRef?.current?.focus();
    });
  }, [setOpen, triggerRef]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  const project = useVdtStudioStore((state) => state.project);
  const activeScenarioId = useVdtStudioStore((state) => state.activeScenarioId);
  const createScenario = useVdtStudioStore((state) => state.createScenario);
  const setActiveScenarioId = useVdtStudioStore((state) => state.setActiveScenarioId);
  const renameScenario = useVdtStudioStore((state) => state.renameScenario);
  const deleteScenario = useVdtStudioStore((state) => state.deleteScenario);

  const activeScenario = project.scenarios.find((scenario) => scenario.id === activeScenarioId) ?? project.scenarios[0];
  const canDeleteScenario = project.scenarios.length > 1;
  const [isRenamingScenario, setIsRenamingScenario] = useState(false);
  const [scenarioNameDraft, setScenarioNameDraft] = useState(activeScenario?.name ?? "");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const cancelRenameRef = useRef(false);
  const renameOpenedAtRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setIsRenamingScenario(false);
      return;
    }

    setScenarioNameDraft(activeScenario?.name ?? "");
  }, [open, activeScenario?.id, activeScenario?.name]);

  useLayoutEffect(() => {
    if (!isRenamingScenario) {
      return;
    }

    renameInputRef.current?.focus({ preventScroll: true });
  }, [isRenamingScenario]);

  const commitScenarioRename = useCallback(() => {
    if (!activeScenario) {
      return;
    }

    const trimmed = scenarioNameDraft.trim();
    if (!trimmed) {
      setScenarioNameDraft(activeScenario.name);
      setIsRenamingScenario(false);
      return;
    }

    renameScenario(activeScenario.id, trimmed);
    setScenarioNameDraft(trimmed);
    setIsRenamingScenario(false);
  }, [activeScenario, renameScenario, scenarioNameDraft]);

  const handleDeleteScenario = useCallback(() => {
    if (!activeScenario || !canDeleteScenario || isRenamingScenario) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${activeScenario.name}"? This cannot be undone.`
    );
    if (confirmed) {
      deleteScenario(activeScenario.id);
    }
  }, [activeScenario, canDeleteScenario, deleteScenario, isRenamingScenario]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (isRenamingScenario) {
          cancelRenameRef.current = true;
          setScenarioNameDraft(activeScenario?.name ?? "");
          setIsRenamingScenario(false);
          return;
        }

        closeModal();
        return;
      }

      if (dialogRef.current) {
        trapFocus(event, dialogRef.current);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, closeModal, isRenamingScenario, activeScenario?.name]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        aria-hidden="true"
        data-testid="scenario-modal-backdrop"
        onClick={closeModal}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        data-testid="scenario-modal"
        className={clsx(
          "vdt-ui-scale relative z-10 flex h-[min(90vh,820px)] w-full max-w-[1200px] flex-col overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.26)]"
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-white px-5 py-4 shadow-sm sm:px-7">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-slate-50 text-accent shadow-sm">
              <Route className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-xl font-semibold text-ink">
                Scenario Mode
              </h2>
              <p id={subtitleId} className="mt-1 text-sm leading-5 text-muted">
                Override inputs and inspect deterministic impact.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              data-testid="edit-scenario-name"
              aria-label="Edit scenario name"
              icon={<Pencil className="h-4 w-4" />}
              disabled={!activeScenario || isRenamingScenario}
              onClick={() => {
                flushSync(() => {
                  setIsRenamingScenario(true);
                });
                renameOpenedAtRef.current = Date.now();
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              onClick={createScenario}
            >
              New
            </Button>
            <Button
              size="sm"
              variant="danger"
              data-testid="delete-scenario"
              icon={<Trash2 className="h-4 w-4" />}
              disabled={!activeScenario || !canDeleteScenario || isRenamingScenario}
              onClick={handleDeleteScenario}
            >
              Delete
            </Button>
            {isRenamingScenario ? (
              <TextInput
                ref={renameInputRef}
                className="min-w-[14rem] text-sm"
                aria-label="Scenario name"
                data-testid="scenario-name-input"
                value={scenarioNameDraft}
                disabled={!activeScenario}
                onChange={(event) => setScenarioNameDraft(event.target.value)}
                onBlur={() => {
                  window.setTimeout(() => {
                    if (Date.now() - renameOpenedAtRef.current < 250) {
                      return;
                    }

                    if (document.activeElement === renameInputRef.current) {
                      return;
                    }

                    if (cancelRenameRef.current) {
                      cancelRenameRef.current = false;
                      return;
                    }

                    setScenarioNameDraft(activeScenario?.name ?? "");
                    setIsRenamingScenario(false);
                  }, 0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitScenarioRename();
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelRenameRef.current = true;
                    setScenarioNameDraft(activeScenario?.name ?? "");
                    setIsRenamingScenario(false);
                  }
                }}
              />
            ) : (
              <SelectInput
                className="min-w-[14rem] text-sm"
                data-testid="scenario-select"
                value={activeScenario?.id ?? ""}
                title={activeScenario?.name}
                onChange={(event) => setActiveScenarioId(event.target.value)}
              >
                {project.scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id} title={scenario.name}>
                    {scenario.name}
                  </option>
                ))}
              </SelectInput>
            )}
            <Button
              size="icon"
              variant="ghost"
              aria-label="Close scenario mode"
              data-testid="scenario-modal-close"
              className="text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              icon={<X className="h-4 w-4" />}
              onClick={closeModal}
            />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden bg-slate-50">
          {children ?? <ScenarioModalContent />}
        </div>
      </div>
    </div>,
    document.body
  );
}
