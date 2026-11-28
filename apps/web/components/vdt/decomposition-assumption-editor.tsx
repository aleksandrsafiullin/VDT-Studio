"use client";

import { useState } from "react";
import { clsx } from "clsx";
import {
  applyDecompositionAssumptionOperation, decompositionAssumptionLimits, decompositionRelationshipOperands,
  decompositionRelationshipUnit, readDecompositionAssumptions,
  type DecompositionAssumption, type DecompositionRelationship, type VdtNode
} from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { makeId } from "@/lib/id";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./workspace-shell.module.css";

const relationshipLabels: Record<DecompositionRelationship["kind"], string> = {
  serial_capacity: "Serial capacity · lower capacity limits output",
  independent_additive: "Independent flows · outputs add without overlap",
  quantity_rate: "Quantity × rate · output is the product"
};

interface AssumptionDraft {
  previous?: DecompositionAssumption;
  statement: string;
  condition: string;
  confirmed: boolean;
  confirmedOutputUnit?: string | undefined;
  kind: DecompositionRelationship["kind"] | "";
  first: string;
  second: string;
  firstUnit?: string | undefined;
  secondUnit?: string | undefined;
}

interface OperandChoice {
  id: string;
  name: string;
  unit: string;
}

function operandOption(id: string, unit: string | undefined) {
  return id && unit ? JSON.stringify([id, unit]) : "";
}

function QuantityRateOperand({ label, choices, id, unit, otherId, onChange }: {
  label: string;
  choices: OperandChoice[];
  id: string;
  unit: string | undefined;
  otherId: string;
  onChange: (choice: OperandChoice | undefined) => void;
}) {
  const value = operandOption(id, unit);
  const current = choices.some(choice => operandOption(choice.id, choice.unit) === value);
  return <Field label={label}>
    <SelectInput required value={value} onChange={event => {
      onChange(choices.find(choice => operandOption(choice.id, choice.unit) === event.target.value));
    }}>
      <option value="">Choose a KPI</option>
      {value && !current ? <option value={value} disabled>{id} · {unit} (unavailable)</option> : null}
      {choices.map(choice => <option key={choice.id} value={operandOption(choice.id, choice.unit)} disabled={choice.id === otherId}>
        {choice.name} [{choice.id}] · {choice.unit}
      </option>)}
    </SelectInput>
  </Field>;
}

