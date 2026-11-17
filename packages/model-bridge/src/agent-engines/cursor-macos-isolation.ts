import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { release } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CursorCheckpointIsolationIdentity,
  CursorCheckpointIsolationRunner
} from "./cursor-resume-checkpoint-engine";
import { assertCursorCheckpointVendorConfig, cursorCheckpointVendorPolicyHash } from "./cursor-checkpoint-vendor-policy";
import type { CursorResumeProcessRequest, CursorResumeProcessResult } from "./cursor-resume-checkpoint-transport";

const execFileAsync = promisify(execFile);
const seatbelt = "/usr/bin/sandbox-exec";
const systemReads = ["/System/Library", "/usr/lib", "/usr/share"];
const systemMetadata = ["/dev", "/usr", "/private/etc", "/private", "/Library"];
const vendorSandboxMode = "disabled";
const vendorPolicyHash = cursorCheckpointVendorPolicyHash(vendorSandboxMode);

/** The pinned Cursor CLI resolves its persistent-session lock root with a
 * literal /tmp path. Adapt that one namespace to its real SSD-backed state.
 * Seatbelt continues to deny all underlying access to system /tmp. */
export function buildMacCursorPrivatePersistenceImport(state: string): string {
  const destination = path.join(state, "tmp", "cursor-persistence");
  const source = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";

    const logicalRoot = "/tmp/cursor-agent-persist-" + process.getuid();
    const physicalRoot = ${JSON.stringify(destination)};
    function privatePath(value) {
      if (typeof value !== "string") return value;
      if (value === logicalRoot) return physicalRoot;
      if (!value.startsWith(logicalRoot + "/")) return value;
      const relative = value.slice(logicalRoot.length + 1);
      if (relative.includes("\\0") || relative.split("/").some(part => part === "" || part === "." || part === "..")) {
        throw Object.assign(new Error("Invalid Cursor persistent-session path."), { code: "EINVAL" });
      }
      return physicalRoot + "/" + relative;
    }

    for (const name of ["chmodSync", "existsSync", "lstatSync", "mkdirSync", "readFileSync",
      "readdirSync", "rmSync", "statSync", "unlinkSync", "writeFileSync"]) {
      const original = fs[name];
      fs[name] = function (file, ...args) {
        return original.call(this, privatePath(file), ...args);
      };
    }
    for (const name of ["linkSync", "renameSync"]) {
      const original = fs[name];
      fs[name] = function (source, destination, ...args) {
        return original.call(this, privatePath(source), privatePath(destination), ...args);
      };
    }
    const realpath = fs.realpathSync;
    fs.realpathSync = function (file, ...args) {
      return realpath.call(this, privatePath(file), ...args);
    };
    fs.realpathSync.native = function (file, ...args) {
      return realpath.native.call(this, privatePath(file), ...args);
    };
    syncBuiltinESMExports();
  `;
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

interface MacCursorIsolationOptions {
  readonly executable: string;
  readonly payloadMount: string;
  readonly supervisorExecutable: string;
  readonly privateRoot: string;
  readonly egressPort: number;
  readonly egressPolicyHash: string;
  readonly modelId: string;
  readonly dedicatedOAuthFile: string;
}

function boundary(message: string, code = "CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT"): Error {
  return Object.assign(new Error(message), { code });
}

function literal(value: string): string {
  if (/[\x00-\x1f\x7f]/.test(value)) throw boundary("The Seatbelt policy path contains a control character.");
  return `(literal ${JSON.stringify(value)})`;
}

function subpath(value: string): string {
  literal(value);
  return `(subpath ${JSON.stringify(value)})`;
}

export function buildMacCursorSeatbeltPolicy(payload: string, workspace: string, state: string, port: number): string {
  const metadata = new Set(systemMetadata);
  for (const root of [payload, workspace, state]) {
    let ancestor = path.dirname(root);
    while (!metadata.has(ancestor)) {
      metadata.add(ancestor);
      ancestor = path.dirname(ancestor);
    }
  }
  return [
    "(version 1)",
    "(deny default)",
    `(allow process-exec ${literal(path.join(payload, "node"))})`,
    `(allow file-read-metadata ${[...metadata].sort().map(literal).join(" ")})`,
    '(allow file-read-data (literal "/"))',
    `(allow file-read* ${[...systemReads, payload, workspace, state].map(subpath).join(" ")} ${["/dev/null", "/dev/random", "/dev/urandom"].map(literal).join(" ")})`,
    `(allow file-write* ${subpath(state)})`,
    "(allow sysctl-read)",
    "(allow signal (target self))",
    `(allow network-outbound (remote tcp "localhost:${port}"))`
  ].join("\n");
}

export function buildMacCursorProcessEnvironment(state: string, port: number): Record<string, string> {
  const proxy = `http://127.0.0.1:${port}`;
  const temporaryDirectory = path.join(state, "tmp");
  // Cursor's short Unix-socket directory falls back to system /tmp above
  // this limit. Stop before launch if the private path cannot be used.
  if (Buffer.byteLength(path.join(temporaryDirectory, ".cursor")) > 83) {
    throw boundary("The private Cursor state path is too long for its confined Unix-socket directory.");
  }
  return {
    PATH: "/usr/bin:/bin",
    HOME: state,
    USERPROFILE: state,
    CURSOR_CONFIG_DIR: path.join(state, "cursor-config"),
    XDG_CONFIG_HOME: path.join(state, "xdg-config"),
    XDG_STATE_HOME: path.join(state, "xdg-state"),
    XDG_CACHE_HOME: path.join(state, "xdg-cache"),
    TMPDIR: temporaryDirectory,
    NODE_DISABLE_COMPILE_CACHE: "1",
    AGENT_CLI_CREDENTIAL_STORE: "file",
    CURSOR_INVOKED_AS: "cursor-agent",
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    NODE_USE_ENV_PROXY: "1"
  };
}

