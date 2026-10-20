import {
  KPI_SUGGESTION_PREPARATION_VERSION, KPI_SUGGESTION_RECIPES, KPI_SUGGESTION_SCHEMA, KPI_SUGGESTION_VALIDATOR,
  kpiCanonicalJson, kpiSuggestionCacheKey, parseFormula, validateKpiSuggestionContext,
  validateKpiSuggestionForContext, validateKpiSuggestionSet,
  type KpiSuggestionContext, type KpiSuggestionExecutionIdentity,
  type KpiSuggestionRecipeCatalog, type KpiSuggestionSet
} from "@vdt-studio/vdt-core";

export const SMART_KPI_CACHE_LIMITS = { entries: 256, bytes: 2 * 1024 * 1024, negativeMs: 30_000 } as const;
export interface SmartKpiCacheScope { context: KpiSuggestionContext; execution?: KpiSuggestionExecutionIdentity }
export type SmartKpiNegativeStatus = "empty" | "unavailable" | "timeout" | "failed";
export interface SmartKpiNegative { status: SmartKpiNegativeStatus; reason: string; limitations?: string[]; expiresAt: number }
export interface SmartKpiCacheRow { schema: "smart_kpi_cache.v1"; key: string; proposal: KpiSuggestionSet; touchedAt: number }

/** Atomic updates enforce the origin-wide cap, including other instances/tabs.
 * The port owns only this feature's rebuildable object store. */
export interface SmartKpiCacheStorage {
  transact(update: (rows: readonly unknown[]) => SmartKpiCacheRow[]): Promise<readonly unknown[]>;
}
export interface SmartKpiCacheOptions {
  storage?: SmartKpiCacheStorage | null;
  indexedDB?: IDBFactory | null;
  now?: () => number;
  catalog?: KpiSuggestionRecipeCatalog;
  maxEntries?: number;
  maxBytes?: number;
}

type KeyFrame = {
  schema: string; validator: string; preparationVersion: string; catalogVersion: string; workspaceId: string; projectId: string;
  vdtId: string | null; targetNodeId: string; contextHash: string; execution: KpiSuggestionExecutionIdentity | null;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const boundedText = (v: unknown, n = 160): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= n;
const exactKeys = (v: object, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
export const validSmartKpiLimitations = (value: unknown): value is string[] | undefined => value === undefined ||
  Array.isArray(value) && value.length <= 6 && value.every(item => boundedText(item, 300));

export function smartKpiExecutionKey(execution: KpiSuggestionExecutionIdentity): string {
  // Pick only stable public fields; transient host admissions cannot poison reuse.
  const selected = { mode: execution.mode, backendId: execution.backendId, modelId: execution.modelId,
    bindingVersion: execution.bindingVersion, credentialEpoch: execution.credentialEpoch };
  if (!["api", "cli", "local_model"].includes(selected.mode) ||
    ![selected.backendId, selected.modelId, selected.bindingVersion, selected.credentialEpoch].every(v => boundedText(v)))
    throw new Error("Invalid stable Smart execution identity.");
  return kpiCanonicalJson(selected);
}

/** No shared developer caches, localStorage, keys, prompts or project schema. */
export function createSmartKpiIndexedDbStorage(factory: IDBFactory): SmartKpiCacheStorage {
  let database: Promise<IDBDatabase> | undefined;
  const open = () => database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("vdt-smart-kpi-cache", 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error("Smart cache storage opening timed out.")); }, 400);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("proposals")) request.result.createObjectStore("proposals", { keyPath: "key" }); };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => { clearTimeout(timer); reject(request.error ?? new Error("Smart cache storage unavailable.")); };
    request.onblocked = () => { clearTimeout(timer); expired = true; reject(new Error("Smart cache storage is blocked.")); };
  });
  return {
    async transact(update) {
      const db = await open();
      return new Promise<readonly unknown[]>((resolve, reject) => {
        const transaction = db.transaction("proposals", "readwrite"), store = transaction.objectStore("proposals");
        let result: SmartKpiCacheRow[] = [], failure: unknown;
        const timer = setTimeout(() => { try { transaction.abort(); } catch { /* Already terminal. */ } reject(new Error("Smart cache transaction timed out.")); }, 600);
        transaction.oncomplete = () => { clearTimeout(timer); resolve(result); };
        transaction.onerror = transaction.onabort = () => { clearTimeout(timer); reject(failure ?? transaction.error ?? new Error("Smart cache transaction failed.")); };
        const request = store.getAll();
        request.onsuccess = () => {
          try {
            result = update(request.result);
            store.clear();
            for (const row of result) store.put(row);
          } catch (error) { failure = error; transaction.abort(); }
        };
      });
    }
  };
}

