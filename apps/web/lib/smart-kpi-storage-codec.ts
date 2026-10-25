import { kpiCanonicalJson } from "@vdt-studio/vdt-core";

type Data = Record<string, unknown>;
type OperationRefs = { before?: true; beforeJson?: true; inputProject?: true; versions?: [number, number][]; snapshots?: number[] };
type UndoRefs = { appliedJson?: true; before?: { checkpoint: number; versions: Array<{ ref: number } | { value: unknown }> } };
const FORMAT = "smart_kpi_storage.v1";
const record = (v: unknown): v is Data => v !== null && typeof v === "object" && !Array.isArray(v);
const project = (v: unknown): v is Data & { versions: unknown[] } => record(v) && typeof v.id === "string"
  && record(v.graph) && Array.isArray(v.graph.nodes) && Array.isArray(v.graph.edges) && Array.isArray(v.versions);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const require = (condition: unknown): void => { if (!condition) throw new Error("The compact Smart journal is inconsistent or unsupported."); };
const index = (value: unknown, list: unknown[]): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < list.length;
const keys = (v: Data, allowed: string[]) => Object.keys(v).every(key => allowed.includes(key));
/** Detect damaged references/anchor data, not an authentication mechanism.
 * Existing journal validation and revision CAS remain the authority. */
function checksum(value: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) { const code = value.charCodeAt(i); a = Math.imul(a ^ code, 0x01000193); b = Math.imul(b ^ code, 0x85ebca6b); }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

function packOperation(operation: Data, current: unknown): OperationRefs | undefined {
  const before = operation.before, candidate = operation.candidate, refs: OperationRefs = {};
  if (!project(before)) return;
  // Compare the complete original values before replacing any nested payload.
  const inputMatches = record(operation.input) && project(candidate) && equal(operation.input.project, candidate);
  if (typeof operation.beforeJson === "string" && operation.beforeJson === kpiCanonicalJson(before)) {
    operation.beforeJson = null; refs.beforeJson = true;
  }
  if (project(candidate)) {
    const known = new Map(before.versions.map((v, i) => [JSON.stringify(v), i]));
    const snapshot = { ...before, versions: [] };
    candidate.versions.forEach((version, i) => {
      const prior = known.get(JSON.stringify(version));
      if (prior !== undefined) { (refs.versions ??= []).push([i, prior]); candidate.versions[i] = null; }
      else if (record(version) && equal(version.projectSnapshot, snapshot)) {
        (refs.snapshots ??= []).push(i); version.projectSnapshot = null;
      }
    });
  }
  if (inputMatches && record(operation.input)) { operation.input.project = null; refs.inputProject = true; }
  if (equal(before, current)) { operation.before = null; refs.before = true; }
  return Object.keys(refs).length ? refs : undefined;
}

function unpackOperation(operation: Data, raw: unknown, current: unknown): void {
  require(record(raw) && keys(raw, ["before", "beforeJson", "inputProject", "versions", "snapshots"]));
  const refs = raw as OperationRefs;
  for (const name of ["before", "beforeJson", "inputProject"] as const) require(refs[name] === undefined || refs[name] === true);
  if (refs.before) { require(operation.before === null && project(current)); operation.before = current; }
  const before = operation.before;
  require(project(before));
  if (!project(before)) return;
  if (refs.beforeJson) { require(operation.beforeJson === null); operation.beforeJson = kpiCanonicalJson(before); }
  const candidate = operation.candidate, filled = new Set<number>();
  if (refs.versions !== undefined) {
    require(project(candidate) && Array.isArray(refs.versions));
    if (!project(candidate)) return;
    require(refs.versions.length <= candidate.versions.length);
    for (const pair of refs.versions) {
      require(Array.isArray(pair) && pair.length === 2 && index(pair[0], candidate.versions) && index(pair[1], before.versions)
        && !filled.has(pair[0]) && candidate.versions[pair[0]] === null);
      filled.add(pair[0]); candidate.versions[pair[0]] = before.versions[pair[1]];
    }
  }
  if (refs.snapshots !== undefined) {
    require(project(candidate) && Array.isArray(refs.snapshots));
    if (!project(candidate)) return;
    require(refs.snapshots.length <= candidate.versions.length);
    for (const i of refs.snapshots) {
      require(index(i, candidate.versions) && !filled.has(i));
      const version = candidate.versions[i]; require(record(version) && version.projectSnapshot === null);
      if (!record(version)) return;
      filled.add(i); version.projectSnapshot = { ...before, versions: [] };
    }
  }
  if (refs.inputProject) {
    require(record(operation.input) && operation.input.project === null && project(candidate));
    if (record(operation.input)) operation.input.project = candidate;
  }
}

function packUndo(undo: Data, current: unknown): UndoRefs | undefined {
  if (!project(current)) return;
  const refs: UndoRefs = {};
  if (typeof undo.appliedJson === "string" && undo.appliedJson === kpiCanonicalJson(current)) { undo.appliedJson = null; refs.appliedJson = true; }
  const before = undo.before;
  if (project(before)) {
    const checkpoint = current.versions.findIndex(v => record(v) && v.id === undo.checkpointVersionId
      && equal(v.projectSnapshot, { ...before, versions: [] }));
    if (checkpoint >= 0) {
      const known = new Map(current.versions.map((v, i) => [JSON.stringify(v), i]));
      refs.before = { checkpoint, versions: before.versions.map(v => {
        const ref = known.get(JSON.stringify(v)); return ref === undefined ? { value: v } : { ref };
      }) };
      undo.before = null;
    }
  }
  return Object.keys(refs).length ? refs : undefined;
}

