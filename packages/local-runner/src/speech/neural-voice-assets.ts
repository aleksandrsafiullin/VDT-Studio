import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, mkdtemp, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { NEURAL_VOICES, type NeuralVoice, type NeuralVoiceAsset } from "./neural-voice-catalog";

const OFFER_TTL_MS = 2 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const MAX_COMMIT_BYTES = 4_096;
const APPROVED_HOSTS = new Set([
  "huggingface.co", "cas-bridge.xethub.hf.co", "cdn-lfs.hf.co", "cdn-lfs-us-1.hf.co",
  "cdn-lfs.huggingface.co", "cdn-lfs-us-1.huggingface.co", "us.aws.cdn.hf.co"
]);
const activePaths = new Set<string>();

type Verification = "missing" | "corrupt" | "verified";

interface Offer {
  readonly id: string;
  readonly voice: NeuralVoice;
  readonly expiresAt: number;
  readonly totalBytes: number;
}

interface Identity { readonly dev: bigint; readonly ino: bigint }
interface FileVersion extends Identity { readonly size: bigint; readonly mtimeNs: bigint }
interface OwnedDirectory extends Identity { readonly path: string }
type OwnedFiles = Map<string, Identity>;

interface CommitManifest {
  schema: 1;
  voiceId: string;
  revision: string;
  payload: string;
  payloadInode: string;
  files: { name: string; bytes: number; sha256: string; inode: string }[];
}

function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function exists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
}

async function inspect(path: string) {
  try { return await lstat(path, { bigint: true }); }
  catch (error) { if (!absent(error)) throw error; }
}

function sameIdentity(current: Identity | undefined, expected: Identity): boolean {
  return current?.ino === expected.ino && current.dev === expected.dev;
}

function sameFileVersion(current: FileVersion | undefined, expected: FileVersion): boolean {
  return current !== undefined && sameIdentity(current, expected)
    && current.size === expected.size && current.mtimeNs === expected.mtimeNs;
}

async function approvedDirectory(path: string) {
  const stats = await inspect(path);
  if (!stats) return undefined;
  if (!stats.isDirectory() || (stats.mode & 0o022n) || (process.getuid && stats.uid !== BigInt(process.getuid()))
    || await realpath(path) !== path) {
    throw new Error("Neural voice storage must be a canonical owned directory without group or other write access.");
  }
  const current = await inspect(path);
  if (!current || !sameIdentity(current, stats) || current.mode !== stats.mode || current.uid !== stats.uid) {
    throw new Error("The owned neural voice directory changed during setup.");
  }
  return { path, dev: stats.dev, ino: stats.ino };
}

async function requireDirectory(path: string): Promise<OwnedDirectory> {
  const result = await approvedDirectory(path);
  if (!result) throw new Error("The owned neural voice directory is missing.");
  return result;
}

async function isOwned(directory: OwnedDirectory): Promise<boolean> {
  const current = await approvedDirectory(directory.path).catch(() => undefined);
  return sameIdentity(current, directory);
}

async function requireOwnership(...directories: OwnedDirectory[]) {
  for (const directory of directories) {
    if (!await isOwned(directory)) throw new Error("The owned neural voice directory changed during setup.");
  }
}

async function createPrivateRoot(path: string) {
  // Setup receives a path below the host's existing, canonical app-data root.
  // Do not recursively create ancestors that could be redirected by a link.
  const parent = await requireDirectory(dirname(path));
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (!exists(error)) throw error; }
  await requireOwnership(parent);
  return requireDirectory(path);
}

async function verifiedFile(path: string, asset: NeuralVoiceAsset, identity?: Identity): Promise<boolean> {
  const stats = await inspect(path);
  if (!stats?.isFile() || stats.size !== BigInt(asset.bytes) || stats.nlink !== 1n) return false;
  if (identity && !sameIdentity(stats, identity)) return false;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await file.stat({ bigint: true });
    if (!opened.isFile() || !sameIdentity(opened, stats) || opened.size !== BigInt(asset.bytes)) return false;
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      bytes += chunk.byteLength;
      if (bytes > asset.bytes) return false;
      hash.update(chunk);
    }
    const current = await inspect(path);
    return current !== undefined && sameIdentity(current, opened) && current.nlink === 1n
      && current.size === opened.size && current.mtimeNs === opened.mtimeNs
      && current.ctimeNs === opened.ctimeNs && bytes === asset.bytes && hash.digest("hex") === asset.sha256;
  } finally { await file.close(); }
}

