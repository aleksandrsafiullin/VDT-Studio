import fs from "node:fs";
import {
  canaryMetricsSidecarRecordSchema,
  resolveCanaryMetricsSidecarPath,
  type CanaryMetricsSidecarRecord
} from "./canary-metrics-sidecar";

export class CanaryMetricsSidecarReadError extends Error {
  constructor(
    readonly code: "MISSING_SIDECAR" | "INVALID_SIDECAR_RECORD",
    message: string
  ) {
    super(message);
    this.name = "CanaryMetricsSidecarReadError";
  }
}

/**
 * Evidence-channel reader for tests/harness. A missing file is a missing sidecar,
 * never a zero-segment measurement. Not imported by the Supervisor start path.
 */
export function readCanaryMetricsSidecarRecords(
  filePath: string = resolveCanaryMetricsSidecarPath()
): CanaryMetricsSidecarRecord[] {
  if (!fs.existsSync(filePath)) {
    throw new CanaryMetricsSidecarReadError(
      "MISSING_SIDECAR",
      "Canary metrics sidecar is missing."
    );
  }
  const text = fs.readFileSync(filePath, "utf8");
  const records: CanaryMetricsSidecarRecord[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new CanaryMetricsSidecarReadError(
        "INVALID_SIDECAR_RECORD",
        `Canary metrics sidecar line ${index + 1} is not JSON.`
      );
    }
    const record = canaryMetricsSidecarRecordSchema.safeParse(parsed);
    if (!record.success) {
      throw new CanaryMetricsSidecarReadError(
        "INVALID_SIDECAR_RECORD",
        `Canary metrics sidecar line ${index + 1} is not a metrics-only counters record.`
      );
    }
    records.push(record.data);
  }
  return records;
}
