import { describe, expect, it } from "vitest";
import {
  buildKpiSuggestionContext, buildRecipeKpiSuggestions, kpiCanonicalJson, materializeKpiSuggestion,
  KPI_SUGGESTION_PREPARATION_VERSION, KPI_SUGGESTION_RECIPES as catalog, KPI_SUGGESTION_SCHEMA, KPI_SUGGESTION_VALIDATOR,
  type KpiSuggestionExecutionIdentity, type KpiSuggestionSet
} from "@vdt-studio/vdt-core";
import { createSmartKpiMeasuredFixture } from "../../../packages/vdt-core/src/suggestions/fixtures";
import { SmartKpiCache, type SmartKpiCacheRow, type SmartKpiCacheScope, type SmartKpiCacheStorage } from "./smart-kpi-cache";

const now = Date.parse("2026-10-19T00:00:00.000Z");
const execution: KpiSuggestionExecutionIdentity = { mode: "api", backendId: "fixture", modelId: "fixture-model", bindingVersion: "v1", credentialEpoch: "epoch1" };
class MemoryStorage implements SmartKpiCacheStorage {
  rows: unknown[] = []; fail = false; private pending = Promise.resolve();
  transact(update: (rows: readonly unknown[]) => SmartKpiCacheRow[]): Promise<readonly unknown[]> {
    const operation = this.pending.then(() => {
      if (this.fail) throw new Error("private storage or quota failure");
      this.rows = structuredClone(update(structuredClone(this.rows))); return structuredClone(this.rows);
    });
    this.pending = operation.then(() => {}, () => {}); return operation;
  }
}
async function scope(projectId = "cache_fixture"): Promise<SmartKpiCacheScope> {
  const project = createSmartKpiMeasuredFixture(); project.id = projectId;
  return { context: await buildKpiSuggestionContext(project, { workspaceId: "cache_workspace", vdtId: "saved_vdt", targetNodeId: project.rootNodeId, period: { key: "2026-10", grain: "month" } }), execution };
}
function proposal(s: SmartKpiCacheScope, id = "proposal"): KpiSuggestionSet {
  return { schemaVersion: KPI_SUGGESTION_SCHEMA, validatorVersion: KPI_SUGGESTION_VALIDATOR, catalogVersion: catalog.version,
    proposalId: id, targetNodeId: s.context.targetNodeId, contextHash: s.context.contextHash,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 86400_000).toISOString(),
    origin: { kind: "model", requestId: "request_fixture", execution: s.execution! }, rationale: "Independent explanatory inputs in QA context.", limitations: [],
    groups: [{ id: "context", title: "Explanatory inputs", selectionMode: "independent", requiredKeys: [], limitations: [],
      children: [{ key: "availability", conceptKey: "availability", name: "Availability", unit: "fraction" },
        { key: "yield", conceptKey: "yield", name: "Yield", unit: "fraction" }] }] };
}

