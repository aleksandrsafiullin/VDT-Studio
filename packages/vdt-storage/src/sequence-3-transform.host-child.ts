import type { JsonValue } from "./types";
import { __loadSequence3GoldenVectorsForTests } from "./sequence-3-assets";
import {
  __evaluateSequence3HostVectorForTests,
  preflightSequence3TransformHost
} from "./sequence-3-transform";

/**
 * Off-thread Sequence 3 host suite. Inflating and strictly parsing the 121 MiB
 * golden-vector artifact blocks the event loop for ~105s; Vitest 3.2 birpc
 * then fails the worker with onTaskUpdate even when the assertions pass.
 */
preflightSequence3TransformHost();
preflightSequence3TransformHost();

const registry = __loadSequence3GoldenVectorsForTests();
let accepted = 0;
let blocked = 0;
for (const vector of registry.hostVectors) {
  const expected = vector.expected as Record<string, JsonValue>;
  if (expected.outcome === "accepted") accepted += 1;
  else blocked += 1;
}

const knownAnswers = ["host.valid.baseline", "host.valid.empty_input"].map((id) => {
  const vector = registry.hostVectors.find((value) => value.vectorId === id)!;
  const run = () =>
    __evaluateSequence3HostVectorForTests(
      vector.input as Record<string, JsonValue>,
      registry.fixtureMigrationIdentity as Record<string, JsonValue>,
      registry.fixtureCommitTimestamp
    );
  return { id, expected: vector.expected, first: run(), second: run() };
});

const source = registry.hostVectors.find(
  (value) => value.vectorId === "host.error.wasm.outside_output_mutated"
)!;
const input = structuredClone(source.input) as Record<string, JsonValue>;
const behavior = input.wasmBehavior as Record<string, JsonValue>;
const writes = behavior.memoryWrites as Record<string, JsonValue>[];
const outsideWrite = writes.find((write) => write.offset === 200)!;
outsideWrite.offset = 100;
const mutated = __evaluateSequence3HostVectorForTests(
  input,
  registry.fixtureMigrationIdentity as Record<string, JsonValue>,
  registry.fixtureCommitTimestamp
);

process.stdout.write(
  `${JSON.stringify({
    counts: { accepted, blocked },
    knownAnswers,
    mutated
  })}\n`
);
