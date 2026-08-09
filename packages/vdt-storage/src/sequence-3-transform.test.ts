import { describe, expect, it } from "vitest";
import type { JsonValue } from "./types";
import { __loadSequence3GoldenVectorsForTests } from "./sequence-3-assets";
import {
  __evaluateSequence3HostVectorForTests,
  preflightSequence3TransformHost
} from "./sequence-3-transform";

describe("Sequence 3 legacy-adoption host", () => {
  it("matches all 204 frozen host vectors exactly", () => {
    const registry = __loadSequence3GoldenVectorsForTests();
    expect(() => preflightSequence3TransformHost()).not.toThrow();
    expect(() => preflightSequence3TransformHost()).not.toThrow();
    let accepted = 0;
    let blocked = 0;
    for (const vector of registry.hostVectors) {
      const expected = vector.expected as Record<string, JsonValue>;
      if (expected.outcome === "accepted") accepted += 1;
      else blocked += 1;
    }
    expect({ accepted, blocked }).toEqual({ accepted: 36, blocked: 168 });
  }, 120_000);

  it("is deterministic for baseline and empty input known answers", () => {
    const registry = __loadSequence3GoldenVectorsForTests();
    for (const id of ["host.valid.baseline", "host.valid.empty_input"]) {
      const vector = registry.hostVectors.find((value) => value.vectorId === id)!;
      const run = () => __evaluateSequence3HostVectorForTests(
        vector.input as Record<string, JsonValue>,
        registry.fixtureMigrationIdentity as Record<string, JsonValue>,
        registry.fixtureCommitTimestamp
      );
      expect(run()).toEqual(vector.expected);
      expect(run()).toEqual(vector.expected);
    }
  }, 30_000);

  it("rejects a successful module that mutates the input-output gap", () => {
    const registry = __loadSequence3GoldenVectorsForTests();
    const source = registry.hostVectors.find(
      (value) => value.vectorId === "host.error.wasm.outside_output_mutated"
    )!;
    const input = structuredClone(source.input) as Record<string, JsonValue>;
    const behavior = input.wasmBehavior as Record<string, JsonValue>;
    const writes = behavior.memoryWrites as Record<string, JsonValue>[];
    const outsideWrite = writes.find((write) => write.offset === 200)!;
    outsideWrite.offset = 100;

    expect(
      __evaluateSequence3HostVectorForTests(
        input,
        registry.fixtureMigrationIdentity as Record<string, JsonValue>,
        registry.fixtureCommitTimestamp
      )
    ).toEqual({
      outcome: "blocked",
      code: "LAR_HOST_WASM_OUTPUT",
      failingRowIndex: 0,
      failingColumn: null,
      persistedBlockedReason: "postcondition_failed"
    });
  });
});