function approvedUrl(url: URL): boolean {
  return url.protocol === "https:" && APPROVED_HOSTS.has(url.hostname) && !url.port
    && !url.username && !url.password && !url.hash;
}

async function downloadAsset(fetcher: typeof fetch, asset: NeuralVoiceAsset, destination: string, signal: AbortSignal,
  beforeWrite: () => Promise<void>, ownedFiles: OwnedFiles) {
  let url = new URL(asset.url);
  for (let redirects = 0; redirects < 5; redirects++) {
    signal.throwIfAborted();
    if (!approvedUrl(url)) throw new Error("Neural voice download destination is not approved.");
    const response = await fetcher(url, { signal, redirect: "manual", credentials: "omit", referrerPolicy: "no-referrer" });
    const location = response.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      await response.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error("Neural voice download is unavailable.");
    }
    const reader = response.body.getReader();
    let file;
    try {
      signal.throwIfAborted();
      await beforeWrite();
      signal.throwIfAborted();
      file = await open(destination, "wx", 0o600);
      const { dev, ino } = await file.stat({ bigint: true });
      ownedFiles.set(asset.name, { dev, ino });
      const hash = createHash("sha256");
      let bytes = 0;
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > asset.bytes) throw new Error("Neural voice download exceeds its pinned size.");
        hash.update(value);
        await file.writeFile(value);
      }
      signal.throwIfAborted();
      if (bytes !== asset.bytes || hash.digest("hex") !== asset.sha256) throw new Error("Neural voice asset verification failed.");
      await file.sync();
      return;
    } finally {
      await reader.cancel().catch(() => undefined);
      await file?.close();
    }
  }
  throw new Error("Neural voice download exceeded its redirect limit.");
}

async function verifyPayload(directory: OwnedDirectory, assets: readonly NeuralVoiceAsset[], root: OwnedDirectory,
  ownedFiles?: OwnedFiles): Promise<boolean> {
  await requireOwnership(root, directory);
  if ((await readdir(directory.path)).length !== assets.length) return false;
  if (directory.dev !== root.dev) return false;
  for (const asset of assets) {
    await requireOwnership(root, directory);
    const identity = ownedFiles?.get(asset.name);
    if (ownedFiles && !identity) return false;
    if (!await verifiedFile(join(directory.path, asset.name), asset, identity)) return false;
  }
  await requireOwnership(root, directory);
  return true;
}

async function unlinkOwned(path: string, identity: Identity, ...directories: OwnedDirectory[]): Promise<boolean> {
  for (const directory of directories) if (!await isOwned(directory)) return false;
  const current = await inspect(path);
  if (!current?.isFile() || !sameIdentity(current, identity)) return false;
  try { await unlink(path); return true; }
  catch (error) { if (!absent(error)) throw error; return false; }
}

async function removeOwnedFiles(directory: OwnedDirectory, files: OwnedFiles, root: OwnedDirectory) {
  for (const [name, identity] of files) await unlinkOwned(join(directory.path, name), identity, root, directory);
  await removeEmptyOwnedDirectory(directory, root);
}

async function discardOwnedFiles(directory: OwnedDirectory | undefined, files: OwnedFiles, root: OwnedDirectory) {
  if (directory && await isOwned(root) && await isOwned(directory)) await removeOwnedFiles(directory, files, root);
}

async function removeEmptyOwnedDirectory(directory: OwnedDirectory, root: OwnedDirectory) {
  if (await isOwned(root) && await isOwned(directory) && (await readdir(directory.path)).length === 0) {
    await requireOwnership(root, directory);
    await rmdir(directory.path);
  }
}

