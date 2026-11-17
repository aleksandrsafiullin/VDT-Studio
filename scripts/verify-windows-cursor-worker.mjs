import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync
} from "node:fs";
import path from "node:path";

const [directory, policyHash, ...extra] = process.argv.slice(2);
const sha256 = /^sha256:[a-f0-9]{64}$/;
if (process.platform !== "win32" || extra.length || !directory || !path.isAbsolute(directory) || !sha256.test(policyHash)) {
  throw new Error("Run on a disposable Windows build user with the absolute worker directory and expected policy hash.");
}

const worker = path.join(realpathSync(directory), "vdt-windows-cursor-worker.exe");
const preload = path.join(path.dirname(worker), "proxy-preload.cjs");
const local = realpathSync(process.env.LOCALAPPDATA);
const system = realpathSync(process.env.SystemRoot);
const sessionContainer = path.join(local, "VDT Cursor");
const sessionParent = path.join(sessionContainer, "Sessions");
const official = path.join(local, "cursor-agent");
const authDirectory = path.join(local, "VDT Studio", "Cursor Auth");
assert(!existsSync(official) && !existsSync(authDirectory),
  "The native smoke requires a disposable Windows account without a Cursor installation or VDT Cursor auth.");
const retainContainer = existsSync(sessionContainer);
const retainParent = existsSync(sessionParent);
const syntheticVersion = `2001.01.01-${randomBytes(6).toString("hex")}`;
const payloadRoot = path.join(official, "versions", syntheticVersion);
const version = 2;
const target = { version, cliVersion: syntheticVersion, payloadRoot };
const cleanups = [];

function samePath(a, b) {
  return typeof a === "string" && path.relative(b, a) === "";
}

function fileHash(file) {
  assert(lstatSync(file).isFile(), "The compiled worker resources must be regular files.");
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function call(frame, { close = false, localData = local } = {}) {
  const frames = close ? [frame, { op: "close" }] : [frame];
  const result = spawnSync(worker, [], {
    cwd: path.dirname(worker),
    env: { SystemRoot: system, WINDIR: system, LOCALAPPDATA: localData },
    input: frames.map(value => JSON.stringify(value) + "\n").join(""),
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 64 * 1024,
    windowsHide: true
  });
  if (result.error || !result.stdout || result.stderr || result.signal) {
    throw new Error(`The bounded Windows worker ${frame.op} command failed to produce a clean receipt.`);
  }
  const response = JSON.parse(result.stdout);
  assert.equal(response?.op, frame.op, "The worker response must match its request.");
  assert.equal(response?.id, frame.id, "The worker response must match its request ID.");
  return { exit: result.status, response };
}

function denied(frame, options) {
  const { exit, response } = call(frame, options);
  assert.equal(exit, 64, `The ${frame.op} fixture must be rejected.`);
  assert.equal(response.ok, false, "The worker accepted an unapproved fixture.");
  assert.equal(response.code, "CURSOR_CHECKPOINT_QUALIFICATION_MISMATCH");
}

function ownedDirectory(name) {
  mkdirSync(name);
  cleanups.push(() => rmdirSync(name));
}

function ownedFile(file, bytes) {
  writeFileSync(file, bytes, { flag: "wx" });
  cleanups.push(() => unlinkSync(file));
}

let receipt;
try {
  const injectedRoot = mkdtempSync(path.join(path.dirname(worker), "cursor-smoke-"));
  cleanups.push(() => rmdirSync(injectedRoot));
  const located = call({ op: "locate", version }, { localData: injectedRoot });
  assert.equal(located.exit, 0);
  assert.equal(located.response.ok, true);
  assert(samePath(located.response.localData, local), "The native worker trusted an injected LocalAppData path.");
  assert(samePath(located.response.systemRoot, system), "The native worker returned an unexpected Windows directory.");
  assert(samePath(located.response.privateRoot, sessionParent), "The worker reported an unexpected session parent.");

  assert.deepEqual(call({ op: "authStatus", version }), {
    exit: 0, response: { ok: true, op: "authStatus", ready: false }
  });
  denied({ ...target, op: "measure" });
  denied({ ...target, op: "measure", payloadRoot: injectedRoot }, { localData: injectedRoot });

  ownedDirectory(official);
  ownedDirectory(path.dirname(payloadRoot));
  ownedDirectory(payloadRoot);
  // These files are inert. A successful scope must stage them without ever executing vendor code.
  ownedFile(path.join(payloadRoot, "index.js"), "synthetic entrypoint\n");
  ownedFile(path.join(payloadRoot, "node.exe"), "synthetic executable\n");
  const files = ["index.js", "node.exe"].map(name => `${name}\0${fileHash(path.join(payloadRoot, name))}\n`);
  const payloadHash = `sha256:${createHash("sha256").update(files.join("")).digest("hex")}`;
  assert.deepEqual(call({ op: "measure", ...target }), { exit: 0, response: {
    ok: true, op: "measure", cliVersion: syntheticVersion, payloadHash, policyHash
  } });

  const open = { op: "open", ...target, payloadHash, policyHash, model: "grok-4.7-low", brokerPort: 1 };
  const wrongHash = "sha256:" + "0".repeat(64);
  denied({ ...open, payloadHash: wrongHash });
  denied({ ...open, policyHash: wrongHash });
  denied({ ...open, model: "auto" });
  denied({ op: "signIn", id: "wrong-auth-identity", ...target, payloadHash: wrongHash, policyHash });
  const { exit, response } = call(open, { close: true });
  assert.equal(exit, 0);
  assert.equal(response.ok, true);
  assert.equal(response.cliVersion, syntheticVersion);
  assert.equal(response.policyHash, policyHash);
  assert.equal(response.payloadHash, payloadHash);
  const privateRoot = path.dirname(response.workspacePath);
  assert.equal(path.basename(response.workspacePath), "workspace");
  assert.equal(path.basename(response.statePath), "state");
  assert(samePath(path.dirname(privateRoot), sessionParent) && samePath(path.dirname(response.statePath), privateRoot));
  assert(!existsSync(privateRoot), "The worker did not clean its private scope.");
  assert(!existsSync(authDirectory), "The smoke unexpectedly created dedicated authentication state.");

  receipt = {
    schemaVersion: 1,
    qualification: "native-worker-smoke",
    compiledWorkerSha256: fileHash(worker),
    proxyPreloadSha256: fileHash(preload),
    policyHash,
    sanitizedChecks: {
      nativeRoots: true, missingAuth: true, missingPayloadDenied: true, injectedPayloadDenied: true,
      syntheticPayloadMeasured: true, wrongPayloadDenied: true, wrongPolicyDenied: true,
      automaticModelDenied: true, wrongAuthIdentityDenied: true, ownedScopeClosed: true
    }
  };
} finally {
  const errors = [];
  const clean = operation => { try { operation(); } catch (error) { errors.push(error); } };
  for (const cleanup of cleanups.reverse()) clean(cleanup);
  if (!retainParent && existsSync(sessionParent)) clean(() => rmdirSync(sessionParent));
  if (!retainContainer && existsSync(sessionContainer)) clean(() => rmdirSync(sessionContainer));
  if (errors.length) throw new AggregateError(errors, "Failed to remove an owned Windows Cursor smoke fixture.");
}
console.log(JSON.stringify(receipt));
