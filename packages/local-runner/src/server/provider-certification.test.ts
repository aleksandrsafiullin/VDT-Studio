import { describe, expect, it } from "vitest";
import certification from "../../../../release/provider-certification.json";
import { listModelBackendDefinitions } from "@vdt-studio/model-bridge";
import { BUILTIN_BACKEND_MANIFESTS } from "./manifests";

const certificationById = new Map(certification.backends.map((backend) => [backend.id, backend]));

describe("provider certification status alignment", () => {
  it("keeps model backend release statuses aligned with certification metadata", () => {
    for (const backend of listModelBackendDefinitions()) {
      const certified = certificationById.get(backend.id);

      expect(certified, `${backend.id} missing from provider-certification.json`).toBeDefined();
      expect(backend.releaseStatus, `${backend.id} releaseStatus differs from provider-certification.json`).toBe(
        certified?.status
      );
    }
  });

  it("keeps local runner public support levels aligned with certification metadata", () => {
    for (const manifest of BUILTIN_BACKEND_MANIFESTS) {
      const certified = certificationById.get(manifest.id);

      expect(certified, `${manifest.id} missing from provider-certification.json`).toBeDefined();
      expect(manifest.supportLevel, `${manifest.id} supportLevel differs from provider-certification.json`).toBe(
        certified?.status
      );
    }
  });
});