function digest(bytes: string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function digestFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifiedCodeDirectory(executable: string): Promise<{ cdHash: string; team: string; identifier: string }> {
  const options = { timeout: 5_000, maxBuffer: 16 * 1024, env: {} };
  try {
    await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", executable], options);
    const { stderr } = await execFileAsync("/usr/bin/codesign", ["--display", "--verbose=4", executable], options);
    const cdHash = /^CDHash=([a-fA-F0-9]{40,64})$/m.exec(stderr)?.[1]?.toLowerCase();
    const team = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(stderr)?.[1];
    const identifier = /^Identifier=([^\r\n]+)$/m.exec(stderr)?.[1];
    if (cdHash && team && identifier === "com.vdtstudio.desktop.cursor-supervisor"
      && /^(?:Authority=Developer ID Application: .+)$/m.test(stderr)) {
      return { cdHash, team, identifier };
    }
  } catch {
    // A missing or invalid signature is handled as a qualification mismatch.
  }
  throw boundary("The Cursor macOS supervisor lacks its expected Developer ID code signature.");
}

async function digestPayload(root: string, device: number): Promise<string> {
  const entries: string[] = [];
  async function visit(relative: string): Promise<void> {
    const directory = path.join(root, relative);
    const names = (await readdir(directory)).sort();
    for (const name of names) {
      const child = path.join(relative, name);
      const absolute = path.join(root, child);
      const info = await lstat(absolute);
      if (info.dev !== device) throw boundary("The read-only Cursor payload contains a nested mount.");
      const mode = info.mode & 0o777;
      if (info.isDirectory()) {
        entries.push(JSON.stringify(["directory", child, mode]));
        await visit(child);
      } else if (info.isFile()) {
        entries.push(JSON.stringify(["file", child, mode, await digestFile(absolute)]));
      } else {
        throw boundary("The read-only Cursor payload contains an unsupported filesystem entry.");
      }
    }
  }
  await visit("");
  return digest(entries.join("\n"));
}

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function ownedDirectory(directory: string): Promise<void> {
  if (!path.isAbsolute(directory) || await realpath(directory) !== directory) {
    throw boundary("The Cursor private directory is not canonical.");
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
    throw boundary("The Cursor private directory must be owned by the desktop account and mode 0700.");
  }
}

const maxAuthBytes = 64 * 1024;

async function readDedicatedAuthFile(file: string): Promise<Buffer> {
  if (await realpath(file) !== file) throw boundary("The dedicated Cursor OAuth file is not canonical.");
  await ownedDirectory(path.dirname(file));
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o600
      || metadata.size === 0 || metadata.size > maxAuthBytes) {
      throw boundary("The dedicated Cursor OAuth file does not satisfy the private ownership and size policy.");
    }
    const bytes = Buffer.alloc(metadata.size + 1);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead !== metadata.size) throw boundary("The dedicated Cursor OAuth file changed while being read.");
    return bytes.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

function authValues(auth: Buffer): readonly string[] {
  const values: string[] = [];
  function visit(value: unknown) {
    if (typeof value === "string" && value.length >= 16) values.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  }
  try {
    visit(JSON.parse(auth.toString("utf8")) as unknown);
  } catch {
    throw boundary("The dedicated Cursor OAuth file does not contain valid JSON.");
  }
  return values;
}

