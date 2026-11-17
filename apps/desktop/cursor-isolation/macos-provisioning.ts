import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, realpath, rename, rm, statfs } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
  assertMacCursorDedicatedAuth, buildMacCursorProcessEnvironment, measureMacCursorPayload
} from "../../../packages/model-bridge/src/agent-engines/cursor-macos-isolation";

const diskImages = "/usr/bin/hdiutil";
const versionPattern = /^\d{4}\.\d{2}\.\d{2}-[a-f0-9]{7,40}$/;
export type MacCursorAuthStatus = "ready" | "not_installed" | "sign_in_required" | "unsupported";

function fail(message: string, code = "CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT"): Error {
  return Object.assign(new Error(message), { code });
}

export async function assertMacCursorPrivateDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (!path.isAbsolute(directory) || await realpath(directory) !== directory || !info.isDirectory()
    || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700) {
    throw fail("The Cursor profile directory is not private.");
  }
}

async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700 }).catch(error => {
    if (error.code !== "EEXIST") throw error;
  });
  await assertMacCursorPrivateDirectory(directory);
}

async function assertOwnedInstallDirectory(directory: string): Promise<number> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o022) !== 0
    || await realpath(directory) !== directory) {
    throw fail("The Cursor install is outside its official per-user location.");
  }
  return info.dev;
}

export async function discoverMacCursorPayload(home: string): Promise<{ source: string; version: string; device: number }> {
  const launcher = path.join(home, ".local", "bin", "cursor-agent");
  const info = await lstat(launcher).catch(error => {
    if (error.code === "ENOENT") throw fail("Install the official Cursor Agent CLI to connect.", "CURSOR_NOT_INSTALLED");
    throw error;
  });
  await assertOwnedInstallDirectory(path.dirname(launcher));
  const versions = path.join(home, ".local", "share", "cursor-agent", "versions");
  if (!info.isSymbolicLink() || info.uid !== process.getuid?.()) {
    throw fail("The Cursor launcher does not match the official install.");
  }
  const executable = await realpath(launcher);
  const source = path.dirname(executable);
  const version = path.basename(source);
  if (path.dirname(source) !== versions || path.basename(executable) !== "cursor-agent" || !versionPattern.test(version)) {
    throw fail("The Cursor launcher does not point to an official version directory.");
  }
  const device = await assertOwnedInstallDirectory(source);
  const executableInfo = await lstat(executable);
  if (!executableInfo.isFile() || executableInfo.uid !== process.getuid?.() || (executableInfo.mode & 0o022) !== 0) {
    throw fail("The Cursor launcher is not owned by the desktop account.");
  }
  return { source, version, device };
}

async function diskImage(args: readonly string[], timeout = 120_000, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(diskImages, args, { env: {}, stdio: ["ignore", "pipe", "pipe"], shell: false });
    const output: Buffer[] = [];
    let bytes = 0;
    let interrupted = false;
    let failed = false;
    function stop() {
      interrupted = true;
      child.kill("SIGKILL");
    }
    function collect(chunk: Buffer, stdout: boolean) {
      bytes += chunk.byteLength;
      if (bytes > 32 * 1024) stop();
      else if (stdout) output.push(chunk);
    }
    const deadline = setTimeout(stop, timeout);
    signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
    child.on("error", () => { failed = true; });
    child.on("close", (code, exitSignal) => {
      clearTimeout(deadline);
      signal?.removeEventListener("abort", stop);
      if (!failed && !interrupted && code === 0) {
        resolve(Buffer.concat(output).toString("utf8"));
      } else {
        reject(fail("macOS could not prepare the read-only Cursor payload.",
          interrupted || exitSignal ? "CURSOR_IMAGE_CLEANUP_UNCONFIRMED" : "CURSOR_IMAGE_FAILED"));
      }
    });
    if (signal?.aborted) stop();
  });
}

export interface MacCursorProvisionedProfile {
  readonly privateRoot: string;
  readonly payloadMount: string;
  readonly dedicatedOAuthFile: string;
  verifyOfficialIdentity(deep?: boolean): Promise<void>;
  checkAuth(): Promise<MacCursorAuthStatus>;
  signIn(): Promise<void>;
  dispose(): Promise<void>;
}

