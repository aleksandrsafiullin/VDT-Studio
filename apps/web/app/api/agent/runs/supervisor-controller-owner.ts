import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { getWindowsSupervisorIdentity } from "@vdt-studio/storage";

/** Internal SQLite fence metadata. Never return machine/boot identities to a
 * client or accept them from a model/request. This is death evidence, not a
 * renewable execution lease and not general cross-host recovery authority. */
export interface SupervisorProcessOwner {
  version: 1 | 2;
  machine: string;
  boot: string;
  pid: number;
  instance: string;
}

export type SupervisorOwnerDeath = "dead" | "alive" | "unverified";
const PREFIX = "agent-process-owner:";
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const processGlobal = globalThis as typeof globalThis & { __vdtSupervisorProcessInstance?: string };
const processInstance = processGlobal.__vdtSupervisorProcessInstance ??= randomUUID();
let cachedIdentity: Pick<SupervisorProcessOwner, "version" | "machine" | "boot"> | null | undefined;

export function supervisorProcessOwner(): SupervisorProcessOwner | null {
  // Only the cheap Windows getter can become available after admission.
  if (cachedIdentity === undefined || (cachedIdentity === null && process.platform === "win32")) {
    cachedIdentity = readLocalIdentity();
  }
  return cachedIdentity ? { ...cachedIdentity, pid: process.pid, instance: processInstance } : null;
}

export function supervisorControllerFenceToken(): string {
  const owner = supervisorProcessOwner();
  // An unavailable OS identity must never manufacture positive recovery proof.
  return owner ? encodeSupervisorProcessOwner(owner) : `agent-fence:${randomUUID()}`;
}

export function encodeSupervisorProcessOwner(owner: SupervisorProcessOwner): string {
  if (!validOwner(owner)) throw new TypeError("Invalid Supervisor process owner.");
  // Every bounded write retains a distinct audit token; owner identity remains
  // stable across route modules and development reloads within this process.
  return PREFIX + `v${owner.version}:` + ownerPayload(owner) + ":" + randomUUID();
}

export function supervisorFenceOwnership(token: string, current: SupervisorProcessOwner | null = supervisorProcessOwner()): "owned" | "foreign" | "unverified" {
  const owner = decodeOwner(token);
  if (!owner) return /^agent-fence:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(token)
    ? "unverified" : "foreign";
  if (!current || !validOwner(current)) return "foreign";
  return owner.version === current.version && owner.machine === current.machine && owner.boot === current.boot && owner.pid === current.pid && owner.instance === current.instance
    ? "owned" : "foreign";
}

export function supervisorOwnerDeath(
  token: string,
  current: SupervisorProcessOwner | null = supervisorProcessOwner(),
  probe: (pid: number) => void = (pid) => { process.kill(pid, 0); }
): SupervisorOwnerDeath {
  const owner = decodeOwner(token);
  if (!owner || !current || !validOwner(current) || owner.version !== current.version || owner.machine !== current.machine) return "unverified";
  if (owner.boot !== current.boot) return "dead";
  try {
    probe(owner.pid);
    return "alive";
  } catch (error) {
    // EPERM, a missing probe, a malformed PID, and all unexpected failures are
    // unknown ownership. A random instance token does not prove process death.
    return error && typeof error === "object" && "code" in error && error.code === "ESRCH"
      ? "dead" : "unverified";
  }
}

function decodeOwner(token: string): SupervisorProcessOwner | null {
  if (!token.startsWith(PREFIX) || token.length > 1_024) return null;
  try {
    const [scheme, raw, nonce, extra] = token.slice(PREFIX.length).split(":");
    if (!raw || !nonce || extra !== undefined || !UUID.test(nonce) || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return validOwner(value) && scheme === `v${value.version}` && ownerPayload(value) === raw ? value : null;
  } catch { return null; }
}

function ownerPayload(owner: SupervisorProcessOwner): string { return Buffer.from(JSON.stringify(owner)).toString("base64url"); }

function validOwner(value: unknown): value is SupervisorProcessOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const owner = value as Record<string, unknown>;
  return Object.keys(owner).sort().join(",") === "boot,instance,machine,pid,version"
    && (owner.version === 1 || owner.version === 2) && typeof owner.machine === "string" && HASH.test(owner.machine)
    && typeof owner.boot === "string" && HASH.test(owner.boot)
    && typeof owner.pid === "number" && Number.isSafeInteger(owner.pid) && owner.pid > 0 && owner.pid <= 0x7fffffff
    && typeof owner.instance === "string" && UUID.test(owner.instance);
}

function readLocalIdentity(): Pick<SupervisorProcessOwner, "version" | "machine" | "boot"> | null {
  try {
    let machine: string, boot: string;
    if (process.platform === "darwin") {
      const hardware = fixedCommand("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
      machine = /"IOPlatformUUID"\s*=\s*"([a-f0-9-]+)"/i.exec(hardware)?.[1] ?? "";
      boot = fixedCommand("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"]).trim();
      if (!UUID.test(machine) || !UUID.test(boot)) return null;
    } else if (process.platform === "linux") {
      machine = readFileSync("/etc/machine-id", "utf8").trim();
      boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      if (!/^[a-f0-9]{32}$/i.test(machine) || !UUID.test(boot)) return null;
      const namespace = readlinkSync("/proc/self/ns/pid");
      if (!/^pid:\[\d+\]$/.test(namespace)) return null;
      // kill(pid, 0) cannot prove another PID namespace empty. A namespace
      // change (including some Linux reboot/container cases) fails closed.
      machine += `:${namespace}`;
    } else if (process.platform === "win32") {
      const native = getWindowsSupervisorIdentity();
      if (!native || !UUID.test(native.machineGuid) || !UUID.test(native.bootGuid)
        || native.machineGuid === NIL_UUID || native.bootGuid === NIL_UUID) return null;
      return {
        version: 2,
        machine: hash(`machine:win32:${native.machineGuid.toLowerCase()}`),
        boot: hash(`boot:win32:native-guid:${native.bootGuid.toLowerCase()}`)
      };
    } else return null;
    return { version: 1, machine: hash(`machine:${process.platform}:${machine.toLowerCase()}`), boot: hash(`boot:${process.platform}:${boot.toLowerCase()}`) };
  } catch { return null; }
}

function fixedCommand(executable: string, args: string[]): string {
  return execFileSync(executable, args, { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1_024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