describe("Smart KPI isolated cache", () => {
  it("rejects contextual reuse on put and evicts an otherwise current persisted proposal on lookup", async () => {
    const storage = new MemoryStorage(), s = await scope(), cache = new SmartKpiCache({ storage, now: () => now });
    const peer = { ...s.context.target, id: "peer", name: "Sibling availability", unit: "fraction" };
    s.context.siblings = [peer];
    const unsafe = proposal(s); unsafe.groups[0]!.children[0]!.existingNodeId = peer.id;
    expect(await cache.put(s, unsafe)).toBe(false);
    storage.rows = [{ schema: "smart_kpi_cache.v1", key: cache.key(s), proposal: unsafe, touchedAt: now }];
    const reloaded = new SmartKpiCache({ storage, now: () => now });
    await reloaded.hydrate(); expect(reloaded.peek(s)).toBeUndefined(); await reloaded.flush();
    expect(storage.rows).toHaveLength(0);
    delete unsafe.groups[0]!.children[0]!.existingNodeId;
    unsafe.groups[0]!.children[0]!.name = peer.name;
    expect(await cache.put(s, unsafe)).toBe(false);
  });
  it("drops singleton artifacts even with a current key, and invalidates the previous preparation policy", async () => {
    const storage = new MemoryStorage(), s = await scope(), cache = new SmartKpiCache({ storage, now: () => now });
    const singleton = proposal(s); singleton.groups[0]!.children.pop();
    const oldKey = JSON.parse(cache.key(s)); oldKey.preparationVersion = "smart-kpi-preparation.v4";
    storage.rows = [
      { schema: "smart_kpi_cache.v1", key: cache.key(s), proposal: singleton, touchedAt: now },
      { schema: "smart_kpi_cache.v1", key: kpiCanonicalJson(oldKey), proposal: proposal(s), touchedAt: now }
    ];
    await cache.hydrate();
    expect(cache.peek(s)).toBeUndefined(); expect(storage.rows).toHaveLength(0);
  });
  it("hydrates valid artifacts, reuses unchanged execution after reload, and isolates caller mutation", async () => {
    const storage = new MemoryStorage(), s = await scope(), first = new SmartKpiCache({ storage, now: () => now });
    const p = proposal(s); expect(await first.put(s, p)).toBe(true); p.groups[0]!.children[0]!.name = "caller mutation";
    await first.flush();
    const reloaded = new SmartKpiCache({ storage, now: () => now + 1 });
    const hit = await reloaded.read({ ...s, execution: { ...execution } });
    expect(hit?.groups[0]!.children[0]!.name).toBe("Availability");
    hit!.groups[0]!.children[0]!.name = "reader mutation";
    expect(reloaded.peek(s)?.groups[0]!.children[0]!.name).toBe("Availability");
    expect(storage.rows[0]).toMatchObject({ schema: "smart_kpi_cache.v1", proposal: { origin: { kind: "model" } } });
    expect(Object.keys(storage.rows[0] as object).sort()).toEqual(["key", "proposal", "schema", "touchedAt"]);
  });

  it("separates project/VDT/workspace/period and every stable execution field", async () => {
    const cache = new SmartKpiCache({ storage: null, now: () => now }), s = await scope();
    expect(await cache.put(s, proposal(s))).toBe(true);
    for (const patch of [{ backendId: "other" }, { modelId: "other" }, { bindingVersion: "v2" }, { credentialEpoch: "epoch2" }, { mode: "local_model" as const }])
      expect(cache.peek({ ...s, execution: { ...execution, ...patch } })).toBeUndefined();
    expect(cache.peek({ context: s.context })).toBeUndefined();
    expect(cache.peek(await scope("other_project"))).toBeUndefined();
    for (const patch of [{ workspaceId: "other_workspace" }, { vdtId: "other_vdt" }, { contextHash: `sha256:${"f".repeat(64)}` }])
      expect(cache.peek({ ...s, context: { ...s.context, ...patch } })).toBeUndefined();
    const otherCatalog = new SmartKpiCache({ storage: null, now: () => now, catalog: { ...catalog, version: "other_catalog" } });
    expect(otherCatalog.key(s)).not.toBe(cache.key(s));
  });

  it("never admits model results without exact execution provenance or partial invalid output", async () => {
    const cache = new SmartKpiCache({ storage: null, now: () => now }), s = await scope();
    expect(await cache.put({ context: s.context }, proposal(s))).toBe(false);
    expect(await cache.put({ ...s, execution: { ...execution, credentialEpoch: "other" } }, proposal(s))).toBe(false);
    expect(await cache.put(s, { ...proposal(s), groups: [] })).toBe(false);
    expect(await cache.put(s, { ...proposal(s), rawPrompt: "should not be retained" })).toBe(false);
    const singleton = proposal(s); singleton.groups[0]!.children.pop();
    expect(await cache.put(s, singleton)).toBe(false);
    expect(cache.stats().entries).toBe(0);
  });

  it("expires seven-day proposals at lookup and hydration, without refreshing TTL on hits", async () => {
    let clock = now; const storage = new MemoryStorage(), cache = new SmartKpiCache({ storage, now: () => clock }), s = await scope();
    await cache.put(s, proposal(s)); clock += 6 * 86400_000; expect(cache.peek(s)).toBeDefined(); await cache.flush();
    clock += 86400_000; expect(cache.peek(s)).toBeUndefined(); await cache.flush();
    expect(storage.rows).toHaveLength(0);
    const expired = proposal(s), key = cache.key(s);
    storage.rows = [{ schema: "smart_kpi_cache.v1", key, proposal: expired, touchedAt: now }];
    const reload = new SmartKpiCache({ storage, now: () => clock }); await reload.hydrate();
    expect(reload.stats().entries).toBe(0); expect(storage.rows).toHaveLength(0);
  });

  it("bounds memory and origin persistence, evicting least recently used owned entries", async () => {
    let clock = now; const storage = new MemoryStorage(), cache = new SmartKpiCache({ storage, now: () => clock, maxEntries: 2 });
    const a = await scope("a"), b = await scope("b"), c = await scope("c");
    await cache.put(a, proposal(a)); clock++; await cache.put(b, proposal(b)); clock++; cache.peek(a); clock++;
    await cache.put(c, proposal(c)); await cache.flush();
    expect(cache.peek(a)).toBeDefined(); expect(cache.peek(b)).toBeUndefined(); expect(cache.peek(c)).toBeDefined();
    expect(storage.rows).toHaveLength(2);
  });

  it("enforces a shared origin cap atomically across multiple cache controllers", async () => {
    let clock = now; const storage = new MemoryStorage(), a = new SmartKpiCache({ storage, now: () => clock, maxEntries: 2 }), b = new SmartKpiCache({ storage, now: () => clock, maxEntries: 2 });
    await Promise.all([a.hydrate(), b.hydrate()]);
    const one = await scope("one"), two = await scope("two"), three = await scope("three");
    await a.put(one, proposal(one)); await a.flush(); clock++;
    await b.put(two, proposal(two)); await b.flush(); clock++;
    await a.put(three, proposal(three)); await a.flush();
    expect(storage.rows).toHaveLength(2);
    expect(storage.rows.map(r => (r as SmartKpiCacheRow).proposal.proposalId)).toEqual(["proposal", "proposal"]);
    expect(storage.rows.map(r => JSON.parse((r as SmartKpiCacheRow).key).projectId)).toEqual(["three", "two"]);
  });

  it("enforces the production 256-entry and 2 MiB caps on an overfull origin during hydration", async () => {
    const s = await scope(), base = new SmartKpiCache({ storage: null, now: () => now }), frame = JSON.parse(base.key(s));
    const makeRow = (i: number, artifact: KpiSuggestionSet): SmartKpiCacheRow => ({ schema: "smart_kpi_cache.v1", key: kpiCanonicalJson({ ...frame, workspaceId: `workspace_${i}` }), proposal: artifact, touchedAt: now - i });
    const storage = new MemoryStorage(); storage.rows = Array.from({ length: 300 }, (_, i) => makeRow(i, proposal(s)));
    const many = new SmartKpiCache({ storage, now: () => now }); await many.hydrate(); expect(many.stats().entries).toBe(256); expect(storage.rows).toHaveLength(256);
    const large = proposal(s); large.rationale = "r".repeat(300); large.limitations = Array.from({ length: 6 }, () => "l".repeat(300));
    large.groups = Array.from({ length: 3 }, (_, group) => ({ id: `alternative_${group}`, title: "Independent QA alternatives", selectionMode: "independent", requiredKeys: [], limitations: [],
      children: Array.from({ length: 6 }, (_, child) => ({ key: `key_${child}`, conceptKey: `concept_${child}`, name: "n".repeat(160), unit: "fraction", description: "d".repeat(240) })) }));
    storage.rows = Array.from({ length: 256 }, (_, i) => makeRow(i, large));
    const oversized = new SmartKpiCache({ storage, now: () => now }); await oversized.hydrate();
    expect(oversized.stats().entries).toBeGreaterThan(0); expect(oversized.stats().entries).toBeLessThan(256); expect(oversized.stats().bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("enforces the byte cap rather than only entry count, and rejects an oversized artifact", async () => {
    const s = await scope(), source = new SmartKpiCache({ storage: null, now: () => now }); await source.put(s, proposal(s));
    const oneSize = source.stats().bytes;
    const cache = new SmartKpiCache({ storage: null, now: () => now, maxBytes: oneSize + 10 });
    await cache.put(s, proposal(s)); const other = await scope("second"); await cache.put(other, proposal(other));
    expect(cache.stats().entries).toBe(1); expect(cache.stats().bytes).toBeLessThanOrEqual(oneSize + 10);
    const tiny = new SmartKpiCache({ storage: null, now: () => now, maxBytes: 100 });
    expect(await tiny.put(s, proposal(s))).toBe(false);
  });

  it("purges corrupt/schema/validator/catalog/credential rows during hydration", async () => {
    const storage = new MemoryStorage(), s = await scope(), initial = new SmartKpiCache({ storage, now: () => now }); await initial.put(s, proposal(s)); await initial.flush();
    const valid = structuredClone(storage.rows[0] as SmartKpiCacheRow);
    storage.rows.push(null, "bad", { ...valid, schema: "old" }, { ...valid, key: "{" },
      { ...valid, key: valid.key.replace(KPI_SUGGESTION_VALIDATOR, "validator.old") },
      { ...valid, proposal: { ...valid.proposal, catalogVersion: "old" } },
      { ...valid, proposal: { ...valid.proposal, origin: { kind: "model", requestId: "request", execution: { ...execution, credentialEpoch: "wrong" } } } });
    const reload = new SmartKpiCache({ storage, now: () => now }); await reload.hydrate();
    expect(reload.stats().entries).toBe(1); expect(storage.rows).toHaveLength(1);
  });

  it("discards artifacts from missing or older preparation policies without poisoning fresh writes", async () => {
    const s = await scope(), source = new MemoryStorage(), cache = new SmartKpiCache({ storage: source, now: () => now });
    expect(await cache.put(s, proposal(s))).toBe(true); await cache.flush();
    const current = structuredClone(source.rows[0] as SmartKpiCacheRow), frame = JSON.parse(current.key);
    expect(frame.preparationVersion).toBe(KPI_SUGGESTION_PREPARATION_VERSION);
    const { preparationVersion: _policy, ...missing } = frame;
    for (const oldFrame of [missing, { ...frame, preparationVersion: "smart-kpi-preparation.v1" }]) {
      const storage = new MemoryStorage(); storage.rows = [{ ...current, key: kpiCanonicalJson(oldFrame) }];
      const reload = new SmartKpiCache({ storage, now: () => now });
      expect(await reload.read(s)).toBeUndefined(); expect(storage.rows).toHaveLength(0);
      expect(await reload.put(s, proposal(s))).toBe(true); expect(reload.peek(s)?.proposalId).toBe("proposal");
    }
  });

  it("checks current canonical provenance at hydration and exact units at context lookup", async () => {
    const s = await scope(), recipe = catalog.recipes.find(r => r.id === "production.time_rate")!;
    const p = buildRecipeKpiSuggestions(s.context, [{ binding: { id: "decision", recipeId: recipe.id, recipeHash: recipe.recipeHash,
      skillHash: recipe.skillHash, targetRole: recipe.targetRole, contextHash: s.context.contextHash, basis: "selected_skill", sourceRef: "qa_skill", rationale: "Explicit QA applicability." } }], { now: new Date(now).toISOString(), proposalId: "recipe_proposal" })!;
    const storage = new MemoryStorage(), cache = new SmartKpiCache({ storage, now: () => now });
    expect(await cache.put({ context: s.context }, p)).toBe(true); await cache.flush();
    const valid = structuredClone(storage.rows[0] as SmartKpiCacheRow);
    (storage.rows[0] as SmartKpiCacheRow).proposal.groups[0]!.recipeBinding!.skillHash = `sha256:${"0".repeat(64)}`;
    const corrupt = new SmartKpiCache({ storage, now: () => now }); await corrupt.hydrate(); expect(corrupt.stats().entries).toBe(0);
    valid.proposal.groups[0]!.children[0]!.unit = "USD/month"; storage.rows = [valid];
    const wrongUnits = new SmartKpiCache({ storage, now: () => now }); await wrongUnits.hydrate();
    expect(wrongUnits.peek({ context: s.context })).toBeUndefined();
  });

  it("falls back to memory on opening/read/quota failures without breaking valid suggestions", async () => {
    const storage = new MemoryStorage(); storage.fail = true;
    const cache = new SmartKpiCache({ storage, now: () => now }), s = await scope();
    expect(await cache.put(s, proposal(s))).toBe(true); expect(cache.peek(s)).toBeDefined(); await cache.flush();
    expect(cache.stats().persistence).toBe("memory");
    const later = new MemoryStorage(), other = new SmartKpiCache({ storage: later, now: () => now }); await other.hydrate(); later.fail = true;
    await other.put(s, proposal(s)); await other.flush(); expect(other.peek(s)).toBeDefined(); expect(other.stats().persistence).toBe("memory");
  });

  it("retains core-verified AST-equivalent model recipe formulas across materialize/cache/reload", async () => {
    const s = await scope(), recipe = catalog.recipes.find(r => r.id === "production.time_rate")!;
    const artifact = materializeKpiSuggestion({ status: "ready", rationale: "Explicit QA applicability for productive time and rate.", limitations: [], groups: [{
      id: "time_rate", title: "Time and rate", selectionMode: "all", requiredKeys: recipe.children.map(c => c.key), recipeId: recipe.id,
      formula: ` ( ${recipe.formula} ) `, limitations: [], children: recipe.children.map(c => ({ key: c.key, conceptKey: c.conceptKey, name: c.name,
        unit: c.key === "working_time" ? "h/month" : "t/h", description: null, existingNodeId: null }))
    }] }, s.context, { proposalId: "model_recipe", requestId: "request_fixture", now: new Date(now).toISOString(), execution })!;
    const storage = new MemoryStorage(), cache = new SmartKpiCache({ storage, now: () => now });
    expect(await cache.put(s, artifact)).toBe(true); await cache.flush();
    const reload = new SmartKpiCache({ storage, now: () => now });
    expect((await reload.read(s))?.groups[0]!.formula).toBe(artifact.groups[0]!.formula);
  });

  it("keeps scoped 30-second negatives only in memory, and explicit retry can clear them", async () => {
    let clock = now; const storage = new MemoryStorage(), cache = new SmartKpiCache({ storage, now: () => clock }), s = await scope();
    await cache.hydrate(); cache.setNegative(s, "timeout", "Fixture timeout");
    expect(cache.negative(s)?.status).toBe("timeout"); expect(cache.negative({ ...s, execution: { ...execution, modelId: "other" } })).toBeUndefined();
    await cache.flush(); expect(storage.rows).toHaveLength(0);
    clock += 30_000; expect(cache.negative(s)).toBeUndefined(); cache.setNegative(s, "empty", "No suitable children"); cache.clearNegative(s);
    expect(cache.negative(s)).toBeUndefined();
  });

  it("retains bounded model-empty limitations through cooldown without shared mutation or persistence", async () => {
    const s = await scope(), storage = new MemoryStorage(), cache = new SmartKpiCache({ storage, now: () => now });
    await cache.hydrate();
    const reason = "The supplied source does not support a defensible immediate layer.", limitations = ["No road-condition measurements were supplied.", "New numeric values would be assumptions."];
    cache.setNegative(s, "empty", reason, limitations); limitations[0] = "caller mutation";
    const first = cache.negative(s)!; expect(first).toMatchObject({ status: "empty", reason, limitations: ["No road-condition measurements were supplied.", "New numeric values would be assumptions."], expiresAt: now + 30_000 });
    first.limitations![0] = "reader mutation"; expect(cache.negative(s)?.limitations?.[0]).toBe("No road-condition measurements were supplied.");
    await cache.flush(); expect(storage.rows).toHaveLength(0);
    for (const invalid of [Array(7).fill("too many"), [""], ["x".repeat(301)], [12]]) {
      cache.clearNegative(s); cache.setNegative(s, "empty", reason, invalid as string[]); expect(cache.negative(s)).toBeUndefined();
    }
  });
});
