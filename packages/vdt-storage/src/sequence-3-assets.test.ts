import { describe, expect, it } from "vitest";
import {
  __loadSequence3GoldenVectorsForTests,
  loadVerifiedSequence3Assets
} from "./sequence-3-assets";

describe("closed Sequence 3 assets", () => {
  it("loads the exact manifest graph and zero-import module once", () => {
    const first = loadVerifiedSequence3Assets();
    const second = loadVerifiedSequence3Assets();
    expect(second).toBe(first);
    expect(first).toMatchObject({
      manifestHash: "sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8",
      sqlChecksum: "sha256:c9b7ce6486a50024259e53f34a7f4a1750544c442b75df310a55c03e5f8d3e0f",
      moduleChecksum: "sha256:17c65421b76992f4ec346c7cb4fbe097e07328e87cca2eb31215ec07beae7b7a",
      contractChecksum: "sha256:c0ab9e1233e9a43ab898b31991799cee9ee4471560445f2ab65d531fcb47ddad",
      goldenVectorsChecksum:
        "sha256:a4e95819f132dee113020b32b9cafff7ff96f18268dc286750a164523b462202"
    });
    expect(WebAssembly.Module.imports(first.module)).toEqual([]);
  }, 30_000);

  it("preflights the exact frozen vector cardinalities and hashes", () => {
    const vectors = __loadSequence3GoldenVectorsForTests();
    expect(vectors.abiVectors).toHaveLength(55);
    expect(vectors.hostVectors).toHaveLength(204);
    expect(vectors.hostVectors.filter((value) => value.expected &&
      (value.expected as Record<string, unknown>).outcome === "accepted")).toHaveLength(36);
    expect(vectors.vectorSetHash).toBe(
      "sha256:ed66c27225bf411b8369772cb646f1481a58c6c2e89b3a3adc08c8ace35fab0e"
    );
    expect(vectors.vectorResultSetHash).toBe(
      "sha256:494c7fc1ba5d730e30de733c620554ee6badad9db42a5a33aa1b06c36dfac3d1"
    );
  }, 30_000);
});
