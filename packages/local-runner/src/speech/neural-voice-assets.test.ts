import { createHash } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEURAL_VOICE_ENGINE, NEURAL_VOICES } from "./neural-voice-catalog";
import { NeuralVoiceAssetInstaller } from "./neural-voice-assets";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, link: vi.fn(actual.link) };
});

const bodies = ["fake-onnx-weights", '{"audio":{"sample_rate":22050}}', "Model and training sources"];
const catalog = NEURAL_VOICES.map(voice => ({ ...voice, assets: voice.assets.map((asset, index) => ({ ...asset,
  bytes: Buffer.byteLength(bodies[index]!), sha256: createHash("sha256").update(bodies[index]!).digest("hex")
})) }));
const joe = catalog[0]!;
const denis = catalog[1]!;

describe("X02 neural voice asset setup", () => {
  const fetcher = vi.fn<typeof fetch>();
  let scratch: string;
  let root: string;
  let now: number;
  const commitFor = (voice = joe) => join(root, `${voice.id}-${voice.revision}.commit`);
  const pathFor = async (voice = joe) => join(root, JSON.parse(await readFile(commitFor(voice), "utf8")).payload);
  const committedEntries = async (voice = joe) => [basename(await pathFor(voice)), basename(commitFor(voice))].sort();
  const stagedPayload = async () => join(root, (await readdir(root)).find(name => /^\.payload-[a-z0-9]{6}$/i.test(name))!);
  const installer = () => new NeuralVoiceAssetInstaller(root, { catalog, fetch: fetcher, now: () => now });

  beforeEach(async () => {
    scratch = await mkdtemp(join(await realpath(tmpdir()), "vdt-neural-voice-test-"));
    root = join(scratch, "voices");
    now = 5;
    fetcher.mockReset();
    fetcher.mockImplementation(async input => {
      const url = input.toString();
      const voice = catalog.find(voice => voice.assets.some(asset => asset.url === url));
      const index = voice?.assets.findIndex(asset => asset.url === url) ?? -1;
      return new Response(bodies[index], { status: index < 0 ? 404 : 200 });
    });
  });

  afterEach(async () => { await rm(scratch, { recursive: true, force: true }); });

  it("pins exact per-voice provenance, asset locations, sizes and weight hashes", () => {
    expect(NEURAL_VOICE_ENGINE).toMatchObject({ name: "Piper", minimumVersion: "1.5", license: "GPL-3.0-or-later" });
    expect(NEURAL_VOICES.map(voice => [voice.id, voice.locale, voice.assets[0]?.sha256])).toEqual([
      ["en_US-joe-medium", "en-US", "abf4b998e34045cbd00eaf050de2de620f81ded6eb8b85a24b022a1c2b3f08d2"],
      ["ru_RU-denis-medium", "ru-RU", "879bc365cb14d1380e3f5ed6044162ccf54c99f6161871569b7f830aec3ce841"]
    ]);
    for (const voice of NEURAL_VOICES) {
      expect(voice.revision).toBe("cf910fb59f1d79ab3b625a63993a108751c6c25d");
      expect(voice.provenance).toMatchObject({ datasetLicense: "CC0-1.0", baseDatasetLicense: "CC0-1.0" });
      expect(voice.provenance.baseModelCardUrl).toContain(`/resolve/${voice.revision}/nl/nl_BE/rdh/medium/MODEL_CARD`);
      expect(voice.assets.map(asset => asset.name)).toEqual(["model.onnx", "model.onnx.json", "MODEL_CARD"]);
      expect(voice.assets[0]?.bytes).toBe(63_221_984);
      expect(voice.assets.every(asset => asset.url.startsWith(`https://huggingface.co/rhasspy/piper-voices/resolve/${voice.revision}/`)
        && /^[a-f0-9]{64}$/.test(asset.sha256))).toBe(true);
    }
  });

  it("requires exact explicit consent once and verifies the published model data without network", async () => {
    const store = installer();
    expect(store.offer.bind(store, "../custom")).toThrow(/approved catalog/);
    const offer = store.offer(joe.id);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(store.verify(joe.id)).resolves.toBe("missing");
    await expect(store.install(denis.id, offer.id, true)).rejects.toThrow(/consent offer/);
    await expect(store.install(joe.id, offer.id, false)).rejects.toThrow(/consent offer/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(store.install(joe.id, offer.id, true)).resolves.toBe("verified");
    expect(await readFile(join(await pathFor(), "MODEL_CARD"), "utf8")).toBe(bodies[2]);
    expect((await lstat(commitFor())).nlink).toBe(1);
    const verifying = installer();
    await expect(verifying.verify(joe.id)).resolves.toBe("verified");
    await expect(store.install(joe.id, offer.id, true)).rejects.toThrow(/consent offer/);
    const expiring = store.offer(denis.id);
    now = expiring.expiresAt;
    await expect(store.install(denis.id, expiring.id, true)).rejects.toThrow(/consent offer/);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every(([, options]) => options?.redirect === "manual" && options.credentials === "omit")).toBe(true);
  });

  it("blocks unexpected redirect hosts and leaves the previous voice installed", async () => {
    const store = installer();
    await store.install(joe.id, store.offer(joe.id).id, true);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "https://outside.example/asset" } }));
    const offer = store.offer(denis.id);
    await expect(store.install(denis.id, offer.id, true)).rejects.toThrow(/destination/);
    await expect(store.install(denis.id, offer.id, true)).rejects.toThrow(/consent offer/);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect((await readdir(root)).sort()).toEqual(await committedEntries());
    await expect(store.verify(joe.id)).resolves.toBe("verified");
    await expect(store.verify(denis.id)).resolves.toBe("missing");
  });

  it.each(["cas-bridge.xethub.hf.co", "us.aws.cdn.hf.co"])("uses only approved CDN redirects and checks their bytes (%s)", async host => {
    const store = installer();
    const destination = `https://${host}/example?signature=fixture`;
    fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: destination } }));
    fetcher.mockResolvedValueOnce(new Response(bodies[0]));
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).resolves.toBe("verified");
    expect(fetcher.mock.calls[1]?.[0].toString()).toBe(destination);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ redirect: "manual", credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("leases only verified assets and prevents competing removal until the renderer exits", async () => {
    const store = installer();
    const render = vi.fn(async () => "PCM");
    await expect(store.withVerifiedAssets(joe.id, render)).rejects.toThrow(/must be installed/);
    expect(render).not.toHaveBeenCalled();
    await store.install(joe.id, store.offer(joe.id).id, true);
    const wav = await store.withVerifiedAssets(joe.id, async (voice, directory) => {
      expect(voice.id).toBe(joe.id);
      expect(directory).toBe(await pathFor());
      await expect(installer().remove(joe.id, true)).rejects.toThrow(/in progress/);
      return render();
    });
    expect(wav).toBe("PCM");
    await writeFile(join(await pathFor(), "model.onnx"), "corrupt");
    await expect(store.withVerifiedAssets(joe.id, render)).rejects.toThrow(/could not be verified/);
    expect(render).toHaveBeenCalledTimes(1);
    await expect(installer().remove(joe.id, true)).resolves.toBe(true);
  });

  it("discards corrupt or oversized temporary assets before publication", async () => {
    const store = installer();
    fetcher.mockResolvedValueOnce(new Response("x".repeat(joe.assets[0]!.bytes)));
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/verification failed/);
    fetcher.mockResolvedValueOnce(new Response("x".repeat(joe.assets[0]!.bytes + 1)));
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/pinned size/);
    expect(await readdir(root)).toEqual([]);
  });

  it("reports an existing damaged installation and requires explicit removal without overwriting it", async () => {
    const store = installer();
    await store.install(joe.id, store.offer(joe.id).id, true);
    const storage = join(await pathFor(), "model.onnx.json");
    const damaged = "?".repeat(joe.assets[1]!.bytes);
    await writeFile(storage, damaged);
    await expect(store.verify(joe.id)).resolves.toBe("corrupt");
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/before reinstalling/);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(await readFile(storage, "utf8")).toBe(damaged);
    await expect(store.remove(joe.id, true)).resolves.toBe(true);
    await expect(store.verify(joe.id)).resolves.toBe("missing");
  });

  it("fences cancellation and same-voice install/remove races, preserving other verified assets", async () => {
    const store = installer();
    const racing = installer();
    await store.install(denis.id, store.offer(denis.id).id, true);
    const controller = new AbortController();
    let respond!: (response: Response) => void;
    let entered!: () => void;
    const active = new Promise<void>(resolve => { entered = resolve; });
    fetcher.mockImplementationOnce(async () => new Promise<Response>(resolve => { respond = resolve; entered(); }));
    const installing = store.install(joe.id, store.offer(joe.id).id, true, controller.signal);
    await active;
    await expect(racing.install(joe.id, racing.offer(joe.id).id, true)).rejects.toThrow(/already in progress/);
    await expect(racing.remove(joe.id, true)).rejects.toThrow(/already in progress/);
    controller.abort();
    respond(new Response(bodies[0]));
    await expect(installing).rejects.toMatchObject({ name: "AbortError" });
    await expect(store.verify(denis.id)).resolves.toBe("verified");
    expect((await readdir(root)).sort()).toEqual(await committedEntries(denis));
  });

  it("keeps an arbitrary competing commit file created immediately before the atomic link", async () => {
    const store = installer();
    let inode: bigint | undefined;
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(link).mockImplementationOnce(async (from, to) => {
      expect(to).toBe(commitFor());
      await writeFile(commitFor(), "unrelated competing bytes", { flag: "wx" });
      inode = (await lstat(commitFor(), { bigint: true })).ino;
      await actual.link(from, to);
    });
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/appeared during setup/);
    expect(await readFile(commitFor(), "utf8")).toBe("unrelated competing bytes");
    expect((await lstat(commitFor(), { bigint: true })).ino).toBe(inode);
    expect(await readdir(root)).toEqual([basename(commitFor())]);
  });

  it("never replaces a competing empty directory created just before the atomic link", async () => {
    const store = installer();
    let inode: bigint | undefined;
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(link).mockImplementationOnce(async (from, to) => {
      await mkdir(commitFor(), { mode: 0o700 });
      inode = (await lstat(commitFor(), { bigint: true })).ino;
      await actual.link(from, to);
    });
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/appeared during setup/);
    expect((await lstat(commitFor(), { bigint: true })).ino).toBe(inode);
    expect(await readdir(commitFor())).toEqual([]);
    await expect(store.verify(joe.id)).resolves.toBe("corrupt");
  });

  it("fences an independently held filesystem setup lock without editing its ownership", async () => {
    const store = installer();
    await mkdir(root, { mode: 0o700 });
    const lock = `${commitFor()}.lock`;
    await writeFile(lock, "peer-owner", { flag: "wx", mode: 0o600 });
    const { ino } = await lstat(lock, { bigint: true });
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/already in progress/);
    await expect(store.remove(joe.id, true)).rejects.toThrow(/already in progress/);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await lstat(lock, { bigint: true })).ino).toBe(ino);
    expect(await readFile(lock, "utf8")).toBe("peer-owner");
  });

  it("finishes and verifies an atomic commit when cancellation arrives after it starts", async () => {
    const store = installer();
    const controller = new AbortController();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(link).mockImplementationOnce(async (from, to) => {
      controller.abort();
      await actual.link(from, to);
    });
    await expect(store.install(joe.id, store.offer(joe.id).id, true, controller.signal)).resolves.toBe("verified");
    await expect(installer().verify(joe.id)).resolves.toBe("verified");
    expect((await readdir(root)).sort()).toEqual(await committedEntries());
  });

  it("rejects a symlink ancestor before creating storage or downloading", async () => {
    const outside = join(scratch, "outside");
    const redirect = join(scratch, "redirect");
    await mkdir(outside, { mode: 0o700 });
    await symlink(outside, redirect, "dir");
    root = join(redirect, "voices");
    const store = installer();
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/owned directory/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readdir(outside)).toEqual([]);
  });

  it("rehashes on-disk staging when bytes change between successful downloads", async () => {
    const store = installer();
    fetcher.mockResolvedValueOnce(new Response(bodies[0]));
    fetcher.mockImplementationOnce(async () => {
      await writeFile(join(await stagedPayload(), "model.onnx"), "x".repeat(joe.assets[0]!.bytes));
      return new Response(bodies[1]);
    });
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/Staged neural voice asset verification failed/);
    await expect(store.verify(joe.id)).resolves.toBe("missing");
    expect(await readdir(root)).toEqual([]);
  });

  it("checks hashes and file ownership after publishing and rolls back only its own files", async () => {
    const store = installer();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(link).mockImplementationOnce(async (from, to) => {
      await actual.link(from, to);
      await writeFile(join(await pathFor(), "model.onnx"), "x".repeat(joe.assets[0]!.bytes));
    });
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/Published neural voice asset verification failed/);
    await expect(store.verify(joe.id)).resolves.toBe("missing");
    expect(await readdir(root)).toEqual([]);

    const moved = join(scratch, "moved-weights");
    let payload: string | undefined;
    vi.mocked(link).mockImplementationOnce(async (from, to) => {
      await actual.link(from, to);
      payload = await pathFor();
      await rename(join(payload, "model.onnx"), moved);
      await writeFile(join(payload, "model.onnx"), bodies[0]!);
    });
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/Published neural voice asset verification failed/);
    await expect(store.verify(joe.id)).resolves.toBe("missing");
    expect(await readdir(payload!)).toEqual(["model.onnx"]);
    expect(await readFile(join(payload!, "model.onnx"), "utf8")).toBe(bodies[0]);
    expect(await readFile(moved, "utf8")).toBe(bodies[0]);
  });

  it("leaves a replaced published manifest and its referenced payload intact after detecting ownership loss", async () => {
    const store = installer();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const original = join(scratch, "retired-commit");
    let foreignIdentity: bigint | undefined;
    vi.mocked(link).mockImplementationOnce(async (from, to) => {
      await actual.link(from, to);
      await rename(commitFor(), original);
      await writeFile(commitFor(), "unrelated pointer", { flag: "wx" });
      foreignIdentity = (await lstat(commitFor(), { bigint: true })).ino;
    });
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/commit manifest is invalid/);
    expect((await lstat(commitFor(), { bigint: true })).ino).toBe(foreignIdentity);
    expect(await readFile(commitFor(), "utf8")).toBe("unrelated pointer");
    const retired = JSON.parse(await readFile(original, "utf8"));
    expect(await readFile(join(root, retired.payload, "model.onnx"), "utf8")).toBe(bodies[0]);
  });

  it("neither writes nor cleans a staging path replaced while awaiting the downloader", async () => {
    const store = installer();
    const moved = join(scratch, "moved");
    let substitute: string | undefined;
    fetcher.mockImplementationOnce(async () => {
      substitute = await stagedPayload();
      await rename(substitute, moved);
      await mkdir(substitute, { mode: 0o700 });
      await writeFile(join(substitute, "sentinel"), "preserve");
      return new Response(bodies[0]);
    });
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/directory changed/);
    expect(await readdir(substitute!)).toEqual(["sentinel"]);
    expect(await readFile(join(substitute!, "sentinel"), "utf8")).toBe("preserve");
    expect(await readdir(moved)).toEqual([]);
    await expect(store.verify(joe.id)).resolves.toBe("missing");
  });

  it("neither writes nor cleans a replacement storage root during setup", async () => {
    const store = installer();
    const moved = join(scratch, "moved");
    fetcher.mockImplementationOnce(async () => {
      await rename(root, moved);
      await mkdir(root, { mode: 0o700 });
      await writeFile(join(root, "sentinel"), "preserve");
      return new Response(bodies[0]);
    });
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/directory changed/);
    expect(await readdir(root)).toEqual(["sentinel"]);
    expect(await readFile(join(root, "sentinel"), "utf8")).toBe("preserve");
    expect((await readdir(moved)).some(name => name.startsWith(".payload-"))).toBe(true);
    await expect(store.verify(joe.id)).resolves.toBe("missing");
  });

  it("rejects symlink storage and removal cannot touch other files or a symlink target", async () => {
    const store = installer();
    const outside = join(scratch, "outside");
    await mkdir(outside, { mode: 0o700 });
    await writeFile(join(outside, "MODEL_CARD"), "outside");
    await symlink(outside, root, "dir");
    await expect(store.install(joe.id, store.offer(joe.id).id, true)).rejects.toThrow(/owned directory/);
    expect(fetcher).not.toHaveBeenCalled();
    await unlink(root);
    await store.install(joe.id, store.offer(joe.id).id, true);
    await store.install(denis.id, store.offer(denis.id).id, true);
    const card = join(await pathFor(), "MODEL_CARD");
    await unlink(card);
    await symlink(join(outside, "MODEL_CARD"), card);
    await expect(store.verify(joe.id)).resolves.toBe("corrupt");
    await expect(store.remove(joe.id, true)).rejects.toThrow(/outside the selected voice/);
    await unlink(card);
    await expect(store.remove(joe.id, false)).rejects.toThrow(/Confirm removal/);
    await expect(store.remove(joe.id, true)).resolves.toBe(true);
    await expect(store.verify(joe.id)).resolves.toBe("missing");
    await expect(store.verify(denis.id)).resolves.toBe("verified");
    expect(await readFile(join(outside, "MODEL_CARD"), "utf8")).toBe("outside");
  });
});
