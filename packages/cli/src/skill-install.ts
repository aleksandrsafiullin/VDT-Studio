import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const NATIVE_SKILL_DIRECTORIES = {
  claude: [".claude", "skills"],
  codex: [".codex", "skills"],
  cursor: [".cursor", "skills"],
  copilot: [".copilot", "skills"],
  gemini: [".gemini", "skills"],
  opencode: [".config", "opencode", "skills"]
} as const;

export type NativeSkillTarget = keyof typeof NATIVE_SKILL_DIRECTORIES;
export type SkillInstallAction = "install" | "uninstall";

export interface SkillDirectoryContext {
  home: string;
  codexHome?: string | undefined;
}

export interface SkillBundlePlanOptions extends SkillDirectoryContext {
  action: SkillInstallAction;
  agent: string;
  sourceRoot?: string | undefined;
  targetRoot?: string | undefined;
  bundles?: readonly string[] | undefined;
}

export interface WriteSkillFileOperation {
  kind: "write-file";
  path: string;
  contentBase64: string;
  sha256: string;
  expectedSha256: string | null;
}

export interface RemoveSkillFileOperation {
  kind: "remove-file";
  path: string;
  sha256: string;
}

export interface RemoveSkillDirectoryOperation {
  kind: "remove-directory-if-empty";
  path: string;
}

export type SkillPlanOperation =
  | WriteSkillFileOperation
  | RemoveSkillFileOperation
  | RemoveSkillDirectoryOperation;

export interface SkillBundlePlan {
  version: 1;
  action: SkillInstallAction;
  agent: string;
  sourceRoot: string;
  targetRoot: string;
  bundles: string[];
  operations: SkillPlanOperation[];
  changed: boolean;
}

interface BundleFile {
  relativePath: string;
  content: Buffer;
  sha256: string;
}

interface SkillOwnershipManifest {
  version: 1;
  owner: "vdt-studio";
  bundle: string;
  files: Record<string, string>;
  fingerprint: string;
}

const modulePath = fileURLToPath(import.meta.url);
const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL(modulePath.endsWith(".ts") ? "../../../skills" : "./skills", import.meta.url));
const AGENT_SLUG = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const OWNERSHIP_MANIFEST = ".vdt-studio-skill.json";

export function resolveSkillsDirectory(agent: string, context: SkillDirectoryContext): string {
  validateAgent(agent);
  if (agent === "codex" && context.codexHome) {
    return path.join(path.resolve(context.codexHome), "skills");
  }
  const nativeParts = NATIVE_SKILL_DIRECTORIES[agent as NativeSkillTarget];
  return nativeParts
    ? path.join(path.resolve(context.home), ...nativeParts)
    : path.join(path.resolve(context.home), ".config", agent, "skills");
}

export async function planSkillBundle(options: SkillBundlePlanOptions): Promise<SkillBundlePlan> {
  validateAgent(options.agent);
  const sourceRoot = path.resolve(options.sourceRoot ?? DEFAULT_SOURCE_ROOT);
  const targetRoot = path.resolve(options.targetRoot ?? resolveSkillsDirectory(options.agent, options));
  assertDisjointRoots(sourceRoot, targetRoot);
  const bundles = options.bundles ? [...new Set(options.bundles)] : await discoverBundles(sourceRoot);

  if (bundles.length === 0) {
    throw new Error(`No skill bundles found in ${sourceRoot}.`);
  }
  bundles.forEach(validateBundleName);
  bundles.sort();

  const inventory = new Map<string, BundleFile[]>();
  for (const bundle of bundles) {
    const files = await readBundle(path.join(sourceRoot, bundle));
    if (!files.some((file) => file.relativePath === "SKILL.md")) {
      throw new Error(`Skill bundle ${bundle} must contain SKILL.md.`);
    }
    inventory.set(bundle, files);
  }

  const operations = options.action === "install"
    ? await planInstall(targetRoot, bundles, inventory)
    : await planUninstall(targetRoot, bundles);

  return {
    version: 1,
    action: options.action,
    agent: options.agent,
    sourceRoot,
    targetRoot,
    bundles,
    operations,
    changed: operations.length > 0
  };
}