export function DecompositionAssumptionEditor({ projectId, vdtId, node }: { projectId: string; vdtId: string | undefined; node: VdtNode }) {
  const assumptions = readDecompositionAssumptions(node);
  const [draft, setDraft] = useState<AssumptionDraft>();
  const [error, setError] = useState("");
  const graphNodes = useVdtStudioStore(state => state.project.graph.nodes);
  const unit = node.unit?.trim();
  const operands = unit ? graphNodes.filter(candidate => candidate.id !== node.id && candidate.status !== "rejected"
    && decompositionRelationshipUnit(candidate.unit) === decompositionRelationshipUnit(unit)) : [];
  const quantityRateChoices = unit ? graphNodes.flatMap(candidate => {
    const candidateUnit = candidate.unit?.trim();
    return candidate.id !== node.id && candidate.status !== "rejected" && candidateUnit
      ? [{ id: candidate.id, name: candidate.name, unit: candidateUnit }] : [];
  }) : [];
  const previous = draft?.previous;
  const quantityRate = draft?.kind === "quantity_rate";
  const typedUnchanged = previous?.relationship
    ? draft?.kind === previous.relationship.kind && draft.first === previous.relationship.operandNodeIds[0]
      && draft.second === previous.relationship.operandNodeIds[1] && unit === previous.relationship.unit
      && (previous.relationship.kind !== "quantity_rate" || (
        draft.firstUnit === previous.relationship.operandUnits[0] && draft.secondUnit === previous.relationship.operandUnits[1]
        && quantityRateChoices.some(choice => choice.id === draft.first && choice.unit === draft.firstUnit)
        && quantityRateChoices.some(choice => choice.id === draft.second && choice.unit === draft.secondUnit)
      ))
      && draft.condition.trim() === previous.changesConclusionWhen
    : !draft?.kind;
  const priorEvidence = typedUnchanged && previous?.statement === draft?.statement.trim() ? previous?.evidence : undefined;

  return (
    <section className={clsx(styles.inspectorSection, styles.sectionDivider)} aria-label="Decomposition assumptions">
      <h3 className={styles.notesHeading}>Decomposition assumptions</h3>
      {assumptions.map(assumption => (
        <div key={assumption.note} className="grid min-w-0 gap-1.5">
          <p className="break-words text-xs">{assumption.statement}</p>
          <p className="break-words text-xs text-graphite">
            {assumption.relationship ? relationshipLabels[assumption.relationship.kind] : "Formula behavior unverified"}
          </p>
          <div className="break-words text-xs text-graphite">
            <span className="font-medium">Reconsider when</span>
            <p>{assumption.changesConclusionWhen}</p>
          </div>
          <p className="break-words text-xs text-graphite">
            {assumption.evidence.kind === "provisional" ? "Provisional" : `Confirmed by user (${assumption.evidence.sourceId})`}
          </p>
          {assumption.evidence.kind === "user_confirmed" && assumption.evidence.quote !== assumption.statement
            ? <blockquote className="break-words text-xs text-graphite">{assumption.evidence.quote}</blockquote> : null}
          <Button type="button" size="sm" className="justify-self-start" onClick={() => {
            setError("");
            setDraft({
              previous: assumption, statement: assumption.statement, condition: assumption.changesConclusionWhen, confirmed: false,
              kind: assumption.relationship?.kind ?? "", first: assumption.relationship?.operandNodeIds[0] ?? "",
              second: assumption.relationship?.operandNodeIds[1] ?? "",
              firstUnit: assumption.relationship?.kind === "quantity_rate" ? assumption.relationship.operandUnits[0] : undefined,
              secondUnit: assumption.relationship?.kind === "quantity_rate" ? assumption.relationship.operandUnits[1] : undefined
            });
          }}>Revise</Button>
        </div>
      ))}
      {!draft ? (
        <Button type="button" size="sm" className="justify-self-start" onClick={() => setDraft({ statement: "", condition: "", confirmed: false, kind: "", first: "", second: "" })}>
          Add assumption
        </Button>
      ) : (
        <form className="grid min-w-0 gap-3" onSubmit={event => {
          event.preventDefault();
          const { project, updateNode, workspace } = useVdtStudioStore.getState();
          if (project.id !== projectId || workspace.activeVdtId !== vdtId) {
            setError("The active model changed. Reopen the assumption editor.");
            return;
          }
          const operationId = makeId("editor_confirmation");
          if (draft.kind && (!unit || !draft.first || !draft.second)) {
            setError(quantityRate ? "Choose a quantity KPI and a rate KPI with an output unit." : "Choose two KPIs that share the output unit.");
            return;
          }
          const current = project.graph.nodes.find(candidate => candidate.id === node.id);
          if (!current) {
            setError("The selected KPI changed. Reopen the assumption editor.");
            return;
          }
          let relationship: DecompositionRelationship | undefined;
          if (draft.kind && unit) {
            const operandNodeIds: [string, string] = [draft.first, draft.second];
            if (draft.kind === "quantity_rate") {
              const nodes = new Map(project.graph.nodes.map(candidate => [candidate.id, candidate]));
              if (!draft.firstUnit || !draft.secondUnit || current.unit?.trim() !== unit
                || nodes.get(draft.first)?.unit?.trim() !== draft.firstUnit || nodes.get(draft.second)?.unit?.trim() !== draft.secondUnit) {
                setError("A unit changed. Choose the quantity and rate again before saving.");
                return;
              }
              if (draft.confirmed && draft.confirmedOutputUnit !== unit) {
                setError("The output unit changed. Confirm the relationship again before saving.");
                return;
              }
              relationship = { kind: draft.kind, operandNodeIds, operandUnits: [draft.firstUnit, draft.secondUnit], unit };
              if (!decompositionRelationshipOperands(current, relationship, nodes)) {
                setError("Choose a quantity and a rate that multiply to the output unit without conversion.");
                return;
              }
            } else {
              relationship = { kind: draft.kind, operandNodeIds, unit };
            }
          }
          const operation = applyDecompositionAssumptionOperation(project, {
            nodeId: node.id,
            statement: draft.statement,
            changesConclusionWhen: draft.condition,
            previousNote: draft.previous?.note,
            relationship,
            evidence: draft.confirmed
              ? { kind: "user_confirmed", sourceId: operationId, quote: draft.statement.trim() }
              : priorEvidence ?? { kind: "provisional" }
          }, { operationId, now: new Date().toISOString() });
          if (operation.status === "error") {
            setError(operation.message);
            return;
          }
          if (operation.project !== project) {
            updateNode(node.id, { ...operation.patch, status: current.status });
          }
          setDraft(undefined);
          setError("");
        }}>
          <Field label="Relationship type">
            <SelectInput value={draft.kind} onChange={event => {
              const kind = event.target.value as AssumptionDraft["kind"];
              const rolesChanged = (kind === "quantity_rate") !== quantityRate;
              setDraft({ ...draft, kind, confirmed: false, ...(rolesChanged
                ? { first: "", second: "", firstUnit: undefined, secondUnit: undefined } : {}) });
            }}>
              <option value="">Free-form relationship</option>
              <option value="serial_capacity" disabled={operands.length < 2}>{relationshipLabels.serial_capacity}</option>
              <option value="independent_additive" disabled={operands.length < 2}>{relationshipLabels.independent_additive}</option>
              <option value="quantity_rate" disabled={quantityRateChoices.length < 2}>{relationshipLabels.quantity_rate}</option>
            </SelectInput>
          </Field>
          {quantityRate ? <>
            <p className="text-xs text-graphite">Output unit {unit}</p>
            <QuantityRateOperand label="Quantity KPI (count)" choices={quantityRateChoices} id={draft.first} unit={draft.firstUnit}
              otherId={draft.second} onChange={choice => setDraft({
                ...draft, first: choice?.id ?? "", firstUnit: choice?.unit, confirmed: false
              })} />
            <QuantityRateOperand label="Rate KPI (per item)" choices={quantityRateChoices} id={draft.second} unit={draft.secondUnit}
              otherId={draft.first} onChange={choice => setDraft({
                ...draft, second: choice?.id ?? "", secondUnit: choice?.unit, confirmed: false
              })} />
          </> : draft.kind ? <>
            <p className="text-xs text-graphite">Unit basis {unit}</p>
            <Field label="First participating KPI">
              <SelectInput required value={draft.first} onChange={event => setDraft({ ...draft, first: event.target.value, confirmed: false })}>
                <option value="">Choose a KPI</option>
                {operands.map(operand => <option key={operand.id} value={operand.id} disabled={operand.id === draft.second}>
                  {operand.name} [{operand.id}]
                </option>)}
              </SelectInput>
            </Field>
            <Field label="Second participating KPI">
              <SelectInput required value={draft.second} onChange={event => setDraft({ ...draft, second: event.target.value, confirmed: false })}>
                <option value="">Choose a KPI</option>
                {operands.map(operand => <option key={operand.id} value={operand.id} disabled={operand.id === draft.first}>
                  {operand.name} [{operand.id}]
                </option>)}
              </SelectInput>
            </Field>
          </> : null}
          <Field label="Relationship">
            <TextInput required maxLength={decompositionAssumptionLimits.text} value={draft.statement}
              onChange={event => setDraft({ ...draft, statement: event.target.value, confirmed: false })} />
          </Field>
          <Field label="When would the conclusion change?">
            <TextInput required maxLength={decompositionAssumptionLimits.text} value={draft.condition}
              onChange={event => setDraft({ ...draft, condition: event.target.value, confirmed: false })} />
          </Field>
          {priorEvidence?.kind === "user_confirmed" ? (
            <p className="text-xs text-graphite">The existing confirmation applies to this relationship.</p>
          ) : (
            <label className="flex items-center text-xs">
              <input type="checkbox" checked={draft.confirmed}
                onChange={event => setDraft({ ...draft, confirmed: event.target.checked, confirmedOutputUnit: unit })} />
              I confirm this relationship
            </label>
          )}
          {error && <p role="alert" className="text-xs">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm">{draft.previous ? "Update assumption" : "Record assumption"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => {
              setDraft(undefined);
              setError("");
            }}>Cancel</Button>
          </div>
        </form>
      )}
    </section>
  );
}
