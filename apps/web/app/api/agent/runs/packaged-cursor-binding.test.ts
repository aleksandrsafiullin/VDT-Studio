import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createQualifiedCursorResumeCheckpointEngine, type QualifiedCursorResumeCheckpointOptions } from "@vdt-studio/model-bridge/node";
import { createPackagedCursorBinding } from "./packaged-cursor-binding";

vi.mock("@vdt-studio/model-bridge/node", () => ({
  createQualifiedCursorResumeCheckpointEngine: vi.fn(async () => ({}))
}));

it.each([
  ["grok-4.7-xhigh", 360_000],
  ["grok-4.7-low", 180_000],
  ["grok-4.8-xhigh", 180_000]
])("pins the packaged segment budget for %s", async (modelId, timeoutMs) => {
  const hash = `sha256:${"a".repeat(64)}`;
  const evidence: QualifiedCursorResumeCheckpointOptions["evidence"] = {
    evidenceHash: hash,
    payloadHash: hash,
    policyHash: hash,
    vendorPolicyHash: hash,
    toolCatalogHash: hash,
    cliVersion: "2026.11.11-b912975",
    protocolVersion: "vdt-cursor-checkpoint-v1",
    testedAt: "2026-11-16T10:00:00.000Z",
    platform: { os: "darwin", arch: "arm64", runtimeVersion: process.version },
    modelId,
    catalogModelDisplayName: "Grok fixture",
    runtimeModelDisplayName: "Grok fixture"
  };
  const binding = await createPackagedCursorBinding({
    activation: {
      evidence,
      executable: "/fixture/cursor",
      runner: { measureIdentity: vi.fn(), runQualified: vi.fn() },
      sessionEnvironmentFactory: vi.fn()
    },
    toolCatalogHash: hash,
    allowedToolNames: [],
    forbiddenRoots: [],
    resolveBinding: vi.fn()
  });
  const legacyIdentity = createHash("sha256").update(JSON.stringify([
    hash, modelId, evidence.catalogModelDisplayName, evidence.runtimeModelDisplayName,
    hash, hash, hash
  ])).digest("hex").slice(0, 32);
  expect(createQualifiedCursorResumeCheckpointEngine).toHaveBeenLastCalledWith(
    expect.objectContaining({ evidence, timeoutMs })
  );
  expect(binding.modelId).toBe(modelId);
  if (timeoutMs === 180_000) {
    expect(binding.bindingId).toBe(`cursor_desktop_${legacyIdentity}`);
  } else {
    expect(binding.bindingId).not.toBe(`cursor_desktop_${legacyIdentity}`);
  }
});