export async function applySkillBundlePlan(plan: SkillBundlePlan): Promise<void> {
  if (plan.version !== 1 || (plan.action !== "install" && plan.action !== "uninstall")) {
    throw new Error("Unsupported skill bundle plan.");
  }
  validateAgent(plan.agent);
  plan.bundles.forEach(validateBundleName);
  await assertPlanOwnership(plan);
  for (const operation of plan.operations) {
    assertOperationPath(plan, operation.path);
    await assertNoSymlinkComponents(plan.targetRoot, operation.path);
    if (operation.kind === "write-file") {
      await assertExpectedChecksum(operation.path, operation.expectedSha256, "write");
      await atomicWrite(operation);
      continue;
    }
    if (operation.kind === "remove-file") {
      const current = await readRegularFile(operation.path);
      if (current && digest(current) === operation.sha256) {
        await rm(operation.path);
      }
      continue;
    }
    try {
      await rmdir(operation.path);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT") && !hasErrorCode(error, "ENOTEMPTY") && !hasErrorCode(error, "EEXIST")) {
        throw error;
      }
    }
  }
}

async function planInstall(
  targetRoot: string,
  bundles: string[],
  inventory: Map<string, BundleFile[]>
): Promise<SkillPlanOperation[]> {
  const operations: SkillPlanOperation[] = [];
  for (const bundle of bundles) {
    const bundleRoot = path.join(targetRoot, bundle);
    const manifestPath = path.join(bundleRoot, OWNERSHIP_MANIFEST);
    const existingManifest = await readOwnershipManifest(bundleRoot, bundle);
    const nextFiles = { ...(existingManifest?.files ?? {}) };
    let manifestChanged = existingManifest === null;

    for (const file of inventory.get(bundle) ?? []) {
      if (file.relativePath === OWNERSHIP_MANIFEST) {
        throw new Error(`Skill bundle ${bundle} uses reserved file ${OWNERSHIP_MANIFEST}.`);
      }
      const targetPath = path.join(targetRoot, bundle, ...file.relativePath.split("/"));
      const current = await readRegularFile(targetPath);
      const currentSha256 = current ? digest(current) : null;
      const previouslyManagedSha256 = existingManifest?.files[file.relativePath];
      const mayWrite = existingManifest === null
        ? current === null
        : currentSha256 === file.sha256 || currentSha256 === previouslyManagedSha256 || (current === null && previouslyManagedSha256 === undefined);

      if (!mayWrite) {
        continue;
      }
      if (currentSha256 !== file.sha256) {
        operations.push({
          kind: "write-file",
          path: targetPath,
          contentBase64: file.content.toString("base64"),
          sha256: file.sha256,
          expectedSha256: currentSha256
        });
      }
      if (nextFiles[file.relativePath] !== file.sha256) {
        nextFiles[file.relativePath] = file.sha256;
        manifestChanged = true;
      }
    }

    if (manifestChanged) {
      const manifest = createOwnershipManifest(bundle, nextFiles);
      const content = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      const currentManifest = await readRegularFile(manifestPath);
      operations.push({
        kind: "write-file",
        path: manifestPath,
        contentBase64: content.toString("base64"),
        sha256: digest(content),
        expectedSha256: currentManifest ? digest(currentManifest) : null
      });
    }
  }
  return operations;
}