/** A crash-left lock blocks later writes until ownership is resolved. */
async function withOperationLock<T>(root: OwnedDirectory, path: string, operation: (requireLock: () => Promise<void>) => Promise<T>): Promise<T> {
  await requireOwnership(root);
  const lock = await open(path, "wx", 0o600).catch(error => {
    if (exists(error)) throw new Error("Neural voice asset setup is already in progress or needs lock recovery.");
    throw error;
  });
  try {
    const identity = await lock.stat({ bigint: true });
    const requireLock = async () => {
      await requireOwnership(root);
      if (!sameIdentity(await inspect(path), identity)) throw new Error("Neural voice setup lock ownership changed.");
    };
    try {
      await requireLock();
      await lock.writeFile(String(process.pid));
      return await operation(requireLock);
    } finally { await unlinkOwned(path, identity, root); }
  } finally { await lock.close(); }
}

async function syncDirectory(directory: OwnedDirectory) {
  const handle = await open(directory.path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!sameIdentity(await handle.stat({ bigint: true }), directory)) {
      throw new Error("The owned neural voice directory changed during setup.");
    }
    await handle.sync();
  } finally { await handle.close(); }
}

function makeManifest(voice: NeuralVoice, payload: OwnedDirectory, files: OwnedFiles): CommitManifest {
  return { schema: 1, voiceId: voice.id, revision: voice.revision, payload: basename(payload.path), payloadInode: String(payload.ino),
    files: voice.assets.map(({ name, bytes, sha256 }) => {
      const identity = files.get(name);
      if (!identity) throw new Error("The staged neural voice manifest is incomplete.");
      return { name, bytes, sha256, inode: String(identity.ino) };
    })
  };
}

async function readCommit(path: string, voice: NeuralVoice, root: OwnedDirectory) {
  await requireOwnership(root);
  const entry = await inspect(path);
  if (!entry) return undefined;
  const corrupt = () => new Error("The neural voice commit manifest is invalid.");
  if (!entry.isFile() || entry.dev !== root.dev || entry.size <= 0n || entry.size > BigInt(MAX_COMMIT_BYTES)
    || (entry.mode & 0o022n) || (process.getuid && entry.uid !== BigInt(process.getuid()))) throw corrupt();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let text: string;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameIdentity(entry, opened) || opened.size !== entry.size) throw corrupt();
    const bytes = Buffer.alloc(MAX_COMMIT_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (BigInt(bytesRead) !== opened.size) throw corrupt();
    text = bytes.subarray(0, bytesRead).toString("utf8");
    const current = await inspect(path);
    if (!sameFileVersion(current, opened)) throw corrupt();
  } finally { await handle.close(); }
  let value: Partial<CommitManifest>;
  try { value = JSON.parse(text); } catch { throw corrupt(); }
  const inode = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
  if (!value || value.schema !== 1 || value.voiceId !== voice.id || value.revision !== voice.revision
    || typeof value.payload !== "string" || !/^\.payload-[a-zA-Z0-9]{6}$/.test(value.payload)
    || !inode(value.payloadInode) || !Array.isArray(value.files) || value.files.length !== voice.assets.length) throw corrupt();
  const files: OwnedFiles = new Map();
  for (const [index, asset] of voice.assets.entries()) {
    const data = value.files[index];
    if (!data || data.name !== asset.name || data.bytes !== asset.bytes || data.sha256 !== asset.sha256 || !inode(data.inode)) throw corrupt();
    files.set(asset.name, { dev: root.dev, ino: BigInt(data.inode) });
  }
  const payload = { path: join(root.path, value.payload), dev: root.dev, ino: BigInt(value.payloadInode) };
  if (JSON.stringify(makeManifest(voice, payload, files)) !== text) throw corrupt();
  return { identity: entry, payload, files, text };
}

/** Host-only asset setup. Verification here establishes model data integrity.
 * An engine adapter must separately verify its executable before enabling speech. */
export class NeuralVoiceAssetInstaller {
  readonly #directory: string;
  readonly #fetcher: typeof fetch;
  readonly #clock: () => number;
  readonly #catalog: readonly NeuralVoice[];
  readonly #offers = new Map<string, Offer>();

  constructor(directory: string, host: { fetch?: typeof fetch; now?: () => number; catalog?: readonly NeuralVoice[] } = {}) {
    if (!isAbsolute(directory)) throw new Error("Neural voice storage must use a host-owned absolute path.");
    this.#directory = resolve(directory);
    this.#fetcher = host.fetch ?? fetch;
    this.#clock = host.now ?? Date.now;
    this.#catalog = host.catalog ?? NEURAL_VOICES;
  }

