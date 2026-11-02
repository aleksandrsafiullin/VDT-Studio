import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { BUILTIN_HARNESSES, builtinHarness, isHarnessId, type HarnessDefinition, type HarnessId } from "./catalog";
import { assertArgsSafe } from "../subscription-cli/security";

export interface CustomHarnessProfile {
  id: `custom-${string}`;
  name: string;
  transport: "acp" | "vdt-jsonl";
  command: string;
  args: string[];
  environmentRefs: Record<string, string>;
  defaultModel?: string;
  timeoutMs: number;
  baseHarness?: HarnessDefinition["baseHarness"];
}
const fail = (message: string) => Object.assign(new Error(message), { code: "INVALID_HARNESS_PROFILE" });
export function validateHarnessProfile(value: unknown): CustomHarnessProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("A harness profile object is required.");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["id", "name", "transport", "command", "args", "environmentRefs", "defaultModel", "timeoutMs", "baseHarness"].includes(k))) throw fail("Unknown harness profile field.");
  const id = v.id ?? `custom-${randomUUID()}`;
  if (!isHarnessId(id) || !id.startsWith("custom-")) throw fail("Custom harness IDs must start with custom-.");
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 100 || /[\x00-\x1f]/.test(v.name)) throw fail("Enter a name of at most 100 characters.");
  if (v.transport !== "acp" && v.transport !== "vdt-jsonl") throw fail("Choose ACP or the VDT JSONL adapter protocol.");
  if (typeof v.command !== "string" || !v.command.trim() || v.command.length > 4096 || /[\x00\r\n]/.test(v.command) || /^(?:sh|bash|zsh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh)$/i.test(path.basename(v.command))) throw fail("Choose an executable, not a shell command.");
  if (!Array.isArray(v.args) || v.args.length > 64 || v.args.some(a => typeof a !== "string" || a.length > 4096)) throw fail("Arguments must be an array of at most 64 strings.");
  assertArgsSafe(v.args as string[]);
  const refs = v.environmentRefs ?? {};
  if (typeof refs !== "object" || !refs || Array.isArray(refs) || Object.keys(refs).length > 32) throw fail("Environment references must be a name-to-name map.");
  for (const [name, ref] of Object.entries(refs)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof ref !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref) || /^(?:NODE_OPTIONS|LD_.*|DYLD_.*|PATH|HOME|HERMES_HOME|CODEX_HOME|OPENCODE_CONFIG.*)$/i.test(name)) throw fail("Only non-runtime environment variable references are allowed.");
  }
  const timeoutMs = v.timeoutMs ?? 180_000;
  if (!Number.isSafeInteger(timeoutMs) || Number(timeoutMs) < 1000 || Number(timeoutMs) > 480_000) throw fail("Timeout must be between 1 and 480 seconds.");
  if (v.defaultModel !== undefined && (typeof v.defaultModel !== "string" || !v.defaultModel.trim() || v.defaultModel.length > 256 || /^[\s-]|[\x00-\x1f]/.test(v.defaultModel))) throw fail("Invalid default model.");
  if (v.baseHarness !== undefined && !builtinHarness(String(v.baseHarness))) throw fail("Unknown base harness.");
  return { id: id as CustomHarnessProfile["id"], name: v.name.trim(), transport: v.transport, command: v.command.trim(), args: [...v.args] as string[], environmentRefs: { ...refs } as Record<string, string>, timeoutMs: Number(timeoutMs),
    ...(v.defaultModel ? { defaultModel: v.defaultModel as string } : {}), ...(v.baseHarness ? { baseHarness: v.baseHarness as CustomHarnessProfile["baseHarness"] } : {}) };
}
export function harnessProfilesPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.VDT_HARNESS_CONFIG ? path.resolve(env.VDT_HARNESS_CONFIG) : path.join(homedir(), ".vdt-studio", "harnesses.json");
}
export function readHarnessProfiles(env: NodeJS.ProcessEnv = process.env): CustomHarnessProfile[] {
  const file = harnessProfilesPath(env);
  if (!existsSync(file)) return [];
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || lstatSync(file).size > 256 * 1024) throw fail("Harness configuration must be a bounded regular file.");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { version?: number; profiles?: unknown[] };
  if (parsed.version !== 1 || !Array.isArray(parsed.profiles) || parsed.profiles.length > 64) throw fail("Unsupported harness configuration version or size.");
  const profiles = parsed.profiles.map(validateHarnessProfile);
  if (new Set(profiles.map(p => p.id)).size !== profiles.length) throw fail("Duplicate custom harness ID.");
  return profiles;
}
export function profileDefinition(p: CustomHarnessProfile): HarnessDefinition {
  return Object.freeze({ ...p, args: Object.freeze([...p.args]), environmentRefs: Object.freeze({ ...p.environmentRefs }), backendId: `${p.id}_subscription`, custom: true,
    docsUrl: "", installHint: "Install and authenticate your adapter outside VDT, then test this connection.", capabilities: Object.freeze({ agentSession: true, structuredCompletion: true, cancellation: true }) });
}
export function listHarnessDefinitions(env: NodeJS.ProcessEnv = process.env): readonly HarnessDefinition[] {
  return [...BUILTIN_HARNESSES, ...readHarnessProfiles(env).map(profileDefinition)];
}
export function getHarnessDefinition(id: string, env: NodeJS.ProcessEnv = process.env): HarnessDefinition | undefined {
  return listHarnessDefinitions(env).find(h => h.id === id || h.backendId === id);
}
export function harnessDefinitionVersion(h: HarnessDefinition): string {
  return createHash("sha256").update(JSON.stringify(h)).digest("hex");
}
let writer: Promise<unknown> = Promise.resolve();
export function updateHarnessProfiles(operation: { profile: unknown } | { removeId: HarnessId }, env: NodeJS.ProcessEnv = process.env): Promise<CustomHarnessProfile[]> {
  const run = writer.catch(() => {}).then(async () => {
    const current = readHarnessProfiles(env);
    let next: CustomHarnessProfile[];
    if ("profile" in operation) { const profile = validateHarnessProfile(operation.profile); next = [...current.filter(p => p.id !== profile.id), profile]; }
    else { if (!operation.removeId.startsWith("custom-")) throw fail("Built-in harnesses cannot be deleted."); next = current.filter(p => p.id !== operation.removeId); }
    if (next.length > 64) throw fail("At most 64 custom systems can be saved.");
    const serialized = JSON.stringify({ version: 1, profiles: next }, null, 2) + "\n";
    if (Buffer.byteLength(serialized) > 256 * 1024) throw fail("Harness configuration exceeds 256 KiB.");
    const file = harnessProfilesPath(env), dir = path.dirname(file);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (lstatSync(dir).isSymbolicLink()) throw fail("Harness configuration directory cannot be a symbolic link.");
    const temp = path.join(dir, `.harnesses-${randomUUID()}.tmp`);
    try { await writeFile(temp, serialized, { mode: 0o600, flag: "wx" }); await rename(temp, file); await chmod(file, 0o600); }
    finally { await rm(temp, { force: true }); }
    return next;
  });
  writer = run;
  return run;
}