async function verifyMount(options: MacCursorIsolationOptions): Promise<void> {
  await execFileAsync(options.supervisorExecutable, ["--check-readonly-mount", options.payloadMount], {
    timeout: 3_000,
    maxBuffer: 1_024,
    env: {}
  }).catch(() => { throw boundary("The Cursor vendor payload is not on the required read-only macOS mount."); });
}

async function runSupervised(
  supervisor: string,
  args: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>>,
  request: Pick<CursorResumeProcessRequest, "signal" | "timeoutMs" | "maxOutputBytes" | "stdin">
): Promise<CursorResumeProcessResult> {
  request.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(supervisor, args, { cwd, env: environment, stdio: "pipe", shell: false });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    function stop(error: Error) {
      failure ??= error;
      child.kill("SIGTERM");
    }
    function collect(target: Buffer[], chunk: Buffer) {
      if (failure) return;
      bytes += chunk.byteLength;
      if (bytes > request.maxOutputBytes) {
        stop(boundary("Cursor exceeded its bounded output limit.", "CURSOR_CHECKPOINT_OUTPUT_TOO_LARGE"));
        return;
      }
      target.push(chunk);
    }
    const abort = () => stop(boundary("Cursor was cancelled.", "CURSOR_CHECKPOINT_CANCELLED"));
    const deadline = setTimeout(
      () => stop(boundary("Cursor exceeded its deadline.", "CURSOR_CHECKPOINT_TIMEOUT")),
      request.timeoutMs
    );
    request.signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", () => stop(boundary("The macOS Cursor supervisor could not run.", "CURSOR_CHECKPOINT_PROCESS_ERROR")));
    child.stdin.on("error", () => stop(boundary("The Cursor process closed its input.", "CURSOR_CHECKPOINT_WRITE_FAILED")));
    child.on("close", (exitCode, signal) => {
      clearTimeout(deadline);
      request.signal.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else resolve({ exitCode, signal, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() });
    });
    child.stdin.end(request.stdin);
  });
}