async function planUninstall(
  targetRoot: string,
  bundles: string[]
): Promise<SkillPlanOperation[]> {
  const operations: SkillPlanOperation[] = [];
  for (const bundle of bundles) {
    const bundleRoot = path.join(targetRoot, bundle);
    const manifest = await readOwnershipManifest(bundleRoot, bundle);
    if (manifest === null) {
      continue;
    }
    const directories = new Set<string>();
    for (const [relativePath, installedSha256] of Object.entries(manifest.files)) {
      const targetPath = path.join(targetRoot, bundle, ...relativePath.split("/"));
      const current = await readRegularFile(targetPath);
      if (current && digest(current) === installedSha256) {
        operations.push({ kind: "remove-file", path: targetPath, sha256: installedSha256 });
      }
      let directory = path.dirname(targetPath);
      while (directory.startsWith(`${bundleRoot}${path.sep}`)) {
        directories.add(directory);
        directory = path.dirname(directory);
      }
    }
    const manifestPath = path.join(bundleRoot, OWNERSHIP_MANIFEST);
    const manifestContent = await readRegularFile(manifestPath);
    if (!manifestContent) {
      throw new Error(`Skill ownership manifest disappeared from ${bundleRoot}.`);
    }
    operations.push({ kind: "remove-file", path: manifestPath, sha256: digest(manifestContent) });
    directories.add(path.join(targetRoot, bundle));
    operations.push(
      ...[...directories]
        .sort((left, right) => right.length - left.length)
        .map((directory): RemoveSkillDirectoryOperation => ({ kind: "remove-directory-if-empty", path: directory }))
    );
  }
  return operations.filter((operation) => operation.kind !== "remove-directory-if-empty" || operations.some(
    (candidate) => candidate.kind === "remove-file" && candidate.path.startsWith(`${operation.path}${path.sep}`)
  ));
}

async function assertPlanOwnership(plan: SkillBundlePlan): Promise<void> {
  for (const bundle of plan.bundles) {
    const bundleRoot = path.join(plan.targetRoot, bundle);
    const manifestPath = path.join(bundleRoot, OWNERSHIP_MANIFEST);
    const manifestOperation = plan.operations.find((operation) => operation.path === manifestPath);
    if (!manifestOperation) continue;

    if (manifestOperation.kind === "write-file" && manifestOperation.expectedSha256 === null) {
      try {
        await lstat(bundleRoot);
        throw new Error(`Refusing to install into foreign skill directory ${bundleRoot}.`);
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) throw error;
      }
      continue;
    }

    const expectedSha256 = manifestOperation.kind === "write-file"
      ? manifestOperation.expectedSha256
      : manifestOperation.kind === "remove-file"
        ? manifestOperation.sha256
        : null;
    await assertExpectedChecksum(manifestPath, expectedSha256, "modify");
  }
}

async function assertExpectedChecksum(filePath: string, expectedSha256: string | null, action: string): Promise<void> {
  const current = await readRegularFile(filePath);
  const currentSha256 = current ? digest(current) : null;
  if (currentSha256 !== expectedSha256) {
    throw new Error(`Refusing to ${action} skill file changed after planning: ${filePath}.`);
  }
}

async function readOwnershipManifest(bundleRoot: string, bundle: string): Promise<SkillOwnershipManifest | null> {
  let stats;
  try {
    stats = await lstat(bundleRoot);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Refusing to modify foreign skill path ${bundleRoot}.`);
  }

  const manifestPath = path.join(bundleRoot, OWNERSHIP_MANIFEST);
  const content = await readRegularFile(manifestPath);
  if (!content) {
    throw new Error(`Refusing to modify existing skill directory ${bundleRoot} without a valid VDT Studio ownership manifest.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error(`Refusing to modify skill directory ${bundleRoot}: invalid ownership manifest.`);
  }
  if (!isOwnershipManifest(parsed, bundle) || parsed.fingerprint !== ownershipFingerprint(parsed.bundle, parsed.files)) {
    throw new Error(`Refusing to modify skill directory ${bundleRoot}: ownership manifest fingerprint is invalid.`);
  }
  return parsed;
}

function createOwnershipManifest(bundle: string, files: Record<string, string>): SkillOwnershipManifest {
  const sortedFiles = Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
  return {
    version: 1,
    owner: "vdt-studio",
    bundle,
    files: sortedFiles,
    fingerprint: ownershipFingerprint(bundle, sortedFiles)
  };
}

