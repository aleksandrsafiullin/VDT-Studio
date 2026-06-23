import { describe, expect, it } from "vitest";
import type { VdtEdgeRelation, VdtNodeStatus, VdtNodeType } from "@vdt-studio/vdt-core";
import { getEdgeRelationIcon, getNodeTypeIcon, getStatusIcon } from "./vdt-icons";

const ALL_STATUSES: VdtNodeStatus[] = [
  "ai_suggested",
  "accepted",
  "edited",
  "rejected",
  "needs_data",
  "formula_issue",
  "unit_issue",
  "assumption",
  "external_factor"
];

const ALL_NODE_TYPES: VdtNodeType[] = [
  "root_kpi",
  "calculated",
  "input",
  "assumption",
  "external_factor",
  "data_mapped"
];

const ALL_EDGE_RELATIONS: VdtEdgeRelation[] = [
  "positive_driver",
  "negative_driver",
  "multiplicative_driver",
  "divisive_driver",
  "additive_component",
  "subtractive_component",
  "contextual_influence",
  "formula_dependency"
];

describe("vdt-icons", () => {
  it("resolves every node status", () => {
    for (const status of ALL_STATUSES) {
      const icon = getStatusIcon(status);
      expect(icon.label.length).toBeGreaterThan(0);
    }
  });

  it("resolves every node type", () => {
    for (const type of ALL_NODE_TYPES) {
      const icon = getNodeTypeIcon(type);
      expect(icon.label.length).toBeGreaterThan(0);
    }
  });

  it("resolves every edge relation", () => {
    for (const relation of ALL_EDGE_RELATIONS) {
      const icon = getEdgeRelationIcon(relation);
      expect(icon.label.length).toBeGreaterThan(0);
    }
  });

  it("falls back for unknown keys", () => {
    expect(getStatusIcon("unknown_status").label).toBe("unknown status");
    expect(getNodeTypeIcon("unknown_type").label).toBe("unknown type");
    expect(getEdgeRelationIcon("unknown_relation").label).toBe("unknown relation");
  });

  it("uses symbol kind for primary math relations", () => {
    expect(getEdgeRelationIcon("multiplicative_driver").kind).toBe("symbol");
    expect(getEdgeRelationIcon("additive_component").kind).toBe("symbol");
    expect(getEdgeRelationIcon("subtractive_component").kind).toBe("symbol");
  });
});
