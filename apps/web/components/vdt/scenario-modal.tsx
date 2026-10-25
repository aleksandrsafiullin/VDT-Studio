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
import { Plus, Pencil, Copy, Route, Sigma, Trash2, X } from "lucide-react";
import { clsx } from "clsx";
import {
  calculateGraph,
  calculateIsolatedRootEffects,
  calculateScenario,
  calculateScenarioMultiplicativeEffect,
  rankScenarioInputNodes,
  type VdtInputSensitivity,
  type VdtScenario
} from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { SelectInput, TextInput } from "@/components/ui/field";
import { PanelToggleButton } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/tooltip";
import { formatChange, formatNumber, formatPercent, countDecimalPlacesFromNumber, countDecimalPlacesFromString } from "@/lib/format";
import { parseScenarioNumberInput, stepScenarioNumberInput } from "@/lib/scenario-number-input";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./scenario-modal.module.css";

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

function commitOverrideValue(
  updateScenarioOverride: (scenarioId: string, nodeId: string, value?: number) => void,
  scenarioId: string,
  nodeId: string,
  baselineValue: number | undefined,
  rawValue: string
) {
  const parsed = parseScenarioNumberInput(rawValue);
  if (rawValue.trim() !== "" && parsed === undefined) {
    return;
  }
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

function initialStepDecimalPlaces(
  overrideValue: number | undefined,
  baselineValue: number | undefined
) {
  return Math.max(
    Math.min(2, countDecimalPlacesFromNumber(overrideValue ?? baselineValue)),
    Math.min(2, countDecimalPlacesFromNumber(baselineValue))
  );
}

function ScenarioOverrideRow({
  node,
  overrideValue,
  activeScenarioId,
  disabled,
  isolatedEffect,
  comment,
  updateScenarioOverride,
  updateScenarioComment
}: {
  node: VdtInputSensitivity;
  overrideValue: number | undefined;
  activeScenarioId: string | undefined;
  disabled: boolean;
  isolatedEffect: number | undefined;
  comment: string;
  updateScenarioOverride: (scenarioId: string, nodeId: string, value?: number) => void;
  updateScenarioComment: (scenarioId: string, nodeId: string, text: string) => void;
}) {
  const baselineValue = node.baselineValue;
  const scenarioValue = overrideValue ?? baselineValue;
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const displayValue = isEditing ? draftValue : scenarioValue !== undefined
    ? formatNumber(scenarioValue) : "";
  const invalidDraft = isEditing && draftValue.trim() !== "" && parseScenarioNumberInput(draftValue) === undefined;
  const [stepDecimalPlaces, setStepDecimalPlaces] = useState(() =>
    initialStepDecimalPlaces(overrideValue, baselineValue)
  );

  useEffect(() => {
    if (!isEditing) {
      setStepDecimalPlaces(initialStepDecimalPlaces(overrideValue, baselineValue));
    }
  }, [node.nodeId, activeScenarioId, overrideValue, baselineValue, isEditing]);

  const differsFromBaseline =
    scenarioValue !== undefined &&
    baselineValue !== undefined &&
    Math.abs(scenarioValue - baselineValue) > OVERRIDE_EPSILON;

  return (
    <tr data-testid={`scenario-override-card-${node.nodeId}`} className={styles.overrideRow}>
      <td className={OVERRIDE_TABLE_CELL_CLASS}>
        <span className={clsx(styles.nodeName, "text-xs font-medium")} title={node.nodeName}>{node.nodeName}</span>
      </td>
      <td className={OVERRIDE_TABLE_CELL_CLASS}>
        <span className="block whitespace-nowrap text-xs text-muted">{node.unit ?? "—"}</span>
      </td>
      <td className={clsx(OVERRIDE_TABLE_CELL_CLASS, "text-right")}>
        <span className="whitespace-nowrap text-xs font-medium text-ink tabular-nums">
          {baselineValue !== undefined ? formatNumber(baselineValue) : "n/a"}
        </span>
      </td>
      <td className={OVERRIDE_TABLE_CELL_CLASS}>
        <TextInput
          className={clsx(styles.valueInput, "text-right text-xs tabular-nums")}
          type="text"
          inputMode="decimal"
          lang="en"
          role="spinbutton"
          autoComplete="off"
          spellCheck={false}
          aria-valuenow={scenarioValue}
          aria-valuetext={displayValue || undefined}
          aria-invalid={invalidDraft || undefined}
          placeholder={baselineValue === undefined ? "n/a" : formatNumber(baselineValue)}
          value={displayValue}
          title={invalidDraft ? "Use a dot for decimals and commas for thousands." : scenarioValue === undefined ? undefined : String(scenarioValue)}
          disabled={disabled || !activeScenarioId}
          aria-label={`Scenario value for ${node.nodeName}`}
          onFocus={() => {
            setDraftValue(scenarioValue === undefined ? "" : String(scenarioValue));
            setIsEditing(true);
          }}
          onBlur={() => setIsEditing(false)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
              return;
            }
            event.preventDefault();
            if (!activeScenarioId) {
              return;
            }
            const currentValue = parseScenarioNumberInput(draftValue) ?? scenarioValue ?? 0;
            const nextValue = stepScenarioNumberInput(currentValue, stepDecimalPlaces, event.key === "ArrowUp" ? 1 : -1);
            if (!Number.isFinite(nextValue)) {
              return;
            }
            const rawValue = String(nextValue);
            setDraftValue(rawValue);
            commitOverrideValue(updateScenarioOverride, activeScenarioId, node.nodeId, baselineValue, rawValue);
          }}
          onChange={(event) => {
            const rawValue = event.target.value;
            setDraftValue(rawValue);
            const fromString = countDecimalPlacesFromString(rawValue.replaceAll(",", ""));
            if (fromString !== undefined) {
              setStepDecimalPlaces((current) => Math.max(current, fromString));
            }

            if (activeScenarioId) {
              commitOverrideValue(
                updateScenarioOverride,
                activeScenarioId,
                node.nodeId,
                baselineValue,
                rawValue
              );
            }
          }}
        />
      </td>
      <td className={clsx(OVERRIDE_TABLE_CELL_CLASS, "text-right")}>
        <span className="whitespace-nowrap text-xs font-semibold text-ink tabular-nums">
          {differsFromBaseline && isolatedEffect !== undefined ? formatChange(isolatedEffect) : "—"}
        </span>
      </td>
      <td className={OVERRIDE_TABLE_CELL_CLASS}>
        <textarea
          className={styles.commentInput}
          rows={1}
          placeholder="How will you achieve this?"
          aria-label={`Scenario comment for ${node.nodeName}`}
          value={comment}
          disabled={disabled || !activeScenarioId}
          onChange={(event) => {
            if (activeScenarioId) {
              updateScenarioComment(activeScenarioId, node.nodeId, event.target.value);
            }
          }}
        />
      </td>
    </tr>
  );
}

