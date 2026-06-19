import type { VdtNode } from "@vdt-studio/vdt-core";

export function collectExistingPositions(
  nodes: VdtNode[]
): Map<string, { x: number; y: number }> {
  return new Map(
    nodes.filter((node) => node.position).map((node) => [node.id, node.position!] as const)
  );
}
