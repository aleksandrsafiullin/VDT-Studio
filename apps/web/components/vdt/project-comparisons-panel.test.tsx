import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compareVdtProjects, productionVolumeProject } from "@vdt-studio/vdt-core";
import { openVdtDatabase } from "@vdt-studio/storage";
import { GET as listOrOpen, POST as saveComparison } from "@/app/api/vdt/comparisons/route";
import { GET as readRevision } from "@/app/api/vdt/vdts/[vdtId]/revisions/route";
import { compareSavedVdts, listProjectComparisons, openProjectComparison } from "./project-comparison-client";
import { ComparisonResult } from "./project-comparisons-panel";

const projectId = "project_comparison";
const names: Record<string, string> = { left: "Saved baseline", right: "Saved alternative" };
const leftProject = fixedProject(10);
const rightProject = fixedProject(15);

let dataDir: string | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

function fixedProject(value: number) {
  const project = structuredClone(productionVolumeProject);
  const root = project.graph.nodes.find(({ id }) => id === project.rootNodeId)!;
  project.graph = { nodes: [{ ...root, formula: String(value) }], edges: [] };
  project.scenarios = [];
  return project;
}

async function setupFixture() {
  const ownedDir = await mkdtemp(path.join(os.tmpdir(), "vdt-comparison-panel-"));
  dataDir = ownedDir;
  vi.stubEnv("VDT_DATA_DIR", ownedDir);
  const database = openVdtDatabase(ownedDir, { dataDir: ownedDir });
  try {
    database.createProject({ id: projectId, name: "Comparison fixture" });
    database.createProject({ id: "foreign", name: "Other project" });
    for (const [id, project] of [["left", leftProject], ["right", rightProject]] as const) {
      database.createVdt({ id, projectId, name: names[id]!, rootKpi: "Production Volume" });
      database.saveVdtRevision({ id: `revision_${id}`, projectId, vdtId: id, revisionNo: 1, source: "user", project });
    }
    database.createVdt({ id: "foreign_vdt", projectId: "foreign", name: "Foreign VDT", rootKpi: "Other" });
  } finally {
    database.close();
  }
  const fetchApi = vi.fn(async (url: string, init?: RequestInit) => {
    const request = new Request(new URL(url, "http://localhost"), init);
    const parsed = new URL(request.url);
    if (parsed.pathname === "/api/vdt/comparisons") {
      return request.method === "POST" ? saveComparison(request) : listOrOpen(request);
    }
    const match = parsed.pathname.match(/^\/api\/vdt\/vdts\/([^/]+)\/revisions$/);
    if (match) return readRevision(request, { params: Promise.resolve({ vdtId: match[1]! }) });
    throw new Error(`Unexpected request: ${request.url}`);
  });
  vi.stubGlobal("fetch", fetchApi);
  function heads() {
    const db = openVdtDatabase(ownedDir, { dataDir: ownedDir });
    try { return ["left", "right"].map((id) => db.getVdtRevisionHead(id)); }
    finally { db.close(); }
  }
  return { fetchApi, heads };
}

describe("project workspace comparisons", () => {
  it("renders the API calculation, reopens a persisted pair and leaves the saved heads unchanged on repeat", async () => {
    const { fetchApi, heads } = await setupFixture();
    const before = heads();
    const signal = new AbortController().signal;
    const comparison = await compareSavedVdts(projectId, "left", "right", signal);
    expect(comparison).toMatchObject({
      projectId, leftVdtId: "left", rightVdtId: "right", leftRevisionId: "revision_left", rightRevisionId: "revision_right",
      result: JSON.parse(JSON.stringify(compareVdtProjects(leftProject, rightProject)))
    });
    expect(comparison.result).toMatchObject({ rootDelta: { leftValue: 10, rightValue: 15, absoluteDelta: 5, percentDelta: 50 } });
    expect(await listProjectComparisons(projectId, signal)).toEqual([comparison]);
    expect(await openProjectComparison(projectId, comparison.id, signal)).toEqual(comparison);
    await expect(openProjectComparison("foreign", comparison.id, signal)).rejects.toThrow("unavailable in this project");
    expect(await compareSavedVdts(projectId, "left", "right", signal)).toEqual(comparison);
    expect(fetchApi.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(heads()).toEqual(before);

    const html = renderToStaticMarkup(<ComparisonResult comparison={comparison} labelFor={(id) => names[id] ?? id} />);
    expect(html).toContain("Saved baseline → Saved alternative");
    expect(html).toContain("revision_left and revision_right");
    expect(html).toContain("<dt>Left root</dt><dd>10</dd>");
    expect(html).toContain("<dt>Right root</dt><dd>15</dd>");
    expect(html).toContain("<dt>Absolute change</dt><dd>+5</dd>");
    expect(html).toContain("<dt>Percent change</dt><dd>+50%</dd>");
  });

  it("blocks a foreign or cancelled selection before any POST", async () => {
    const { fetchApi, heads } = await setupFixture();
    const before = heads();
    const controller = new AbortController();
    await expect(compareSavedVdts(projectId, "left", "left", controller.signal)).rejects.toThrow("two different VDTs");
    await expect(compareSavedVdts(projectId, "left", "foreign_vdt", controller.signal)).rejects.toThrow("belong to this project");
    const stale = compareSavedVdts(projectId, "left", "right", controller.signal);
    controller.abort();
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchApi.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(heads()).toEqual(before);
  });

  it("reopens the winning comparison when two browser requests save the same ordered pair", async () => {
    const { fetchApi, heads } = await setupFixture();
    const before = heads();
    const signal = new AbortController().signal;
    let releaseBothLists!: () => void;
    const bothListsRead = new Promise<void>((resolve) => { releaseBothLists = resolve; });
    let listReads = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const response = await fetchApi(url, init);
      // Both callers must see an empty list before either can reach the POST.
      if (url.includes(`/api/vdt/comparisons?projectId=${projectId}`)) {
        if (++listReads === 2) releaseBothLists();
        await bothListsRead;
      }
      return response;
    });

    const [first, second] = await Promise.all([
      compareSavedVdts(projectId, "left", "right", signal),
      compareSavedVdts(projectId, "left", "right", signal)
    ]);
    expect(first.id).toMatch(/^comparison_pair_[0-9a-f]{64}$/);
    expect(second).toEqual(first);
    expect(await listProjectComparisons(projectId, signal)).toEqual([first]);
    expect(fetchApi.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    expect(heads()).toEqual(before);
  });

  it("fences a late list response after the active project has changed", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const controller = new AbortController();
    const stale = listProjectComparisons(projectId, controller.signal);
    controller.abort();
    const rejection = expect(stale).rejects.toMatchObject({ name: "AbortError" });
    resolve(Response.json({ ok: true, comparisons: [{ id: "stale", projectId }] }));
    await rejection;
  });
});
