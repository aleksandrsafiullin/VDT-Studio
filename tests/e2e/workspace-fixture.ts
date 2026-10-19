import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";

export interface ProductionWorkspace {
  projectId: string;
  vdtId: string;
}

// Each test owns its stored model, including across browser projects and retries.
// Never reuse a previous test's scenarios, revisions or agent history.
export const test = base.extend<{ productionWorkspace: ProductionWorkspace }>({
  productionWorkspace: async ({ request }, use) => {
    const suffix = randomUUID().replaceAll("-", "");
    const projectId = `project_e2e_${suffix}`;
    const vdtId = `vdt_e2e_${suffix}`;
    const project = JSON.parse(fs.readFileSync(path.resolve("examples/production-volume.json"), "utf8"));
    const created = await request.post("/api/vdt/projects", {
      data: { id: projectId, name: "E2E Production Volume", industry: project.industry }
    });
    expect(created.status(), await created.text()).toBe(201);
    try {
      const { summary: { runtimeState } } = await created.json();
      const saved = await request.post(`/api/vdt/projects/${projectId}/vdts`, {
        data: {
          schemaVersion: "create_vdt_with_initial_http_request.v1",
          idempotencyKey: `create-vdt:${vdtId}`,
          expectedRuntime: {
            schemaVersion: "project_runtime_cas.v1",
            runtimeGeneration: runtimeState.runtimeGeneration,
            generationVersion: runtimeState.generationVersion
          },
          vdt: {
            requestedVdtId: vdtId, name: project.name, rootKpi: "Production Volume",
            unit: "tonnes/month", timePeriod: "monthly", status: "draft", metadata: null
          },
          project
        }
      });
      expect(saved.ok(), await saved.text()).toBeTruthy();
      await use({ projectId, vdtId });
    } finally {
      const deleted = await request.delete(`/api/vdt/projects/${projectId}`, { maxRetries: 2 });
      expect([200, 404], "Delete only the project owned by this test").toContain(deleted.status());
    }
  }
});
