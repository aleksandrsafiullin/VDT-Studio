import fs from "node:fs";
import path from "node:path";
import type { ProjectManifest } from "./types";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function assertSafeId(id: string, label = "id"): string {
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new Error(`${label} must be a safe id using letters, numbers, underscores, or hyphens.`);
  }
  return id;
}

export function ensureProjectLocation(locationPath: string): string {
  const resolved = path.resolve(locationPath);
  fs.mkdirSync(resolved, { recursive: true });
  return fs.realpathSync(resolved);
}

export function projectDir(locationPath: string, projectId: string): string {
  const location = ensureProjectLocation(locationPath);
  assertSafeId(projectId, "projectId");
  const dir = path.join(location, "projects", projectId);
  assertInside(location, dir);
  return dir;
}

export function createProjectDir(locationPath: string, projectId: string): string {
  const dir = projectDir(locationPath, projectId);
  for (const relative of [
    ".vdt-studio",
    "vdts",
    "files",
    "comparisons"
  ]) {
    fs.mkdirSync(path.join(dir, relative), { recursive: true });
  }
  return fs.realpathSync(dir);
}

export function vdtRevisionDir(locationPath: string, projectId: string, vdtId: string): string {
  assertSafeId(vdtId, "vdtId");
  const dir = path.join(projectDir(locationPath, projectId), "vdts", vdtId, "revisions");
  assertInside(ensureProjectLocation(locationPath), dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function vdtPreviewDir(locationPath: string, projectId: string, vdtId: string): string {
  assertSafeId(vdtId, "vdtId");
  const dir = path.join(projectDir(locationPath, projectId), "vdts", vdtId, "previews");
  assertInside(ensureProjectLocation(locationPath), dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeProjectManifest(projectPath: string, manifest: ProjectManifest): void {
  assertSafeId(manifest.id, "projectId");
  const dir = path.join(projectPath, ".vdt-studio");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "project.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function readProjectManifest(projectPath: string): ProjectManifest {
  const manifestPath = path.join(projectPath, ".vdt-studio", "project.json");
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ProjectManifest;
  if (raw.schemaVersion !== 1) {
    throw new Error(`Unsupported project manifest schemaVersion: ${String(raw.schemaVersion)}`);
  }
  assertSafeId(raw.id, "projectId");
  return raw;
}

export function scanProjectLocation(locationPath: string): ProjectManifest[] {
  const location = ensureProjectLocation(locationPath);
  const projectsDir = path.join(location, "projects");
  if (!fs.existsSync(projectsDir)) return [];
  return fs.readdirSync(projectsDir)
    .flatMap((entry) => {
      if (!SAFE_ID_PATTERN.test(entry)) return [];
      const dir = path.join(projectsDir, entry);
      const stat = fs.lstatSync(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return [];
      try {
        return [readProjectManifest(dir)];
      } catch {
        return [];
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function assertInside(rootPath: string, candidatePath: string): void {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project storage root: ${candidatePath}`);
  }
}