function ScenarioOverridesTable({
  rankedInputNodes,
  activeScenario,
  disabled,
  isolatedEffects,
  updateScenarioOverride,
  updateScenarioComment
}: {
  rankedInputNodes: VdtInputSensitivity[];
  activeScenario: VdtScenario | undefined;
  disabled: boolean;
  isolatedEffects: Record<string, number | undefined>;
  updateScenarioOverride: (scenarioId: string, nodeId: string, value?: number) => void;
  updateScenarioComment: (scenarioId: string, nodeId: string, text: string) => void;
}) {
  return (
    <div
      className={styles.tableContainer}
      data-testid="scenario-overrides-table"
    >
      <table className={styles.table}>
        <colgroup>
          <col className="w-[29%]" />
          <col className="w-[9%]" />
          <col className="w-[11%]" />
          <col className="w-[12%]" />
          <col className="w-[11%]" />
          <col className="w-[28%]" />
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
            <th scope="col" className={OVERRIDE_TABLE_HEADER_CLASS}>
              Comment
            </th>
          </tr>
        </thead>
        <tbody>
          {rankedInputNodes.map((node) => {
            const override = activeScenario?.overrides.find((candidate) => candidate.nodeId === node.nodeId);
            return (
              <ScenarioOverrideRow
                key={`${activeScenario?.id ?? "none"}:${node.nodeId}`}
                node={node}
                overrideValue={override?.value}
                activeScenarioId={activeScenario?.id}
                disabled={disabled}
                isolatedEffect={isolatedEffects[node.nodeId]}
                comment={activeScenario?.comments?.find((comment) => comment.nodeId === node.nodeId)?.text ?? ""}
                updateScenarioOverride={updateScenarioOverride}
                updateScenarioComment={updateScenarioComment}
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
  const updateScenarioComment = useVdtStudioStore((state) => state.updateScenarioComment);
  const [traceExpanded, setTraceExpanded] = useState(false);
  const traceId = useId();

  const baseline = calculateGraph(project);
  const activeScenario = project.scenarios.find((scenario) => scenario.id === activeScenarioId) ?? project.scenarios[0];
  const scenarioResult = activeScenario ? calculateScenario(project, activeScenario) : undefined;
  const rankedInputNodes = useMemo(() => rankScenarioInputNodes(project), [project]);
  const traceItems = scenarioResult?.calculationTrace ?? baseline.trace;
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

  return (
    <div className={styles.contentLayout}>
      <div
        className={styles.mainContent}
        data-testid="scenario-middle-column"
      >
        <div className={styles.totalsCard}>
          <div
            className="grid min-w-0 flex-1 grid-cols-2 gap-4 sm:grid-cols-4"
            data-testid="scenario-totals-metrics"
          >
            <Metric label="Baseline" value={formatNumber(scenarioResult?.baselineValue ?? baseline.rootValue)} />
            <Metric label="Scenario" value={formatNumber(scenarioResult?.scenarioValue)} tone="positive" />
            <Metric label="Absolute" value={formatChange(scenarioResult?.absoluteChange)} tone="positive" />
            <Metric label="Percent" value={formatPercent(scenarioResult?.percentageChange)} tone="positive" />
          </div>
        </div>
        <div className={styles.sectionHeading}>
          <Sigma className="h-4 w-4" />
          <h3>Overrides</h3>
        </div>
        <ScenarioOverridesTable
          rankedInputNodes={rankedInputNodes}
          activeScenario={activeScenario}
          disabled={!activeScenario}
          isolatedEffects={isolatedEffects}
          updateScenarioOverride={updateScenarioOverride}
          updateScenarioComment={updateScenarioComment}
        />
        {hasScenarioOverrides && multiplicativeEffect ? (
          <div
            className={styles.multiplicativeEffect}
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

      <aside className={clsx(styles.tracePanel, traceExpanded ? styles.traceExpanded : styles.traceCollapsed)}>
        <div className={styles.traceHeader}>
          {traceExpanded ? <h3>Calculation trace</h3> : null}
          <PanelToggleButton
            panel="right"
            expanded={traceExpanded}
            onToggle={() => setTraceExpanded((expanded) => !expanded)}
            testId="scenario-trace-toggle"
            aria-label={traceExpanded ? "Collapse calculation trace" : "Expand calculation trace"}
            title={traceExpanded ? "Collapse calculation trace" : "Expand calculation trace"}
            aria-expanded={traceExpanded}
            aria-controls={traceId}
          />
        </div>
        <div id={traceId} hidden={!traceExpanded} className={styles.traceList} data-testid="scenario-calculation-trace">
          {traceItems.map((item) => (
            <div key={item.nodeId} className={styles.traceItem}>
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-xs font-medium text-ink" title={item.nodeName}>{item.nodeName}</span>
                <span className="shrink-0 text-xs font-semibold text-ink">{formatNumber(item.value)}</span>
              </div>
              {item.resolvedFormula ? (
                <div className="mt-1 truncate font-mono text-2xs text-muted" title={item.resolvedFormula}>{item.resolvedFormula}</div>
              ) : null}
            </div>
          ))}
        </div>
        {!traceExpanded ? <span className={styles.traceVerticalLabel} aria-hidden>Calculation trace</span> : null}
      </aside>
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
  const project = useVdtStudioStore((state) => state.project);
  const activeScenarioId = useVdtStudioStore((state) => state.activeScenarioId);
  const createScenario = useVdtStudioStore((state) => state.createScenario);
  const setActiveScenarioId = useVdtStudioStore((state) => state.setActiveScenarioId);
  const setMainScenario = useVdtStudioStore((state) => state.setMainScenario);
  const renameScenario = useVdtStudioStore((state) => state.renameScenario);
  const deleteScenario = useVdtStudioStore((state) => state.deleteScenario);
  const cloneScenario = useVdtStudioStore((state) => state.cloneScenario);

  const activeScenario = project.scenarios.find((scenario) => scenario.id === activeScenarioId) ?? project.scenarios[0];
  const canDeleteScenario = project.scenarios.length > 1;
  const isMainScenario = activeScenario?.isMain === true;
  const [isRenamingScenario, setIsRenamingScenario] = useState(false);
  const [scenarioNameDraft, setScenarioNameDraft] = useState(activeScenario?.name ?? "");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const cancelRenameRef = useRef(false);
  const skipRenameBlurRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setIsRenamingScenario(false);
      skipRenameBlurRef.current = false;
      return;
    }

    setScenarioNameDraft(activeScenario?.name ?? "");
  }, [open, activeScenario?.id, activeScenario?.name]);

  useLayoutEffect(() => {
    if (!isRenamingScenario) {
      return;
    }

    renameInputRef.current?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      skipRenameBlurRef.current = false;
    });
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
    <div className={styles.overlay}>
      <div
        className={styles.backdrop}
        aria-hidden="true"
        data-testid="scenario-modal-backdrop"
        onClick={closeModal}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="scenario-modal"
        className={clsx("vdt-ui-scale", styles.dialog)}
      >
        <header className={styles.header}>
          <div className={styles.identity}>
            <span className={styles.scenarioMark}>
              <Route className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className={styles.title}>
                Scenario Mode
              </h2>
            </div>
          </div>
          <div className={styles.actions}>
            <label className={styles.mainScenarioLabel}>
              <input
                type="checkbox"
                data-testid="main-scenario-checkbox"
                className="h-3.5 w-3.5 rounded border-line text-accent focus:ring-accent"
                checked={isMainScenario}
                disabled={!activeScenario || isRenamingScenario}
                onChange={(event) => {
                  if (!activeScenario) {
                    return;
                  }

                  if (event.target.checked) {
                    setMainScenario(activeScenario.id);
                    return;
                  }

                  const fallback = project.scenarios.find((scenario) => scenario.id !== activeScenario.id);
                  if (fallback) {
                    setMainScenario(fallback.id);
                  }
                }}
              />
              Main Scenario
            </label>
            {!isRenamingScenario ? (
              <Tooltip label="Edit scenario name">
                <Button
                  size="icon"
                  variant="secondary"
                  data-testid="edit-scenario-name"
                  aria-label="Edit scenario name"
                  icon={<Pencil className="h-4 w-4" />}
                  disabled={!activeScenario}
                  className="shrink-0"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    skipRenameBlurRef.current = true;
                    flushSync(() => {
                      setIsRenamingScenario(true);
                    });
                  }}
                />
              </Tooltip>
            ) : null}
            <Tooltip label="New scenario">
              <Button
                size="icon"
                variant="secondary"
                data-testid="new-scenario"
                aria-label="New scenario"
                icon={<Plus className="h-4 w-4" />}
                disabled={isRenamingScenario}
                className="shrink-0"
                onClick={createScenario}
              />
            </Tooltip>
            <Tooltip label="Clone scenario">
              <Button
                size="icon"
                variant="secondary"
                data-testid="clone-scenario"
                aria-label="Clone scenario"
                icon={<Copy className="h-4 w-4" />}
                disabled={!activeScenario || isRenamingScenario}
                className="shrink-0"
                onClick={() => activeScenario && cloneScenario(activeScenario.id)}
              />
            </Tooltip>
            <Tooltip label="Delete scenario">
              <Button
                size="icon"
                variant="danger"
                data-testid="delete-scenario"
                aria-label="Delete scenario"
                icon={<Trash2 className="h-4 w-4" />}
                disabled={!activeScenario || !canDeleteScenario || isRenamingScenario}
                className="shrink-0"
                onClick={handleDeleteScenario}
              />
            </Tooltip>
            {isRenamingScenario ? (
              <TextInput
                ref={renameInputRef}
                autoFocus
                className={styles.scenarioSelect}
                aria-label="Scenario name"
                data-testid="scenario-name-input"
                value={scenarioNameDraft}
                disabled={!activeScenario}
                onChange={(event) => setScenarioNameDraft(event.target.value)}
                onBlur={() => {
                  window.setTimeout(() => {
                    if (skipRenameBlurRef.current) {
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
                className={styles.scenarioSelect}
                data-testid="scenario-select"
                aria-label="Active scenario"
                value={activeScenario?.id ?? ""}
                title={activeScenario?.name}
                onChange={(event) => setActiveScenarioId(event.target.value)}
              >
                {project.scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id} title={scenario.name}>
                    {scenario.isMain ? `★ ${scenario.name}` : scenario.name}
                  </option>
                ))}
              </SelectInput>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close scenario mode"
            data-testid="scenario-modal-close"
            className={styles.closeButton}
            icon={<X className="h-4 w-4" />}
            onClick={closeModal}
          />
        </header>

        <div className={styles.body}>
          {children ?? <ScenarioModalContent />}
        </div>
      </div>
    </div>,
    document.body
  );
}