export async function provisionMacCursorProfile(
  appData: string, evidence: { readonly cliVersion: string; readonly payloadHash: string }, signal?: AbortSignal
): Promise<MacCursorProvisionedProfile> {
  signal?.throwIfAborted();
  const home = userInfo().homedir;
  const install = await discoverMacCursorPayload(home);
  if (install.version !== evidence.cliVersion) throw fail("This Cursor Agent CLI version is outside the reviewed release.");
  const source = await measureMacCursorPayload(install.source, install.device);
  if (source.payloadHash !== evidence.payloadHash) throw fail("The local Cursor CLI payload is not qualified.");
  if (!path.isAbsolute(appData)) throw fail("The native Cursor app-data directory is unavailable.");
  const data = await realpath(appData);
  await assertOwnedInstallDirectory(data);
  const authRoot = path.join(data, "cursor-isolation");
  await privateDirectory(authRoot);
  const dedicatedOAuthFile = path.join(authRoot, "auth.json");

  // Use the app-data volume for the payload and keep run state short enough
  // for Cursor's Unix sockets. The ordinary system volume provides /private/tmp.
  const externalVolume = /^\/Volumes\/[^/]+/.exec(data)?.[0];
  const scratchBase = externalVolume ?? "/private/tmp";
  const space = await statfs(scratchBase, { bigint: true });
  // The snapshot and image briefly coexist while DiskImages creates the filesystem.
  const requiredBytes = 2n * BigInt(source.bytes) + 32n * 1024n ** 2n;
  if (space.bavail * space.bsize < requiredBytes) throw fail("There is not enough space to prepare the isolated Cursor payload.");
  const privateRoot = await mkdtemp(path.join(scratchBase, ".vdt-c-"));
  const volumeName = `vdt-cursor-${randomUUID()}`;
  const payloadMount = path.join("/Volumes", volumeName);
  const staging = path.join(privateRoot, "source");
  const image = path.join(privateRoot, "payload.dmg");
  let mountAttempted = false;
  let diskImageOwnershipUnconfirmed = false;
  let attachedVolume: string | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  let authentication: Promise<void> | undefined;
  let authController: AbortController | undefined;
  let loginCleanupUnconfirmed = false;

  async function dispose() {
    disposed = true;
    authController?.abort();
    disposal ??= (async () => {
      if (authentication) await Promise.allSettled([authentication]);
      if (diskImageOwnershipUnconfirmed || loginCleanupUnconfirmed) {
        throw fail("The Cursor payload cleanup could not be reconciled.");
      }
      if (mountAttempted) {
        // If unmount cannot be confirmed, preserve the directory and disk image.
        if (!attachedVolume) throw fail("The Cursor image attachment could not be reconciled.");
        await diskImage(["detach", attachedVolume], 5_000);
      }
      await assertMacCursorPrivateDirectory(privateRoot);
      await rm(privateRoot, { recursive: true });
    })();
    return disposal;
  }

  async function verifyOfficialIdentity(deep = false) {
    if (disposed) throw fail("Cursor isolation is shutting down.");
    const current = await discoverMacCursorPayload(home);
    if (current.source !== install.source || current.device !== install.device
      || (deep && (await measureMacCursorPayload(current.source, current.device)).payloadHash !== evidence.payloadHash)) {
      throw fail("The official Cursor Agent CLI changed. Reopen VDT Studio after installing a reviewed version.");
    }
  }

  try {
    await assertMacCursorPrivateDirectory(privateRoot);
    buildMacCursorProcessEnvironment(path.join(privateRoot, `m-${"0".repeat(32)}`, "s"), 1024);
    signal?.throwIfAborted();
    await cp(install.source, staging, { recursive: true, errorOnExist: true, force: false });
    signal?.throwIfAborted();
    if ((await measureMacCursorPayload(staging, (await lstat(staging)).dev)).payloadHash !== evidence.payloadHash) {
      throw fail("The local Cursor payload changed while it was being prepared.");
    }
    await diskImage(["create", "-srcfolder", staging, "-format", "UDRO", "-fs", "HFS+", "-volname", volumeName, image], 120_000, signal);
    await rm(staging, { recursive: true });
    signal?.throwIfAborted();
    mountAttempted = true;
    const attach = await diskImage(["attach", "-readonly", "-nobrowse", "-noautoopen", image], 120_000, signal);
    const mount = attach.split("\n").map(line => line.split("\t").map(field => field.trim()))
      .find(([device, filesystem, mountpoint]) =>
        /^\/dev\/disk\d+s\d+$/.test(device ?? "") && filesystem === "Apple_HFS" && mountpoint?.startsWith("/Volumes/"));
    attachedVolume = mount?.[2];
    if (attachedVolume !== payloadMount) throw fail("The Cursor disk image did not mount at its owned location.");
    if (await realpath(payloadMount) !== payloadMount
      || (await measureMacCursorPayload(payloadMount, (await lstat(payloadMount)).dev)).payloadHash !== evidence.payloadHash) {
      throw fail("The mounted local Cursor payload does not match the reviewed identity.");
    }
  } catch (error) {
    diskImageOwnershipUnconfirmed = (error as NodeJS.ErrnoException).code === "CURSOR_IMAGE_CLEANUP_UNCONFIRMED";
    await dispose().catch(() => {
      console.error("Cursor could not confirm macOS payload cleanup. Its owned staging directory was retained.");
    });
    throw error;
  }

  return {
    privateRoot, payloadMount, dedicatedOAuthFile, verifyOfficialIdentity,
    async checkAuth() {
      try {
        await assertMacCursorDedicatedAuth(dedicatedOAuthFile);
        return "ready";
      } catch {
        return "sign_in_required";
      }
    },
    async signIn() {
      if (disposed) throw fail("Cursor isolation is shutting down.");
      if (authentication) return authentication;
      if (loginCleanupUnconfirmed) throw fail("Cursor could not confirm cleanup of the previous sign-in.");
      authController = new AbortController();
      const signInSignal = signal ? AbortSignal.any([authController.signal, signal]) : authController.signal;
      authentication = (async () => {
        await verifyOfficialIdentity(true);
        await assertMacCursorPrivateDirectory(authRoot);
        const loginHome = await mkdtemp(path.join(authRoot, ".login-"));
        let cleanupUnconfirmed = false;
        try {
          await assertMacCursorPrivateDirectory(loginHome);
          const env = {
            HOME: loginHome, USERPROFILE: loginHome, PATH: "/usr/bin:/bin",
            XDG_CONFIG_HOME: path.join(loginHome, "xdg-config"),
            XDG_STATE_HOME: path.join(loginHome, "xdg-state"),
            XDG_CACHE_HOME: path.join(loginHome, "xdg-cache"),
            CURSOR_CONFIG_DIR: path.join(loginHome, "cursor-config"),
            TMPDIR: path.join(loginHome, "tmp"),
            NODE_DISABLE_COMPILE_CACHE: "1",
            AGENT_CLI_CREDENTIAL_STORE: "file", CURSOR_INVOKED_AS: "cursor-agent",
            TERM: "dumb"
          };
          await mkdir(env.TMPDIR, { mode: 0o700 });
          await runMacCursorLogin(payloadMount, loginHome, env, signInSignal);
          const credentialDirectory = path.join(loginHome, ".cursor");
          const credential = path.join(credentialDirectory, "auth.json");
          await assertMacCursorPrivateDirectory(credentialDirectory);
          await assertMacCursorDedicatedAuth(credential);
          signInSignal.throwIfAborted();
          await assertMacCursorPrivateDirectory(authRoot);
          await rename(credential, dedicatedOAuthFile);
        } catch (error) {
          cleanupUnconfirmed = (error as NodeJS.ErrnoException).code === "CURSOR_LOGIN_CLEANUP_UNCONFIRMED";
          if (cleanupUnconfirmed) loginCleanupUnconfirmed = true;
          if (cleanupUnconfirmed) console.error("Cursor could not confirm macOS sign-in process cleanup. Its private sign-in staging directory was retained.");
          throw error;
        } finally {
          if (!cleanupUnconfirmed) {
            await assertMacCursorPrivateDirectory(loginHome);
            await rm(loginHome, { recursive: true });
          }
        }
      })().catch(() => { throw fail("Cursor sign-in did not complete.", "CURSOR_SIGN_IN_FAILED"); })
        .finally(() => { authentication = undefined; authController = undefined; });
      return authentication;
    },
    dispose
  };
}