/** Untrusted persisted rows are admitted twice: schema/provenance at hydration,
 * then complete context/unit/projection validation at the lookup boundary. */
export class SmartKpiCache {
  readonly catalog: KpiSuggestionRecipeCatalog;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private storage: SmartKpiCacheStorage | undefined;
  private rows = new Map<string, SmartKpiCacheRow>();
  private negatives = new Map<string, SmartKpiNegative>();
  private hydration: Promise<void> | undefined;
  private writes: Promise<void> = Promise.resolve();
  private persistent = false;

  constructor(options: SmartKpiCacheOptions = {}) {
    this.catalog = options.catalog ?? KPI_SUGGESTION_RECIPES;
    this.now = options.now ?? Date.now;
    this.maxEntries = Math.min(SMART_KPI_CACHE_LIMITS.entries, Math.max(1, options.maxEntries ?? SMART_KPI_CACHE_LIMITS.entries));
    this.maxBytes = Math.min(SMART_KPI_CACHE_LIMITS.bytes, Math.max(1, options.maxBytes ?? SMART_KPI_CACHE_LIMITS.bytes));
    try {
      const factory = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
      this.storage = options.storage === null ? undefined : options.storage ?? (factory ? createSmartKpiIndexedDbStorage(factory) : undefined);
    } catch { this.storage = undefined; }
  }

  key(scope: SmartKpiCacheScope): string {
    validateKpiSuggestionContext(scope.context);
    if (scope.execution) smartKpiExecutionKey(scope.execution);
    return kpiSuggestionCacheKey(scope.context, this.catalog.version, scope.execution);
  }

  private frame(key: string): KeyFrame {
    if (key.length > 4096) throw new Error("Invalid Smart cache key.");
    const value = JSON.parse(key) as KeyFrame;
    if (!value || typeof value !== "object" || !exactKeys(value, ["schema", "validator", "preparationVersion", "catalogVersion", "workspaceId", "projectId", "vdtId", "targetNodeId", "contextHash", "execution"]) ||
      kpiCanonicalJson(value) !== key || value.schema !== KPI_SUGGESTION_SCHEMA || value.validator !== KPI_SUGGESTION_VALIDATOR ||
      value.preparationVersion !== KPI_SUGGESTION_PREPARATION_VERSION ||
      value.catalogVersion !== this.catalog.version || ![value.workspaceId, value.projectId, value.targetNodeId].every(v => boundedText(v)) ||
      value.vdtId !== null && !boundedText(value.vdtId) || !/^sha256:[a-f0-9]{64}$/.test(value.contextHash)) throw new Error("Stale Smart cache identity.");
    if (value.execution !== null) {
      if (!value.execution || typeof value.execution !== "object" || !exactKeys(value.execution, ["mode", "backendId", "modelId", "bindingVersion", "credentialEpoch"])) throw new Error("Invalid Smart cache execution.");
      smartKpiExecutionKey(value.execution);
    }
    return value;
  }