function isOwnershipManifest(value: unknown, bundle: string): value is SkillOwnershipManifest {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<SkillOwnershipManifest>;
  return candidate.version === 1
    && candidate.owner === "vdt-studio"
    && candidate.bundle === bundle
    && candidate.files !== null
    && typeof candidate.files === "object"
    && !Array.isArray(candidate.files)
    && Object.entries(candidate.files).every(([relativePath, sha256]) => isSafeManifestPath(relativePath) && typeof sha256 === "string" && /^[a-f0-9]{64}$/.test(sha256))
    && typeof candidate.fingerprint === "string";
}

function isSafeManifestPath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  return relativePath !== OWNERSHIP_MANIFEST
    && relativePath.length > 0
    && !path.isAbsolute(relativePath)
    && !relativePath.includes("\\")
    && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function ownershipFingerprint(bundle: string, files: Record<string, string>): string {
  const sortedFiles = Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
  return digest(Buffer.from(JSON.stringify({ version: 1, owner: "vdt-studio", bundle, files: sortedFiles }), "utf8"));
}

async function discoverBundles(sourceRoot: string): Promise<string[]> {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function readBundle(bundleRoot: string): Promise<BundleFile[]> {
  const files: BundleFile[] = [];

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(`Skill bundles cannot contain symbolic links: ${absolutePath}`);
      }
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Unsupported skill bundle entry: ${absolutePath}`);
      }
      const content = await readFile(absolutePath);
      files.push({ relativePath, content, sha256: digest(content) });
    }
  }

  await visit(bundleRoot, "");
  return files;
}

async function readRegularFile(filePath: string): Promise<Buffer | null> {
  try {
    const stats = await lstat(filePath);
    if (!stats.isFile()) {
      return null;
    }
    return await readFile(filePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function atomicWrite(operation: WriteSkillFileOperation): Promise<void> {
  const content = Buffer.from(operation.contentBase64, "base64");
  if (digest(content) !== operation.sha256) {
    throw new Error(`Skill plan checksum mismatch for ${operation.path}.`);
  }
  const directory = path.dirname(operation.path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.vdt-skill-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { flag: "wx", mode: 0o644 });
    await rename(temporaryPath, operation.path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function validateAgent(agent: string): void {
  if (!AGENT_SLUG.test(agent)) {
    throw new Error(`Invalid agent target: ${agent}`);
  }
}

function validateBundleName(bundle: string): void {
  if (!AGENT_SLUG.test(bundle)) {
    throw new Error(`Invalid skill bundle name: ${bundle}`);
  }
}

function assertDisjointRoots(sourceRoot: string, targetRoot: string): void {
  if (isWithin(sourceRoot, targetRoot) || isWithin(targetRoot, sourceRoot)) {
    throw new Error(`Skill source and target directories must not overlap: ${sourceRoot} and ${targetRoot}`);
  }
}

function assertOperationPath(plan: SkillBundlePlan, operationPath: string): void {
  const resolvedPath = path.resolve(operationPath);
  const allowed = plan.bundles.some((bundle) => isWithin(path.join(path.resolve(plan.targetRoot), bundle), resolvedPath));
  if (!allowed) {
    throw new Error(`Skill plan operation is outside its target bundles: ${operationPath}`);
  }
}

async function assertNoSymlinkComponents(targetRoot: string, operationPath: string): Promise<void> {
  const root = path.resolve(targetRoot);
  const target = path.resolve(operationPath);
  const relative = path.relative(root, target);
  const components = relative === "" ? [] : relative.split(path.sep);
  let current = root;
  for (const component of ["", ...components.slice(0, -1)]) {
    if (component) current = path.join(current, component);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing to follow symbolic link in skill target: ${current}`);
      }
      if (!stats.isDirectory()) {
        throw new Error(`Skill target path component is not a directory: ${current}`);
      }
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error;
    }
  }
  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to modify symbolic link skill target: ${target}`);
    }
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function digest(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
