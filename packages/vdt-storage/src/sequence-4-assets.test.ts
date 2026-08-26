import { describe, expect, it } from "vitest";
import { loadVerifiedSequence4Assets } from "./sequence-4-assets";

describe("closed Sequence 4 extension assets", () => {
  it("binds one exact SQL migration to the frozen Sequence 3 manifest", () => {
    const first = loadVerifiedSequence4Assets();
    const second = loadVerifiedSequence4Assets();
    expect(second).toBe(first);
    expect(first).toMatchObject({
      manifestHash:
        "sha256:58440c19c409fb79229458d8448cafa900dd24f8e363c191dd4fbececa54b2d0",
      historicalPrefixManifestHash:
        "sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8",
      entry: {
        sequence: 4,
        migrationId: "004-bounded-agent-execution",
        fromUserVersion: 3,
        toUserVersion: 4,
        sqlByteLength: 29_824,
        sqlChecksum:
          "sha256:5783fea204fa540a7e3442c2e73bcefff4dec41cf6de97439b8c0dafaefbc8c4",
        preconditionSchemaHash:
          "sha256:c4206299c5399b4ee113c920f02af650aa39ad6af452f5c46330dcec10adbb5a",
        postconditionSchemaHash:
          "sha256:77281710693b86a25722b3f6b14fcd0496fe22918cfc77cb39f1679ffed5dfb0"
      }
    });
  });
});
