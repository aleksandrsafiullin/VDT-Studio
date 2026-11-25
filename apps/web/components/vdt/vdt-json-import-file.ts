import { importProjectJson, type VdtNodeValueSource, type VdtProject, type VdtVersion } from "@vdt-studio/vdt-core";

export const MAX_VDT_JSON_BYTES = 4 * 1024 * 1024;
const MAX_JSON_DEPTH = 32;

export async function readPortableVdt(file: Pick<File, "size" | "text">, signal: AbortSignal): Promise<{
  project: VdtProject;
  detachedSources: boolean;
}> {
  if (file.size > MAX_VDT_JSON_BYTES) throw new Error("Choose a VDT JSON file of 4 MiB or less.");
  signal.throwIfAborted();
  const text = await file.text();
  signal.throwIfAborted();
  const raw = parseBoundedJson(text);
  const project = importProjectJson(text);
  let detachedSources = detachWorkspaceSources(project);

  // The common importer validates graph shape; its legacy version envelope is
  // permissive, so validate each portable snapshot as a model too.
  if (isRecord(raw) && raw.versions !== undefined && !Array.isArray(raw.versions)) {
    throw new Error("Imported VDT versions must be an array.");
  }
  project.versions = project.versions.map((version) => {
    const parsed = readVersion(version);
    detachedSources = detachWorkspaceSources(parsed.projectSnapshot) || detachedSources;
    return parsed;
  });
  return { project, detachedSources };
}

function parseBoundedJson(text: string): unknown {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Project JSON could not be parsed.");
  }
  // Bound nested version/source fields before passing them to serializers.
  function check(value: unknown, depth: number): void {
    if (depth > MAX_JSON_DEPTH) throw new Error("The VDT JSON is nested too deeply.");
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("The VDT JSON contains a non-finite number.");
    if (Array.isArray(value)) {
      for (const item of value) check(item, depth + 1);
    } else if (isRecord(value)) {
      if (Object.hasOwn(value, "__proto__")) throw new Error("The VDT JSON contains an unsupported object key.");
      for (const child of Object.values(value)) check(child, depth + 1);
    }
  }
  check(raw, 0);
  return raw;
}

function readVersion(value: unknown): VdtVersion {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.name !== "string" || !value.name ||
      typeof value.createdAt !== "string" || !isRecord(value.projectSnapshot) ||
      (value.description !== undefined && typeof value.description !== "string") ||
      (value.taskType !== undefined && typeof value.taskType !== "string")) {
    throw new Error("The VDT JSON contains a malformed named version.");
  }
  const snapshot = importProjectJson(JSON.stringify(value.projectSnapshot));
  if (snapshot.versions.length || (value.projectSnapshot.versions !== undefined && !Array.isArray(value.projectSnapshot.versions))) {
    throw new Error("A named version cannot contain another version history.");
  }
  return {
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.taskType === undefined ? {} : { taskType: value.taskType as VdtVersion["taskType"] }),
    projectSnapshot: snapshot
  };
}

function detachWorkspaceSources(project: VdtProject): boolean {
  let detached = false;
  project.dataSources = project.dataSources.flatMap((source) => {
    if (source.type !== "manual" || source.file) {
      detached = true;
      return [];
    }
    if (source.schema || source.profile || source.semanticModel) detached = true;
    return [{ id: source.id, name: source.name, type: source.type, description: source.description }];
  });
  const manualSources = new Set(project.dataSources.map(({ id }) => id));
  for (const node of project.graph.nodes) {
    if (node.dataMapping && !manualSources.has(node.dataMapping.sourceId)) {
      delete node.dataMapping;
      detached = true;
    }
    if (node.valueSource) {
      const source = readValueSource(node.valueSource);
      if (source.sourceTier === "file" || source.sourceTier === "uploaded_data") {
        if (source.catalogRef !== undefined) detached = true;
        delete source.catalogRef;
      }
      node.valueSource = source;
    }
  }
  project.aiSettings = { defaultProviderId: "mock" };
  return detached;
}

function readValueSource(value: VdtNodeValueSource): VdtNodeValueSource {
  const { sourceTier, confidence, catalogRef, acceptedByUserInDialog, editableInDialog, note, range } = value;
  if ([sourceTier, confidence, catalogRef, note].some((field) => field !== undefined && typeof field !== "string") ||
      [acceptedByUserInDialog, editableInDialog].some((field) => field !== undefined && typeof field !== "boolean") ||
      (range !== undefined && (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite)))) {
    throw new Error("The VDT JSON contains malformed value provenance.");
  }
  return { sourceTier, confidence, catalogRef, acceptedByUserInDialog, editableInDialog, note, range };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
