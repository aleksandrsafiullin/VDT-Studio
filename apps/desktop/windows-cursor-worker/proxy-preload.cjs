"use strict";

// This is a compatibility shim for the pinned Node runtime. The AppContainer
// token confines network access. The only supported proxy address here maps
// to already connected handles supplied by the native parent.
const { Socket } = require("node:net");
const os = require("node:os");
const { syncBuiltinESMExports } = require("node:module");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");

function comparablePath(filename) {
  if (typeof filename !== "string") return undefined;
  const ordinaryPath = filename.startsWith("\\\\?\\") ? filename.slice(4) : filename;
  if (!/^[A-Za-z]:[\\/]/.test(ordinaryPath)) return undefined;
  return path.win32.normalize(ordinaryPath).toLowerCase();
}

function installPrivatePersistence(profile) {
  const fs = require("node:fs");
  const logical = "\\tmp\\cursor-agent-persist-user";
  const physical = path.win32.join(profile, "cursor-private-persist");
  const drive = profile.slice(0, 2).toLowerCase();

  function privatePath(filename) {
    if (typeof filename !== "string") return filename;
    let candidate = filename.replaceAll("/", "\\");
    if (candidate.startsWith("\\\\?\\")) candidate = candidate.slice(4);
    if (candidate.slice(0, 2).toLowerCase() === drive) candidate = candidate.slice(2);
    const normalizedCase = candidate.toLowerCase();
    if (normalizedCase === logical) return physical;
    if (!normalizedCase.startsWith(logical + "\\")) return filename;
    const parts = candidate.slice(logical.length + 1).split("\\");
    if (parts.some(part => !/^[a-z0-9_-][a-z0-9_.-]{0,127}$/i.test(part) || part.endsWith(".")
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
      throw Object.assign(new Error("Invalid Cursor persistent-session path."), { code: "EINVAL" });
    }
    return path.win32.join(physical, ...parts);
  }

  // The pinned CLI checks the literal /tmp lock directory on every resume.
  // Use real operations in the owned state rather than changing their results.
  for (const method of ["chmodSync", "existsSync", "lstatSync", "mkdirSync", "readFileSync",
    "readdirSync", "rmSync", "statSync", "unlinkSync", "writeFileSync"]) {
    const original = fs[method];
    fs[method] = function privateFileOperation(filename, ...args) {
      return Reflect.apply(original, this, [privatePath(filename), ...args]);
    };
  }
  for (const method of ["linkSync", "renameSync"]) {
    const original = fs[method];
    fs[method] = function privateFileTransfer(source, destination, ...args) {
      return Reflect.apply(original, this, [privatePath(source), privatePath(destination), ...args]);
    };
  }
  const realpath = fs.realpathSync;
  fs.realpathSync = function privateRealpath(filename, ...args) {
    return Reflect.apply(realpath, this, [privatePath(filename), ...args]);
  };
  fs.realpathSync.native = function privateNativeRealpath(filename, ...args) {
    return Reflect.apply(realpath.native, this, [privatePath(filename), ...args]);
  };
}

function installPrivateConfigShadow(profile) {
  const policyDirectory = path.win32.join(path.win32.dirname(profile), "policy");
  if (comparablePath(process.env.CURSOR_CONFIG_DIR) !== comparablePath(policyDirectory)) return;
  const config = path.win32.join(policyDirectory, "cli-config.json");
  const target = comparablePath(config);
  const prefix = `${target}.${process.pid}.`;
  const fs = require("node:fs");
  const files = require("node:fs/promises");
  const { readFile, writeFile, rename, rm } = files;
  const policy = JSON.parse(fs.readFileSync(config, "utf8"));
  const modelSettings = [
    "model", "maxMode", "hasChangedDefaultModel", "selectedModel", "modelParameters", "modelSelectionHistory"
  ];
  const metadata = new Set([
    "authInfo", "privacyCache", "autoAcceptWebSearch", "display", "exploreSubagentModel",
    "hints", "modelSlashCommands", "network", "notifications", "rewind", "steering", ...modelSettings
  ]);
  const staged = new Map();
  let shadow;

  function temporaryPath(filename) {
    const candidate = comparablePath(filename);
    return candidate?.startsWith(prefix)
      && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/.test(candidate.slice(prefix.length))
        ? candidate : undefined;
  }

  function rejectUpdate() {
    return Object.assign(new Error("Cursor attempted an unreviewed config update."), { code: "EPERM" });
  }

  // The official CLI writes a JSON snapshot to a sibling UUID file and renames
  // it over its config. Keep only the reviewed inert settings in this process.
  // The file that grants or denies tools stays read-only under Windows.
  files.writeFile = async function writePrivateConfigDraft(filename, data, ...options) {
    const temporary = temporaryPath(filename);
    if (!temporary) return Reflect.apply(writeFile, this, [filename, data, ...options]);
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : data;
    if (typeof text !== "string" || Buffer.byteLength(text) > 65536 || staged.size >= 8) throw rejectUpdate();
    let draft;
    try {
      draft = JSON.parse(text);
    } catch {
      throw rejectUpdate();
    }
    if (!draft || typeof draft !== "object" || Array.isArray(draft)
      || Object.entries(policy).some(([key, expected]) => !isDeepStrictEqual(draft[key], expected))
      || Object.keys(draft).some(key => !Object.hasOwn(policy, key) && !metadata.has(key))
      || (Object.hasOwn(draft, "autoAcceptWebSearch") && draft.autoAcceptWebSearch !== false)
      || (Object.hasOwn(draft, "exploreSubagentModel") && draft.exploreSubagentModel !== "default")
      || (Object.hasOwn(draft, "network")
        && !(typeof draft.network?.useHttp1ForAgent === "boolean"
          && isDeepStrictEqual(draft.network, { useHttp1ForAgent: draft.network.useHttp1ForAgent })))) {
      throw rejectUpdate();
    }
    // The caller pins --model on every segment. Leave model selection out of
    // the shadow that later config loads will see.
    for (const key of modelSettings) delete draft[key];
    staged.set(temporary, JSON.stringify(draft));
  };
  files.rename = async function publishPrivateConfigDraft(source, destination) {
    const temporary = temporaryPath(source);
    if (!temporary || comparablePath(destination) !== target) {
      return Reflect.apply(rename, this, [source, destination]);
    }
    if (!staged.has(temporary)) throw rejectUpdate();
    shadow = staged.get(temporary);
    staged.delete(temporary);
  };
  files.readFile = function readPrivateConfig(filename, ...options) {
    if (shadow !== undefined && comparablePath(filename) === target && options[0] === "utf8") {
      return Promise.resolve(shadow);
    }
    return Reflect.apply(readFile, this, [filename, ...options]);
  };
  files.rm = async function removePrivateConfigDraft(filename, ...options) {
    if (staged.delete(temporaryPath(filename))) return;
    return Reflect.apply(rm, this, [filename, ...options]);
  };
}

// The pinned CLI derives its local-worker pipe name from os.userInfo.
// LPAC cannot query the normal Windows account database. Give the CLI an
// identity unique to the provisioned scope without consulting that account.
const profile = process.env.USERPROFILE;
const scopeId = process.platform === "win32" && profile === process.env.HOME
  && path.win32.isAbsolute(profile ?? "") && path.win32.basename(profile) === "state"
  ? /^VdtCursorSession([0-9a-f]{32})$/.exec(path.win32.basename(path.win32.dirname(profile)))?.[1]
  : undefined;
if (scopeId !== undefined) {
  const userInfo = os.userInfo;
  os.userInfo = function userInfoInPrivateScope(...args) {
    try {
      return Reflect.apply(userInfo, this, args);
    } catch (error) {
      if (args.length || error?.code !== "ERR_SYSTEM_ERROR" || error.info?.syscall !== "uv_os_get_passwd"
          || error.info?.code !== "UNKNOWN") {
        throw error;
      }
      return { username: `vdt-${scopeId}`, uid: -1, gid: -1, shell: null, homedir: profile };
    }
  };
  installPrivateConfigShadow(profile);
  installPrivatePersistence(profile);
  syncBuiltinESMExports();
}

const firstDescriptor = 3;
const endDescriptor = firstDescriptor + 64;
const sentinelHost = "127.0.0.1";
const sentinelPort = 1;
let nextDescriptor = firstDescriptor;

const connect = Socket.prototype.connect;
Socket.prototype.connect = function connectThroughCursorProxy(...args) {
  const parameters = Array.isArray(args[0]) ? args[0] : args;
  const options = parameters[0];
  const host = typeof options === "object" && options !== null ? options.host : parameters[1];
  const port = typeof options === "object" && options !== null ? options.port : options;
  if (host !== sentinelHost || Number(port) !== sentinelPort) {
    return Reflect.apply(connect, this, args);
  }
  if (nextDescriptor === endDescriptor) {
    throw new Error("The isolated Cursor proxy connection limit was reached.");
  }
  const socket = new Socket({ fd: nextDescriptor++, readable: true, writable: true });
  const callback = parameters.find(parameter => typeof parameter === "function");
  if (callback) socket.once("connect", callback);
  process.nextTick(() => {
    if (!socket.destroyed) {
      socket.emit("connect");
      socket.emit("ready");
    }
  });
  return socket;
};
