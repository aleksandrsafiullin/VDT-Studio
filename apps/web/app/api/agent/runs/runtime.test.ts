import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openVdtDatabase } from "@vdt-studio/storage";
import { AgentRunStore, type AgentToolContext } from "@vdt-studio/vdt-agent-runtime";
import { createSqliteAgentRunPersistence } from "./persistence";
import { createAgentToolRegistryFromEnv } from "./runtime";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("agent runs runtime research tools", () => {
  it("resolves server-side research provider env without persisting API keys", async () => {
    const secret = "brave-runtime-secret";
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      web: {
        results: [{
          title: "Mine production drivers",
          url: "https://example.com/mining",
          description: "Working time and productivity rate drive mine production."
        }]
      }
    }), { headers: { "content-type": "application/json" } }));
    const registry = createAgentToolRegistryFromEnv({
      VDT_RESEARCH_PROVIDER: "brave",
      BRAVE_SEARCH_API_KEY: secret
    }, { fetch: fetcher, now: () => "2026-07-01T00:00:00.000Z" });

    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const database = openVdtDatabase(root, { dataDir, now: fixedClock("2026-07-01T00:00:00.000Z") });
    const store = new AgentRunStore({
      now: fixedClock("2026-07-01T00:00:00.000Z"),
      persistence: createSqliteAgentRunPersistence(database)
    });
    const run = store.createRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build a mine production VDT.",
        rootKpi: "Mine production"
      },
      providerId: "mock"
    });
    const context = {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      signal: run.abortController.signal
    } satisfies AgentToolContext;

    const result = await registry.run("research.search_web", {
      query: "mine production process drivers",
      purpose: "process_components",
      maxResults: 2
    }, context);

    expect(result.ok).toBe(true);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-subscription-token": secret
    });
    const persisted = database.getAgentRun(run.runId);
    expect(persisted?.request).toEqual(expect.objectContaining({
      providerId: "mock"
    }));
    expect(JSON.stringify(store.getSnapshot(run.runId))).not.toContain(secret);
    expect(JSON.stringify(persisted?.request)).not.toContain(secret);
    expect(JSON.stringify(persisted?.publicSnapshot)).not.toContain(secret);
    expect(JSON.stringify(persisted?.internalState)).not.toContain(secret);
    expect(JSON.stringify(database.listAgentEvents(run.runId))).not.toContain(secret);
    database.close();
    expect(fs.readFileSync(path.join(dataDir, "app.sqlite"), "utf8")).not.toContain(secret);
  });
});

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-agent-runtime-"));
  tempDirs.push(dir);
  return dir;
}

function fixedClock(value: string): () => string {
  return () => value;
}
