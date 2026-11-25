import type { VdtNode } from "../types";
import type { VdtNodePatch } from "./types";

export function newInputValueStatus(node: Pick<VdtNode, "type" | "formula" | "value" | "baselineValue" | "valueStatus">): VdtNode["valueStatus"] {
  if (node.valueStatus !== undefined) return node.valueStatus;
  if (node.type === "input" && !node.formula?.trim() && node.value === undefined && node.baselineValue === undefined) {
    return "unknown";
  }
  return undefined;
}

export function applyNodePatch(node: VdtNode, patch: VdtNodePatch, timestamp: string): VdtNode {
  const { clearInputValue, clearGoalSeek, ...fields } = patch;
  const updated = {
    ...node,
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
    updatedAt: timestamp
  };
  if (clearGoalSeek) delete updated.goalSeek;
  if (clearInputValue) {
    delete updated.value;
    delete updated.baselineValue;
    delete updated.valueSource;
    updated.valueStatus = "unknown";
  } else if (node.valueStatus === "unknown" && patch.valueStatus === undefined
    && (patch.formula?.trim() || patch.value !== undefined || patch.baselineValue !== undefined)) {
    delete updated.valueStatus;
  }
  return updated;
}