/** Creates a dormant launcher. The packaged host separately admits reviewed exact-release evidence. */
export function createMacCursorIsolationRunner(options: MacCursorIsolationOptions): CursorCheckpointIsolationRunner {
  if (process.platform !== "darwin" || process.arch !== "arm64"
    || ![options.executable, options.payloadMount, options.supervisorExecutable, options.privateRoot, options.dedicatedOAuthFile].every((item) => path.isAbsolute(item))
    || !Number.isInteger(options.egressPort) || options.egressPort < 1024 || options.egressPort > 65535
    || !/^sha256:[a-f0-9]{64}$/.test(options.egressPolicyHash)
    || !/^grok-[a-z0-9.-]+$/.test(options.modelId)) {
    throw boundary("The host supplied an invalid macOS Cursor isolation configuration.");
  }
  const settings = Object.freeze({ ...options });
  const payload = path.dirname(settings.executable);
  async function fingerprint(executable: string, device: number) {
    if (executable !== settings.executable || !contains(settings.payloadMount, payload)
      || await realpath(executable) !== executable || await realpath(settings.payloadMount) !== settings.payloadMount
      || await realpath(settings.supervisorExecutable) !== settings.supervisorExecutable) {
      throw boundary("The Cursor supervisor or vendor payload did not match its registered location.");
    }
    await verifyMount(settings);
    const [payloadHash, supervisorCode, seatbeltHash] = await Promise.all([
      digestPayload(payload, device),
      verifiedCodeDirectory(settings.supervisorExecutable),
      digestFile(seatbelt)
    ]);
    const policyHash = digest(JSON.stringify({
      rules: buildMacCursorSeatbeltPolicy("/payload", "/workspace", "/state", 1024),
      environment: buildMacCursorProcessEnvironment("/state", 1024),
      privatePersistenceImport: buildMacCursorPrivatePersistenceImport("/state"),
      supervisorCode,
      seatbeltHash,
      kernel: release(),
      brokerPolicyHash: settings.egressPolicyHash,
      modelId: settings.modelId,
      authPolicy: "explicit-dedicated-mode-0600-json-to-per-run-state-v1"
    }));
    return { payloadHash, policyHash, vendorPolicyHash };
  }
  async function launch(
    cwd: string,
    state: string,
    args: readonly string[],
    limits: Pick<CursorResumeProcessRequest, "signal" | "timeoutMs" | "maxOutputBytes" | "stdin">
  ) {
    const temp = path.join(state, "tmp");
    await mkdir(temp, { mode: 0o700, recursive: true });
    await ownedDirectory(temp);
    return runSupervised(settings.supervisorExecutable, [
      "--run", settings.payloadMount,
      buildMacCursorSeatbeltPolicy(payload, cwd, state, settings.egressPort),
      path.join(payload, "node"), "--import", buildMacCursorPrivatePersistenceImport(state),
      path.join(payload, "index.js"), ...args
    ], cwd, buildMacCursorProcessEnvironment(state, settings.egressPort), limits);
  }

  return {
    async measureIdentity(executable) {
      await ownedDirectory(settings.privateRoot);
      const mount = await open(settings.payloadMount, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        const identity = await fingerprint(executable, (await mount.stat()).dev);
        const scratch = await mkdtemp(path.join(settings.privateRoot, "version-"));
        try {
          const result = await launch(scratch, scratch, ["--version"], {
            signal: AbortSignal.timeout(10_000), timeoutMs: 10_000, maxOutputBytes: 4_096, stdin: ""
          });
          const cliVersion = result.stdout.trim();
          if (result.exitCode !== 0 || !/^\d{4}\.\d{2}\.\d{2}-[a-f0-9]+$/.test(cliVersion)) {
            throw boundary("Cursor could not confirm its exact vendor CLI version.");
          }
          return { ...identity, cliVersion };
        } finally {
          await rm(scratch, { recursive: true, force: true });
        }
      } finally {
        await mount.close();
      }
    },
    async runQualified(request, identity: CursorCheckpointIsolationIdentity) {
      const state = request.environment.HOME;
      if (!state || !contains(settings.privateRoot, state) || !contains(settings.privateRoot, request.cwd)
        || contains(state, request.cwd) || contains(request.cwd, state)) {
        throw boundary("Cursor checkpoint paths escaped the private macOS scope.");
      }
      await Promise.all([ownedDirectory(settings.privateRoot), ownedDirectory(state), ownedDirectory(request.cwd)]);
      const required = ["--print", "--output-format", "stream-json", "--stream-partial-output", "--mode", "ask",
        "--workspace", request.cwd, "--trust", "--model", settings.modelId];
      const resume = request.args.slice(required.length);
      if (!required.every((arg, index) => request.args[index] === arg)
        || !(resume.length === 0 || resume.length === 2 && resume[0] === "--resume" && /^[A-Za-z0-9_.:-]{1,512}$/.test(resume[1] ?? ""))) {
        throw boundary("Cursor checkpoint launch arguments did not match the approved Grok policy.");
      }
      const mount = await open(settings.payloadMount, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        const current = await fingerprint(request.executable, (await mount.stat()).dev);
        if (current.payloadHash !== identity.payloadHash || current.policyHash !== identity.policyHash
          || current.vendorPolicyHash !== identity.vendorPolicyHash) {
          throw boundary("The Cursor vendor payload or macOS policy changed before launch.", "CURSOR_CHECKPOINT_QUALIFICATION_MISMATCH");
        }
        const credentialsDirectory = path.join(state, ".cursor");
        const authFile = path.join(credentialsDirectory, "auth.json");
        if (resume.length === 0) {
          await mkdir(credentialsDirectory, { mode: 0o700 });
          const source = await readDedicatedAuthFile(settings.dedicatedOAuthFile);
          try {
            await writeFile(authFile, source, { mode: 0o600, flag: "wx" });
          } finally {
            source.fill(0);
          }
        }
        await assertCursorCheckpointVendorConfig(request, identity.vendorPolicyHash);
        const authBefore = await readDedicatedAuthFile(authFile);
        const authAfter = await launch(request.cwd, state, [...request.args, "--sandbox", vendorSandboxMode], request)
          .then(async (result) => ({ result, bytes: await readDedicatedAuthFile(authFile) }))
          .catch((error: unknown) => { authBefore.fill(0); throw error; });
        try {
          const output = `${authAfter.result.stdout}\n${authAfter.result.stderr}`;
          if ([...authValues(authBefore), ...authValues(authAfter.bytes)].some((value) => output.includes(value))) {
            throw boundary("Cursor checkpoint output contained private OAuth data.", "SECURITY_BOUNDARY_BREACH");
          }
          return authAfter.result;
        } finally {
          authBefore.fill(0);
          authAfter.bytes.fill(0);
        }
      } finally {
        await mount.close();
      }
    }
  };
}
