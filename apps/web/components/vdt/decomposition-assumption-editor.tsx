"use client";

import { useState } from "react";
import { clsx } from "clsx";
import {
  applyDecompositionAssumptionOperation, decompositionAssumptionLimits, readDecompositionAssumptions,
  type DecompositionAssumption, type VdtNode
} from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { makeId } from "@/lib/id";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./workspace-shell.module.css";

export function DecompositionAssumptionEditor({ projectId, vdtId, node }: { projectId: string; vdtId: string | undefined; node: VdtNode }) {
  const assumptions = readDecompositionAssumptions(node);
  const [draft, setDraft] = useState<{ previous?: DecompositionAssumption; statement: string; condition: string; confirmed: boolean }>();
  const [error, setError] = useState("");

  return (
    <section className={clsx(styles.inspectorSection, styles.sectionDivider)} aria-label="Decomposition assumptions">
      <h3 className={styles.notesHeading}>Decomposition assumptions</h3>
      {assumptions.map(assumption => (
        <div key={assumption.note} className="grid min-w-0 gap-1.5">
          <p className="break-words text-xs">{assumption.statement}</p>
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
            setDraft({ previous: assumption, statement: assumption.statement, condition: assumption.changesConclusionWhen, confirmed: false });
          }}>Revise</Button>
        </div>
      ))}
      {!draft ? (
        <Button type="button" size="sm" className="justify-self-start" onClick={() => setDraft({ statement: "", condition: "", confirmed: false })}>
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
          const priorEvidence = draft.previous?.statement === draft.statement.trim() ? draft.previous.evidence : undefined;
          const operation = applyDecompositionAssumptionOperation(project, {
            nodeId: node.id,
            statement: draft.statement,
            changesConclusionWhen: draft.condition,
            previousNote: draft.previous?.note,
            evidence: draft.confirmed
              ? { kind: "user_confirmed", sourceId: operationId, quote: draft.statement.trim() }
              : priorEvidence ?? { kind: "provisional" }
          }, { operationId, now: new Date().toISOString() });
          if (operation.status === "error") {
            setError(operation.message);
            return;
          }
          if (operation.project !== project) {
            const current = project.graph.nodes.find(candidate => candidate.id === node.id);
            if (current) updateNode(node.id, { ...operation.patch, status: current.status });
          }
          setDraft(undefined);
          setError("");
        }}>
          <Field label="Relationship">
            <TextInput required maxLength={decompositionAssumptionLimits.text} value={draft.statement}
              onChange={event => setDraft({ ...draft, statement: event.target.value, confirmed: false })} />
          </Field>
          <Field label="When would the conclusion change?">
            <TextInput required maxLength={decompositionAssumptionLimits.text} value={draft.condition}
              onChange={event => setDraft({ ...draft, condition: event.target.value })} />
          </Field>
          {draft.previous?.evidence.kind === "user_confirmed" && draft.previous.statement === draft.statement.trim() ? (
            <p className="text-xs text-graphite">The existing confirmation applies to this relationship.</p>
          ) : (
            <label className="flex items-center text-xs">
              <input type="checkbox" checked={draft.confirmed}
                onChange={event => setDraft({ ...draft, confirmed: event.target.checked })} />
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
