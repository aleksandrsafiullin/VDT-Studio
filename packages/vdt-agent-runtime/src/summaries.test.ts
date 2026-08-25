import { describe, expect, it } from "vitest";
import { calculateGraph, VdtBuilderSession } from "@vdt-studio/vdt-core";
import { summarizeCalculation } from "./summaries";

describe("calculation summaries", () => {
  it("omits missing values and contains only dense JSON properties", () => {
    const builder = new VdtBuilderSession({
      now: () => "2026-08-25T00:00:00.000Z"
    });
    builder.createDraft({
      projectTitle: "Progressive haulage model",
      rootKpi: "Ore shipped"
    });
    builder.addDriver({
      parentNodeId: "ore_shipped",
      nodeId: "truck_count",
      name: "Truck count",
      type: "input",
      relation: "multiplicative_driver",
      baselineValue: 18
    });
    builder.addDriver({
      parentNodeId: "ore_shipped",
      nodeId: "trips_per_truck",
      name: "Trips per truck",
      type: "calculated",
      relation: "multiplicative_driver"
    });

    const calculation = calculateGraph(builder.getProject());
    expect(calculation.rootValue).toBeUndefined();
    expect(calculation.errors.some((error) => error.type === "missing_value")).toBe(true);

    const summary = summarizeCalculation(calculation);
    expect(summary).not.toHaveProperty("rootValue");
    expect(summary).toStrictEqual(JSON.parse(JSON.stringify(summary)));
  });
});
