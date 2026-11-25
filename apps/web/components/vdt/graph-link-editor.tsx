"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { GRAPH_EDGE_RELATIONS, type EdgeEditCommand, type VdtEdgeRelation, type VdtProject } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Field, SelectInput } from "@/components/ui/field";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./workspace-shell.module.css";

const relationLabels: Record<VdtEdgeRelation, string> = {
  formula_dependency: "Formula dependency",
  contextual_influence: "Contextual influence",
  positive_driver: "Positive driver",
  negative_driver: "Negative driver",
  additive_component: "Additive component",
  subtractive_component: "Subtractive component",
  multiplicative_driver: "Multiplicative driver",
  divisive_driver: "Divisive driver"
};
const relationOptions = GRAPH_EDGE_RELATIONS.map(relation => (
  <option key={relation} value={relation}>{relationLabels[relation]}</option>
));

export function GraphLinkEditor({ project, workspaceProjectId, vdtId, nodeId }: {
  project: VdtProject;
  workspaceProjectId: string | undefined;
  vdtId: string | undefined;
  nodeId: string;
}) {
  const editGraphEdge = useVdtStudioStore(state => state.editGraphEdge);
  const [draft, setDraft] = useState<{ project: VdtProject; id: string; relation: VdtEdgeRelation }>();
  const [mode, setMode] = useState<"add" | "edit">("add");
  const [message, setMessage] = useState("");
  const outgoing = project.graph.edges.filter(edge => edge.sourceNodeId === nodeId);
  const selectedEdge = mode === "edit" ? outgoing.find(edge => edge.id === draft?.id) : undefined;
  const candidates = project.graph.nodes.filter(node => node.id !== nodeId && node.id !== project.rootNodeId);
  if (!outgoing.length && !candidates.length) return null;

  function apply(command: EdgeEditCommand, expectedProject: VdtProject) {
    const result = editGraphEdge(command, {
      project: expectedProject, workspaceProjectId, vdtId, selectedNodeId: nodeId
    });
    setMessage(result.ok ? "" : result.message);
    if (result.ok || expectedProject !== project) setDraft(undefined);
  }

  return (
    <details className={clsx(styles.inspectorSection, styles.sectionDivider)}>
      <summary className="cursor-pointer text-sm font-medium">Outgoing links</summary>
      <div className="mt-3 grid gap-2">
        <Field label="Link action">
          <SelectInput value={mode} onChange={event => {
            setMode(event.target.value === "edit" ? "edit" : "add");
            setDraft(undefined);
            setMessage("");
          }}>
            <option value="add">Add link</option>
            <option value="edit" disabled={!outgoing.length}>Edit or remove link</option>
          </SelectInput>
        </Field>
        <Field label={mode === "add" ? "Target KPI" : "Link to edit"}>
          <SelectInput value={draft?.id ?? ""} onChange={event => {
            const id = event.target.value;
            const edge = mode === "edit" ? outgoing.find(item => item.id === id) : undefined;
            setDraft(id ? { project, id, relation: edge?.relation ?? "contextual_influence" } : undefined);
            setMessage("");
          }}>
            <option value="">{mode === "add" ? "Select a KPI" : "Select a link"}</option>
            {mode === "add" ? candidates.map(node => (
              <option key={node.id} value={node.id}>{node.name}</option>
            )) : outgoing.map(edge => (
              <option key={edge.id} value={edge.id}>
                {project.graph.nodes.find(node => node.id === edge.targetNodeId)?.name ?? edge.targetNodeId}
                {" · "}{relationLabels[edge.relation]}{" · "}{edge.id}
              </option>
            ))}
          </SelectInput>
        </Field>
        {draft && (
          <>
            <Field label="Link relation">
              <SelectInput value={draft.relation} onChange={event => {
                setDraft({ ...draft, relation: event.target.value as VdtEdgeRelation });
                setMessage("");
              }}>
                {relationOptions}
              </SelectInput>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={mode === "edit" && selectedEdge?.relation === draft.relation}
                onClick={() => apply(mode === "add"
                  ? { kind: "add", sourceNodeId: nodeId, targetNodeId: draft.id, relation: draft.relation }
                  : { kind: "set_relation", edgeId: draft.id, relation: draft.relation }, draft.project)}>
                {mode === "add" ? "Add link" : "Apply relation"}
              </Button>
              {mode === "edit" && (
                <Button type="button" variant="ghost" size="sm"
                  onClick={() => apply({ kind: "remove", edgeId: draft.id }, draft.project)}>
                  Remove link
                </Button>
              )}
            </div>
          </>
        )}
        {message && <p role="alert" className="text-xs text-red-700">{message}</p>}
      </div>
    </details>
  );
}
