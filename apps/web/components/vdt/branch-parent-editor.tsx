"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { VdtProject } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Field, SelectInput } from "@/components/ui/field";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./workspace-shell.module.css";

export function BranchParentEditor({ project, workspaceProjectId, vdtId, nodeId }: {
  project: VdtProject;
  workspaceProjectId: string | undefined;
  vdtId: string | undefined;
  nodeId: string;
}) {
  const [oldParent, setOldParent] = useState("");
  const [target, setTarget] = useState<{ nodeId: string; project: VdtProject }>();
  const [message, setMessage] = useState("");
  const reparentBranch = useVdtStudioStore(state => state.reparentBranch);
  const parentIds = [...new Set(project.graph.edges.filter(edge => edge.targetNodeId === nodeId).map(edge => edge.sourceNodeId))];
  if (nodeId === project.rootNodeId || parentIds.length === 0) return null;
  const fromParentNodeId = parentIds.length === 1 ? parentIds[0]! : oldParent;
  const name = (id: string) => project.graph.nodes.find(node => node.id === id)?.name ?? id;
  return (
    <section className={clsx(styles.inspectorSection, styles.sectionDivider)} aria-label="Branch parent">
      {parentIds.length > 1 && (
        <Field label="Current parent link">
          <SelectInput value={oldParent} onChange={event => {
            setOldParent(event.target.value);
            setTarget(undefined);
            setMessage("");
          }}>
            <option value="">Select a link to move</option>
            {parentIds.map(id => <option key={id} value={id}>{name(id)}</option>)}
          </SelectInput>
        </Field>
      )}
      <Field label="New parent" hint={parentIds.length === 1 ? `Current parent: ${name(parentIds[0]!)}` : "Choose which parent link to move."}>
        <SelectInput value={target?.nodeId ?? ""} disabled={!fromParentNodeId} onChange={event => {
          setTarget(event.target.value ? { nodeId: event.target.value, project } : undefined);
          setMessage("");
        }}>
          <option value="">Select a KPI</option>
          {project.graph.nodes.filter(node => node.id !== nodeId && node.id !== fromParentNodeId)
            .map(node => <option key={node.id} value={node.id}>{node.name}</option>)}
        </SelectInput>
      </Field>
      <Button type="button" variant="secondary" disabled={!target || !fromParentNodeId} onClick={() => {
        if (!target || !fromParentNodeId) return;
        const result = reparentBranch({ nodeId, fromParentNodeId, parentNodeId: target.nodeId }, {
          project: target.project, workspaceProjectId, vdtId
        });
        setMessage(result.ok ? "" : result.message);
        setTarget(undefined);
      }}>
        Move branch
      </Button>
      {message && <p role="alert" className="text-xs text-red-700">{message}</p>}
    </section>
  );
}
