import type { AppleGuidedField, AppleGuidedShape } from "@vdt-studio/local-runner/apple-foundation-models";

export const UPDATE_SELECTED_NODE = "vdt.update_node";
const text = { kind: "string" } as const;
const nodePatch: AppleGuidedShape = { kind: "object", fields: [
  { name: "baselineValue", shape: { kind: "number" }, description: "The exact baseline value requested by the user." }
] };

export function selectedUpdateActionField(selectedNodeId: string, genericTools: readonly string[]): AppleGuidedField {
  const update = { kind: "object", fields: [
    { name: "tool", shape: { kind: "choice", choices: [UPDATE_SELECTED_NODE] } },
    { name: "nodeId", shape: { kind: "choice", choices: [selectedNodeId] } },
    { name: "patch", shape: nodePatch, description: "Change the selected input baseline while retaining its current source metadata." }
  ] } as const;
  const generic = { kind: "object", fields: [
    { name: "tool", shape: { kind: "choice", choices: genericTools } },
    { name: "argumentsJson", shape: text, optional: true, description: "One compact JSON object. Use this branch for other nodes or richer patches." }
  ] } as const;
  return { name: "action", shape: { kind: "union", variants: [update, generic] } };
}