  offer(voiceId: string): Offer {
    const voice = this.#voice(voiceId);
    const offer = Object.freeze({ id: randomUUID(), voice, expiresAt: this.#clock() + OFFER_TTL_MS,
      totalBytes: voice.assets.reduce((size, asset) => size + asset.bytes, 0) });
    this.#offers.set(voice.id, offer);
    return offer;
  }

  revokeOffer(offerId: string): void {
    for (const [voiceId, offer] of this.#offers) {
      if (offer.id === offerId) this.#offers.delete(voiceId);
    }
  }

  async verify(voiceId: string): Promise<Verification> {
    const voice = this.#voice(voiceId);
    const root = await approvedDirectory(this.#directory);
    if (!root) return "missing";
    return this.#verifyVoice(voice, root);
  }

  /** Keep the published payload stable against cooperating install/remove operations. */
  async withVerifiedAssets<T>(voiceId: string, use: (voice: NeuralVoice, directory: string) => Promise<T>): Promise<T> {
    const voice = this.#voice(voiceId);
    const path = this.#path(voice);
    const root = await approvedDirectory(this.#directory);
    if (!root) throw new Error("The selected neural voice must be installed.");
    if (activePaths.has(path)) throw new Error("Neural voice assets are busy.");
    activePaths.add(path);
    try {
      return await withOperationLock(root, `${path}.lock`, async requireLock => {
        const commit = await readCommit(path, voice, root);
        if (!commit || !await verifyPayload(commit.payload, voice.assets, root, commit.files)
          || !sameFileVersion(await inspect(path), commit.identity)) {
          throw new Error("The selected neural voice assets could not be verified.");
        }
        await requireLock();
        return use(voice, commit.payload.path);
      });
    } finally { activePaths.delete(path); }
  }

  async #verifyVoice(voice: NeuralVoice, root: OwnedDirectory): Promise<Verification> {
    try {
      const path = this.#path(voice);
      const commit = await readCommit(path, voice, root);
      if (!commit) return "missing";
      const verified = await verifyPayload(commit.payload, voice.assets, root, commit.files);
      return verified && sameFileVersion(await inspect(path), commit.identity) && await isOwned(root) ? "verified" : "corrupt";
    } catch { return "corrupt"; }
  }

  async install(voiceId: string, offerId: string, confirmed: boolean, cancellation?: AbortSignal): Promise<"verified"> {
    const voice = this.#voice(voiceId);
    const offer = this.#offers.get(voice.id);
    if (confirmed !== true || offer?.id !== offerId || offer.voice.revision !== voice.revision || offer.expiresAt <= this.#clock()) {
      throw new Error("An unexpired explicit consent offer for this neural voice is required.");
    }
    const path = this.#path(voice);
    if (activePaths.has(path)) throw new Error("Neural voice asset setup is already in progress.");
    this.#offers.delete(voice.id);
    activePaths.add(path);
    const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const signal = cancellation ? AbortSignal.any([cancellation, timeout]) : timeout;
    try {
      signal.throwIfAborted();
      const root = await createPrivateRoot(this.#directory);
      return await withOperationLock(root, `${path}.lock`, requireLock => this.#installVoice(voice, root, path, signal, requireLock));
    } finally { activePaths.delete(path); }
  }

  async #installVoice(voice: NeuralVoice, root: OwnedDirectory, path: string, signal: AbortSignal,
    requireLock: () => Promise<void>): Promise<"verified"> {
    const prior = await this.#verifyVoice(voice, root);
    signal.throwIfAborted();
    if (prior === "verified") return prior;
    if (prior === "corrupt") throw new Error("Remove the existing unverified neural voice assets before reinstalling.");

    await requireOwnership(root);
    const payload = await requireDirectory(await mkdtemp(join(root.path, ".payload-")));
    const manifestPath = `${payload.path}.tmp`;
    const ownedFiles: OwnedFiles = new Map();
    let manifestIdentity: Identity | undefined;
    let linked = false;
    let committed = false;
    try {
      for (const asset of voice.assets) {
        await requireOwnership(root, payload);
        await downloadAsset(this.#fetcher, asset, join(payload.path, asset.name), signal,
          () => requireOwnership(root, payload), ownedFiles);
      }
      if (!await verifyPayload(payload, voice.assets, root, ownedFiles)) throw new Error("Staged neural voice asset verification failed.");
      const body = JSON.stringify(makeManifest(voice, payload, ownedFiles));
      if (Buffer.byteLength(body) > MAX_COMMIT_BYTES) throw new Error("The staged neural voice manifest exceeds its limit.");
      const manifest = await open(manifestPath, "wx", 0o600);
      try {
        manifestIdentity = await manifest.stat({ bigint: true });
        await manifest.writeFile(body);
        await manifest.sync();
      } finally { await manifest.close(); }
      await syncDirectory(payload);
      await requireOwnership(root, payload);
      await requireLock();
      // Cancellation wins until the exclusive atomic commit starts. No data
      // directory moves into a shared name. A hard link cannot clobber an entry.
      signal.throwIfAborted();
      try { await link(manifestPath, path); }
      catch (error) {
        if (exists(error)) throw new Error("Neural voice assets appeared during setup.");
        throw error;
      }
      linked = true;
      const published = await readCommit(path, voice, root);
      if (!published || !sameIdentity(published.identity, manifestIdentity)
        || published.text !== body || !sameIdentity(published.payload, payload) || published.payload.path !== payload.path
        || !await verifyPayload(payload, voice.assets, root, ownedFiles)) {
        throw new Error("Published neural voice asset verification failed.");
      }
      await syncDirectory(root);
      await requireOwnership(root, payload);
      if (!sameFileVersion(await inspect(path), published.identity)) throw new Error("The neural voice commit changed during setup.");
      committed = true;
      return "verified";
    } finally {
      try {
        if (!committed && (!linked || (manifestIdentity && await unlinkOwned(path, manifestIdentity, root)))) {
          await discardOwnedFiles(payload, ownedFiles, root);
        }
      } finally { if (manifestIdentity) await unlinkOwned(manifestPath, manifestIdentity, root); }
    }
  }

  async remove(voiceId: string, confirmed: boolean): Promise<boolean> {
    const voice = this.#voice(voiceId);
    if (confirmed !== true) throw new Error("Confirm removal of the selected neural voice assets.");
    const path = this.#path(voice);
    if (activePaths.has(path)) throw new Error("Neural voice asset setup is already in progress.");
    activePaths.add(path);
    try {
      const root = await approvedDirectory(this.#directory);
      if (!root) return false;
      return await withOperationLock(root, `${path}.lock`, requireLock => this.#removeVoice(voice, root, path, requireLock));
    } finally { activePaths.delete(path); }
  }

  async #removeVoice(voice: NeuralVoice, root: OwnedDirectory, path: string, requireLock: () => Promise<void>): Promise<boolean> {
    const commit = await readCommit(path, voice, root);
    if (!commit) return false;
    const { payload, files } = commit;
    const existing = await approvedDirectory(payload.path);
    if (existing) {
      await requireOwnership(root, payload);
      for (const name of await readdir(payload.path)) {
        const identity = files.get(name);
        const current = await inspect(join(payload.path, name));
        if (!identity || !current?.isFile() || !sameIdentity(current, identity)) {
          throw new Error("Neural voice storage contains files outside the selected voice.");
        }
      }
      await requireOwnership(root, payload);
    }
    await requireLock();
    if (!sameFileVersion(await inspect(path), commit.identity)
      || !await unlinkOwned(path, commit.identity, root)) throw new Error("The neural voice commit changed during removal.");
    await syncDirectory(root);
    if (existing) await discardOwnedFiles(payload, files, root);
    return true;
  }

  #voice(id: string): NeuralVoice {
    const voice = this.#catalog.find(entry => entry.id === id);
    if (!voice || !/^[a-zA-Z0-9_-]+$/.test(voice.id) || !/^[a-f0-9]{40}$/.test(voice.revision)) {
      throw new Error("Neural voice is not in the approved catalog.");
    }
    return voice;
  }

  #path(voice: NeuralVoice) {
    return join(this.#directory, `${voice.id}-${voice.revision}.commit`);
  }
}
