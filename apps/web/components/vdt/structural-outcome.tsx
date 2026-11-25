import { memo } from "react";
import { evaluateModelReadiness, getDecompositionContextGroupIds, isIllustrativeValue, readDecompositionAssumptions, readNodeBaselineValue, type VdtNode, type VdtProject } from "@vdt-studio/vdt-core";
import { incomingKpiReadableFormula } from "./incoming-kpi-formula-field";
import styles from "./agent-chat.module.css";

function inputRole(node: VdtNode) {
  if (node.type === "external_factor" || node.status === "external_factor" || node.controllability === "none") return "External factor";
  if (node.controllability) return `Actionable · ${node.controllability} control`;
  return node.type === "assumption" ? "Assumption" : "Input";
}

export const StructuralOutcome = memo(function StructuralOutcome({
  verifiedProject,
  currentProject,
  onSelectNode
}: {
  verifiedProject: VdtProject;
  currentProject: VdtProject;
  onSelectNode: (nodeId: string) => void;
}) {
  const references = verifiedProject.graph.nodes.map(({ id, name }) => ({ alias: id, name }));
  const verifiedNodes = verifiedProject.graph.nodes.filter(node => node.status !== "rejected");
  const formulas = verifiedNodes.filter(node => node.formula?.trim()).sort((a, b) =>
    Number(b.id === verifiedProject.rootNodeId) - Number(a.id === verifiedProject.rootNodeId));
  const assumptions = verifiedNodes.flatMap(node => {
    const decisions = new Map(readDecompositionAssumptions(node).map(decision => [decision.note, decision]));
    return [...new Set(node.assumptions ?? [])].filter(note => note.trim())
      .map(note => ({ id: node.id, name: node.name, note, decision: decisions.get(note) }));
  });
  const missing = evaluateModelReadiness(currentProject, { purpose: "structural_model" }).missingInputs;
  const missingById = new Map(missing.map(input => [input.nodeId, input]));
  const contextGroups = getDecompositionContextGroupIds(currentProject.graph, currentProject.rootNodeId);
  const inputs = currentProject.graph.nodes.filter(node => node.status !== "rejected" && node.type !== "calculated"
    && !node.formula?.trim() && !node.goalSeek && !contextGroups.has(node.id));

  return (
    <section className={`mt-3 space-y-3 border border-line p-3 text-xs leading-5 text-ink ${styles.actionCard}`}
      aria-label="Verified structure" data-testid="agent-structural-outcome">
      <h3 className="text-sm font-semibold">Verified structure</h3>
      {formulas.length > 0 && <ul className="space-y-1" aria-label="Verified formulas">
        {formulas.map(node => (
          <li key={node.id} className="break-words">
            <strong>{node.name}</strong> = {incomingKpiReadableFormula(node.formula!, references).map(part =>
              part.kind === "reference" ? part.reference.name : part.text.replaceAll("*", "×").replaceAll("/", "÷")
            ).join("")}
          </li>
        ))}
      </ul>}
      {assumptions.length > 0 && <div>
        <h4 className="font-semibold">Assumptions at verification</h4>
        <ul className="space-y-1">
          {assumptions.map(({ id, name, note, decision }) => (
            <li className="break-words" key={JSON.stringify([id, note])}>
              <strong>{name}</strong> · {decision?.statement ?? note}
              {decision && <p className="text-muted">
                {decision.evidence.kind === "user_confirmed" ? "Confirmed by user" : "Provisional"}
                {" · Reconsider if "}{decision.changesConclusionWhen}
              </p>}
            </li>
          ))}
        </ul>
      </div>}
      <div>
        <h4 className="font-semibold">Current inputs</h4>
        <p className="text-muted">
          {missing.length ? `${missing.length} missing measurement${missing.length === 1 ? "" : "s"}. ` : ""}
          Select an input to edit its baseline in the Inspector, or supply the value in chat.
        </p>
        <ul className="divide-y divide-line">
          {inputs.map(node => {
            const needed = missingById.get(node.id);
            const amount = readNodeBaselineValue(node);
            const estimate = amount !== undefined && isIllustrativeValue(node);
            return (
              <li key={node.id} className="py-1.5">
                <button type="button" data-node-id={node.id} className="text-left font-semibold underline decoration-line underline-offset-2 hover:decoration-current"
                  onClick={() => onSelectNode(node.id)}>{node.name}</button>
                <p className="text-muted">
                  {inputRole(node)}
                  {needed ? ` · ${needed.requiredForRoot ? "Missing measurement · needed for root" : "Missing measurement"}` : ""}
                  {amount !== undefined && !estimate && (node.valueStatus === "user_provided_value" || node.valueSource?.sourceTier === "user_input") ? " · User-provided" : ""}
                  {node.unit ? ` · ${node.unit}` : ""}
                </p>
                {amount !== undefined && <p className={estimate ? "text-amber-800" : "tabular-nums"}>
                  {estimate ? "Illustrative estimate · " : ""}{amount}
                </p>}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
});