  private validatedRow(raw: unknown): SmartKpiCacheRow | undefined {
    try {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || !exactKeys(raw, ["schema", "key", "proposal", "touchedAt"])) return;
      const row = raw as SmartKpiCacheRow;
      if (row.schema !== "smart_kpi_cache.v1" || typeof row.key !== "string" || !Number.isFinite(row.touchedAt) || row.touchedAt < 0) return;
      const frame = this.frame(row.key), proposal = validateKpiSuggestionSet(row.proposal, this.now());
      if (proposal.catalogVersion !== this.catalog.version || proposal.targetNodeId !== frame.targetNodeId || proposal.contextHash !== frame.contextHash) return;
      if (proposal.origin.kind === "model" && (!frame.execution || smartKpiExecutionKey(proposal.origin.execution) !== smartKpiExecutionKey(frame.execution))) return;
      for (const group of proposal.groups) {
        if (proposal.origin.kind === "recipe" && !group.recipeBinding) return;
        if (group.recipeBinding) {
          const binding = group.recipeBinding, recipe = this.catalog.recipes.find(r => r.id === binding.recipeId);
          if (!recipe || binding.skillHash !== recipe.skillHash || binding.recipeHash !== recipe.recipeHash || binding.targetRole !== recipe.targetRole ||
            !group.formula || kpiCanonicalJson(parseFormula(group.formula)) !== kpiCanonicalJson(parseFormula(recipe.formula))) return;
        }
      }
      if (bytes(row) > this.maxBytes) return;
      return clone({ ...row, touchedAt: Math.min(row.touchedAt, this.now()) });
    } catch { return; }
  }

  private compact(input: readonly unknown[]): SmartKpiCacheRow[] {
    const unique = new Map<string, SmartKpiCacheRow>();
    for (const raw of input) {
      const row = this.validatedRow(raw);
      if (row && (!unique.has(row.key) || unique.get(row.key)!.touchedAt <= row.touchedAt)) unique.set(row.key, row);
    }
    const ordered = [...unique.values()].sort((a, b) => b.touchedAt - a.touchedAt), kept: SmartKpiCacheRow[] = [];
    let size = 2;
    for (const row of ordered) {
      const amount = bytes(row) + (kept.length ? 1 : 0);
      if (kept.length < this.maxEntries && size + amount <= this.maxBytes) { kept.push(row); size += amount; }
    }
    return kept;
  }

  hydrate(): Promise<void> {
    return this.hydration ??= (async () => {
      if (!this.storage) return;
      try {
        const rows = await this.storage.transact(input => this.compact(input));
        this.rows = new Map(this.compact(rows).map(row => [row.key, row]));
        this.persistent = true;
      } catch { this.storage = undefined; this.persistent = false; }
    })();
  }

  private persist(change: (rows: readonly unknown[]) => readonly unknown[]): void {
    this.writes = this.writes.then(async () => {
      if (!this.storage) return;
      try { await this.storage.transact(rows => this.compact(change(rows))); this.persistent = true; }
      catch { this.storage = undefined; this.persistent = false; }
    });
  }

  /** Synchronous warm path. Always returns an isolated, freshly revalidated copy. */
  peek(scope: SmartKpiCacheScope): KpiSuggestionSet | undefined {
    try {
      const key = this.key(scope), row = this.rows.get(key);
      if (!row) return;
      const valid = this.validatedRow(row);
      if (!valid) { this.remove(scope); return; }
      const proposal = validateKpiSuggestionForContext(valid.proposal, scope.context, this.catalog, this.now());
      valid.touchedAt = this.now(); this.rows.set(key, valid);
      this.persist(rows => [...rows.filter(r => !(r && typeof r === "object" && "key" in r && r.key === key)), valid]);
      return clone(proposal);
    } catch { this.remove(scope); return; }
  }

  async read(scope: SmartKpiCacheScope): Promise<KpiSuggestionSet | undefined> { await this.hydrate(); return this.peek(scope); }

  async put(scope: SmartKpiCacheScope, input: unknown): Promise<boolean> {
    await this.hydrate();
    try {
      const key = this.key(scope), proposal = clone(validateKpiSuggestionForContext(input, scope.context, this.catalog, this.now()));
      const row = this.validatedRow({ schema: "smart_kpi_cache.v1", key, proposal, touchedAt: this.now() });
      if (!row) return false;
      this.rows = new Map(this.compact([...this.rows.values(), row]).map(r => [r.key, r]));
      this.negatives.delete(key);
      this.persist(rows => [...rows.filter(r => !(r && typeof r === "object" && "key" in r && r.key === key)), row]);
      return this.rows.has(key);
    } catch { return false; }
  }

  remove(scope: SmartKpiCacheScope): void {
    try {
      const key = this.key(scope); this.rows.delete(key); this.negatives.delete(key);
      this.persist(rows => rows.filter(r => !(r && typeof r === "object" && "key" in r && r.key === key)));
    } catch { /* Invalid scope is a miss, never an editing failure. */ }
  }

  negative(scope: SmartKpiCacheScope): SmartKpiNegative | undefined {
    const key = this.key(scope), value = this.negatives.get(key);
    if (!value || value.expiresAt <= this.now()) { this.negatives.delete(key); return; }
    return { ...value, ...(value.limitations ? { limitations: [...value.limitations] } : {}) };
  }
  setNegative(scope: SmartKpiCacheScope, status: SmartKpiNegativeStatus, reason: string, limitations?: string[]): void {
    if (!validSmartKpiLimitations(limitations)) return;
    const key = this.key(scope);
    this.negatives.delete(key);
    this.negatives.set(key, { status, reason: reason.slice(0, 300), ...(limitations ? { limitations: [...limitations] } : {}), expiresAt: this.now() + SMART_KPI_CACHE_LIMITS.negativeMs });
    while (this.negatives.size > this.maxEntries) this.negatives.delete(this.negatives.keys().next().value!);
  }
  clearNegative(scope: SmartKpiCacheScope): void { this.negatives.delete(this.key(scope)); }
  async flush(): Promise<void> { await this.hydrate(); await this.writes; }
  stats(): { entries: number; bytes: number; persistence: "indexeddb" | "memory" } {
    return { entries: this.rows.size, bytes: bytes([...this.rows.values()]), persistence: this.persistent ? "indexeddb" : "memory" };
  }
}
