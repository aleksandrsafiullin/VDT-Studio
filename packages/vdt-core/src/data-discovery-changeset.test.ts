import { describe, expect, it } from "vitest";
import { applyChangeSet, productionVolumeProject, type SemanticTaxonomy, type VdtChangeSet } from "./index";

describe("data discovery change-set operations", () => {
  it("applies selected data source, taxonomy, and data-mapped node changes", () => {
    const taxonomy: SemanticTaxonomy = {
      id: "taxonomy_reason",
      name: "Reason taxonomy",
      sourceTableId: "table_1",
      sourceColumns: ["Reason"],
      categories: [
        {
          id: "category_delay",
          name: "Delay",
          matchRules: [{ type: "equals", value: "Delay" }],
          subcategories: [],
          examples: ["Delay"],
          rowCount: 3,
          confidence: 0.9
        }
      ],
      coverage: {
        coveredRows: 3,
        totalRows: 4,
        coveredShare: 0.75,
        unknownShare: 0.25
      },
      confidence: 0.86,
      evidence: [
        {
          type: "distribution",
          message: "Recurring reasons detected.",
          strength: "strong"
        }
      ]
    };
    const changeSet: VdtChangeSet = {
      id: "changeset_data_test",
      taskType: "analyze_raw_dataset",
      backendId: "data_harness",
      createdAt: "2026-07-04T00:00:00.000Z",
      additions: [
        {
          id: "add_data_total_minutes",
          nodeId: "data_total_minutes",
          parentNodeId: productionVolumeProject.rootNodeId,
          relation: "positive_driver",
          name: "Total minutes",
          type: "data_mapped",
          unit: "minute",
          dataMapping: {
            sourceId: "ds_downtime",
            tableId: "table_1",
            field: "Minutes",
            aggregation: "sum",
            confidence: 0.88,
            evidence: [
              {
                type: "column_name",
                message: "Minutes suggests duration.",
                strength: "strong"
              }
            ]
          },
          valueSource: {
            sourceTier: "file",
            confidence: "high",
            note: "Derived from imported dataset analysis"
          }
        }
      ],
      updates: [],
      deletions: [],
      edgeChanges: [],
      dataSourceChanges: [
        {
          id: "data_source_ds_downtime",
          action: "add",
          dataSource: {
            id: "ds_downtime",
            name: "downtime.csv",
            type: "file",
            file: {
              fileName: "downtime.csv",
              mimeType: "text/csv",
              extension: "csv",
              sizeBytes: 128,
              contentHash: "sha256:test",
              uploadedAt: "2026-07-04T00:00:00.000Z",
              storageRef: "dataset_test",
              tableCount: 1
            },
            schema: {
              tables: [
                {
                  tableId: "table_1",
                  name: "downtime",
                  rowCount: 4,
                  fields: [
                    {
                      name: "Minutes",
                      physicalType: "number",
                      logicalType: "duration",
                      unit: "minute"
                    },
                    {
                      name: "Reason",
                      physicalType: "string",
                      logicalType: "category"
                    }
                  ]
                }
              ]
            }
          }
        }
      ],
      taxonomyChanges: [
        {
          id: "taxonomy_reason",
          action: "add",
          sourceId: "ds_downtime",
          taxonomy
        }
      ],
      assumptions: [],
      questions: [],
      warnings: []
    };
    const selection = new Set([
      "add_data_total_minutes",
      "data_source_ds_downtime",
      "taxonomy_reason"
    ]);

    const result = applyChangeSet(productionVolumeProject, changeSet, selection);

    expect(result.success).toBe(true);
    expect(result.project.dataSources).toHaveLength(1);
    expect(result.project.dataSources[0]?.id).toBe("ds_downtime");
    expect(result.project.graph.nodes.find((node) => node.id === "data_total_minutes")?.dataMapping?.sourceId).toBe("ds_downtime");
  });

  it("rejects selected data mappings that reference missing source fields", () => {
    const changeSet: VdtChangeSet = {
      id: "changeset_data_bad_field",
      taskType: "analyze_raw_dataset",
      backendId: "data_harness",
      createdAt: "2026-07-04T00:00:00.000Z",
      additions: [
        {
          id: "add_data_missing_field",
          nodeId: "data_missing_field",
          parentNodeId: productionVolumeProject.rootNodeId,
          relation: "positive_driver",
          name: "Missing field",
          type: "data_mapped",
          dataMapping: {
            sourceId: "ds_bad",
            tableId: "table_1",
            field: "Missing",
            aggregation: "sum"
          }
        }
      ],
      updates: [],
      deletions: [],
      edgeChanges: [],
      dataSourceChanges: [
        {
          id: "data_source_ds_bad",
          action: "add",
          dataSource: {
            id: "ds_bad",
            name: "bad.csv",
            type: "file",
            schema: {
              tables: [
                {
                  tableId: "table_1",
                  name: "bad",
                  rowCount: 1,
                  fields: [{ name: "Actual", physicalType: "number" }]
                }
              ]
            }
          }
        }
      ],
      assumptions: [],
      questions: [],
      warnings: []
    };

    const result = applyChangeSet(productionVolumeProject, changeSet, new Set(["add_data_missing_field", "data_source_ds_bad"]));

    expect(result.success).toBe(false);
    expect(result.warnings.some((item) => item.message.includes("unknown field"))).toBe(true);
  });

  it("rejects selected taxonomy changes that reference missing columns", () => {
    const taxonomy: SemanticTaxonomy = {
      id: "taxonomy_missing",
      name: "Missing taxonomy",
      sourceTableId: "table_1",
      sourceColumns: ["Missing"],
      categories: [],
      coverage: {
        coveredRows: 0,
        totalRows: 1,
        coveredShare: 0,
        unknownShare: 1
      },
      confidence: 0.5,
      evidence: []
    };
    const changeSet: VdtChangeSet = {
      id: "changeset_data_bad_taxonomy",
      taskType: "analyze_raw_dataset",
      backendId: "data_harness",
      createdAt: "2026-07-04T00:00:00.000Z",
      additions: [],
      updates: [],
      deletions: [],
      edgeChanges: [],
      dataSourceChanges: [
        {
          id: "data_source_ds_bad_taxonomy",
          action: "add",
          dataSource: {
            id: "ds_bad_taxonomy",
            name: "bad.csv",
            type: "file",
            schema: {
              tables: [
                {
                  tableId: "table_1",
                  name: "bad",
                  rowCount: 1,
                  fields: [{ name: "Actual", physicalType: "string" }]
                }
              ]
            }
          }
        }
      ],
      taxonomyChanges: [
        {
          id: "taxonomy_missing",
          action: "add",
          sourceId: "ds_bad_taxonomy",
          taxonomy
        }
      ],
      assumptions: [],
      questions: [],
      warnings: []
    };

    const result = applyChangeSet(productionVolumeProject, changeSet, new Set(["data_source_ds_bad_taxonomy", "taxonomy_missing"]));

    expect(result.success).toBe(false);
    expect(result.warnings.some((item) => item.message.includes("unknown column"))).toBe(true);
  });
});