export async function stopMacCursorLoginGroup(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
  const deadline = performance.now() + 1_000;
  do {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
    await wait(20);
  } while (performance.now() < deadline);
  return false;
}

async function runMacCursorLogin(
  payload: string, cwd: string, env: Readonly<Record<string, string>>, signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const child = spawn(path.join(payload, "node"), [path.join(payload, "index.js"), "login"], {
      cwd, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"]
    });
    let outputBytes = 0;
    let finished = false;
    function finish(success: boolean) {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      const groupClosed = child.pid === undefined ? Promise.resolve(true) : stopMacCursorLoginGroup(child.pid);
      void groupClosed.then(closed => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        if (!closed) {
          reject(fail("Cursor could not confirm login process cleanup.", "CURSOR_LOGIN_CLEANUP_UNCONFIRMED"));
        } else if (!success || signal.aborted) {
          reject(fail("Cursor sign-in did not complete.", "CURSOR_SIGN_IN_FAILED"));
        } else {
          resolve();
        }
      });
    }
    function drain(chunk: Buffer) {
      outputBytes += chunk.byteLength;
      if (outputBytes > 64 * 1024) finish(false);
    }
    const abort = () => finish(false);
    const deadline = setTimeout(abort, 3 * 60_000);
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", drain);
    child.stderr.on("data", drain);
    child.on("error", abort);
    child.on("exit", (code, exitSignal) => finish(code === 0 && exitSignal === null));
    if (signal.aborted) abort();
  });
}