function unpackUndo(undo: Data, raw: unknown, current: unknown): void {
  require(record(raw) && keys(raw, ["appliedJson", "before"]) && project(current));
  if (!record(raw) || !project(current)) return;
  require(raw.appliedJson === undefined || raw.appliedJson === true);
  if (raw.appliedJson) { require(undo.appliedJson === null); undo.appliedJson = kpiCanonicalJson(current); }
  if (raw.before !== undefined) {
    const before = raw.before;
    require(record(before) && keys(before, ["checkpoint", "versions"]) && index(before.checkpoint, current.versions) && Array.isArray(before.versions) && undo.before === null);
    if (!record(before) || !index(before.checkpoint, current.versions) || !Array.isArray(before.versions)) return;
    const version = current.versions[before.checkpoint];
    require(record(version) && version.id === undo.checkpointVersionId && project(version.projectSnapshot));
    if (!record(version) || !project(version.projectSnapshot)) return;
    const versions = before.versions.map(entry => {
      require(record(entry) && (keys(entry, ["ref"]) && index(entry.ref, current.versions) || keys(entry, ["value"]) && Object.hasOwn(entry, "value")));
      if (!record(entry)) return;
      return Object.hasOwn(entry, "ref") ? current.versions[entry.ref as number] : entry.value;
    });
    undo.before = { ...version.projectSnapshot, versions };
  }
}

/** Quota fallback only. References cover redundant Smart payloads, never data
 * removal. Main project/UI state stay ordinary JSON. Field positions are kept
 * with null placeholders so decoded HTTP request bytes retain their ordering. */
export function compactSmartKpiStorage(value: string): string | undefined {
  const parsed: unknown = JSON.parse(value);
  if (!record(parsed) || !record(parsed.state) || Object.hasOwn(parsed, "smartKpiPersistence")) return;
  const original = JSON.stringify(parsed);
  const state = parsed.state, refs: Data = { schemaVersion: FORMAT };
  const sameConflict = record(state.smartKpiOperation) && equal(state.smartKpiConflictOperation, state.smartKpiOperation);
  if (record(state.smartKpiOperation)) refs.operation = packOperation(state.smartKpiOperation, state.project);
  if (sameConflict) { state.smartKpiConflictOperation = null; refs.conflictIsOperation = true; }
  else if (record(state.smartKpiConflictOperation)) refs.conflict = packOperation(state.smartKpiConflictOperation, state.project);
  if (record(state.smartKpiUndo)) refs.undo = packUndo(state.smartKpiUndo, state.project);
  if (!Object.entries(refs).some(([key, v]) => key !== "schemaVersion" && v !== undefined)) return;
  refs.length = original.length; refs.checksum = checksum(original);
  parsed.smartKpiPersistence = refs;
  const compact = JSON.stringify(parsed);
  return compact.length < value.length ? compact : undefined;
}

/** Restores the same logical v1/v2 journal before Zustand hydration or exact
 * pre-POST readback. Old unencoded editor records remain readable unchanged. */
export function expandSmartKpiStorage(value: string): string {
  const parsed: unknown = JSON.parse(value);
  if (!record(parsed) || !Object.hasOwn(parsed, "smartKpiPersistence")) return value;
  const refs = parsed.smartKpiPersistence;
  require(record(refs) && refs.schemaVersion === FORMAT && keys(refs, ["schemaVersion", "operation", "conflict", "conflictIsOperation", "undo", "length", "checksum"])
    && Number.isSafeInteger(refs.length) && Number(refs.length) >= 0 && typeof refs.checksum === "string" && /^[a-f0-9]{16}$/.test(refs.checksum) && record(parsed.state));
  if (!record(refs) || !record(parsed.state)) return value;
  const state = parsed.state;
  if (refs.operation !== undefined) { require(record(state.smartKpiOperation)); if (record(state.smartKpiOperation)) unpackOperation(state.smartKpiOperation, refs.operation, state.project); }
  require(refs.conflictIsOperation === undefined || refs.conflictIsOperation === true);
  if (refs.conflictIsOperation) { require(refs.conflict === undefined && state.smartKpiConflictOperation === null && record(state.smartKpiOperation)); state.smartKpiConflictOperation = state.smartKpiOperation; }
  else if (refs.conflict !== undefined) { require(record(state.smartKpiConflictOperation)); if (record(state.smartKpiConflictOperation)) unpackOperation(state.smartKpiConflictOperation, refs.conflict, state.project); }
  if (refs.undo !== undefined) { require(record(state.smartKpiUndo)); if (record(state.smartKpiUndo)) unpackUndo(state.smartKpiUndo, refs.undo, state.project); }
  delete parsed.smartKpiPersistence;
  const expanded = JSON.stringify(parsed);
  require(expanded.length === refs.length && checksum(expanded) === refs.checksum);
  return expanded;
}
