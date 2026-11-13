import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function checkoutIdentity(root) {
  const git = (...args) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", timeout: 2_000, maxBuffer: 256 * 1024,
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
  try {
    // A source archive can live inside another checkout. Never borrow that
    // enclosing repository's commit or claim its clean state for this source.
    if (realpathSync(git("rev-parse", "--show-toplevel")) !== realpathSync(root)) return null;
    const commit = git("rev-parse", "HEAD");
    if (!COMMIT.test(commit)) return null;
    return { commit, dirty: git("status", "--porcelain=v1", "--untracked-files=normal") ? "true" : "false" };
  } catch {
    return null;
  }
}

function checked(value, pattern, label) {
  if (!pattern.test(value)) throw new Error(`Invalid ${label} build identity.`);
  return value;
}

/** Public, immutable build fields only. Never copy arbitrary process env. */
export function resolveBuildIdentity(root, env = process.env, now = () => new Date()) {
  const manifestVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  checked(manifestVersion, VERSION, "package version");
  const version = env.NEXT_PUBLIC_VDT_BUILD_VERSION ?? manifestVersion;
  checked(version, VERSION, "version");
  if (version !== manifestVersion) throw new Error("Build identity version differs from the source package.");

  const checkout = checkoutIdentity(root);
  const suppliedCommit = env.NEXT_PUBLIC_VDT_BUILD_COMMIT;
  if (suppliedCommit !== undefined) checked(suppliedCommit, COMMIT, "commit");
  if (checkout && suppliedCommit && checkout.commit !== suppliedCommit) {
    throw new Error("Build identity commit differs from the source checkout.");
  }
  const suppliedDirty = env.NEXT_PUBLIC_VDT_BUILD_DIRTY;
  if (suppliedDirty !== undefined && !["true", "false", "unknown"].includes(suppliedDirty)) {
    throw new Error("Invalid dirty-state build identity.");
  }
  if (checkout && suppliedDirty !== undefined && suppliedDirty !== checkout.dirty) {
    throw new Error("Build identity dirty state differs from the source checkout.");
  }
  if (!checkout && !suppliedCommit && suppliedDirty === "false") {
    throw new Error("An unidentified source archive cannot claim a clean build.");
  }

  const time = env.NEXT_PUBLIC_VDT_BUILD_TIME ?? now().toISOString();
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(time) || !Number.isFinite(Date.parse(time))) {
    throw new Error("Invalid timestamp build identity.");
  }
  return {
    NEXT_PUBLIC_VDT_BUILD_VERSION: version,
    NEXT_PUBLIC_VDT_BUILD_COMMIT: suppliedCommit ?? checkout?.commit ?? "unknown",
    NEXT_PUBLIC_VDT_BUILD_DIRTY: suppliedDirty ?? checkout?.dirty ?? "unknown",
    NEXT_PUBLIC_VDT_BUILD_TIME: time
  };
}
