import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { collectThirdPartyNotices } from "./collect-third-party-notices.mjs";

it("indexes exact upstream bytes deterministically and records packages with no notice files", () => {
  const fixture = mkdtempSync(join(tmpdir(), "vdt-notice-test-"));
  function file(path: string, content: string | Buffer) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  try {
    const store = join(fixture, "node_modules/.pnpm");
    const license = Buffer.from("Copyright © Example\r\nOriginal text\r\n");
    const sha = createHash("sha256").update(license).digest("hex");
    for (const peer of ["alpha", "beta"]) {
      const pkg = join(store, `example@${peer}`, "node_modules/@sample/example");
      file(join(pkg, "package.json"), '{"name":"@sample/example","version":"1.0.0","license":"MIT"}');
      file(join(pkg, "dist/vendor/LICENSE.md"), license);
      file(join(pkg, "license.js"), "Source code is not a notice.");
    }
    file(join(store, "missing", "node_modules/missing/package.json"), '{"name":"missing","version":"1.0.0"}');
    file(join(store, "next-env", "node_modules/@next/env/package.json"), '{"name":"@next/env","version":"15.5.28"}');
    file(join(store, "next-env-old", "node_modules/@next/env/package.json"), '{"name":"@next/env","version":"15.5.27"}');
    const sharp = join(store, "sharp-win", "node_modules/@img/sharp-win32-x64");
    file(join(sharp, "package.json"), '{"name":"@img/sharp-win32-x64","version":"0.35.5"}');
    file(join(sharp, "README.md"), "Upstream Windows licensing table");
    const crate = join(fixture, "crate");
    file(join(crate, "custom-terms"), license);
    const metadata = {
      resolve: { nodes: [{ id: "crate" }] },
      packages: [{ id: "crate", source: "registry", name: "crate", version: "2.0.0", license_file: "custom-terms", manifest_path: join(crate, "Cargo.toml") }]
    };
    const output = join(fixture, "output");
    const repeat = join(fixture, "repeat");
    collectThirdPartyNotices(fixture, output, metadata);
    collectThirdPartyNotices(fixture, repeat, metadata);
    const inventory = readFileSync(join(output, "inventory.json"), "utf8");
    expect(inventory).toBe(readFileSync(join(repeat, "inventory.json"), "utf8"));
    expect(inventory).not.toContain(fixture);
    const packages = JSON.parse(inventory).packages;
    expect(packages.filter((pkg: { name: string }) => !["@next/env", "@img/sharp-win32-x64"].includes(pkg.name))).toEqual([
      { ecosystem: "cargo", name: "crate", version: "2.0.0", license: null, notices: [{ path: "custom-terms", sha256: sha }] },
      { ecosystem: "npm", name: "@sample/example", version: "1.0.0", license: "MIT", notices: [{ path: "dist/vendor/LICENSE.md", sha256: sha }] },
      { ecosystem: "npm", name: "missing", version: "1.0.0", license: null, notices: [] }
    ]);
    const previous = packages.find((pkg: { version: string }) => pkg.version === "15.5.27");
    const current = packages.find((pkg: { version: string }) => pkg.version === "15.5.28");
    expect(previous.notices).toEqual([]);
    expect(current.notices).toHaveLength(3);
    for (const notice of current.notices) {
      expect(notice).toMatchObject({ source: expect.stringMatching(/^https:\/\//), supplemental: true });
      const bytes = readFileSync(join(output, "texts", notice.sha256 + ".txt"));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(notice.sha256);
    }
    const windows = packages.find((pkg: { name: string }) => pkg.name === "@img/sharp-win32-x64");
    expect(windows.notices).toHaveLength(5);
    expect(windows.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "README.md", supplemental: true }),
      expect.objectContaining({ source: expect.stringContaining("/THIRD-PARTY-NOTICES.md") }),
      expect.objectContaining({ source: expect.stringContaining("libvips/libvips/24ad4d042940e6bf99a68871ba886ca8847c9c82/LICENSE") }),
      expect.objectContaining({ source: expect.stringContaining("libnsgif/COPYING") }),
      expect.objectContaining({ source: expect.stringContaining("lovell/sharp-libvips/ebb95f8add54eee8bed840e3fb587e4cbec857d7/LICENSE") })
    ]));
    expect(readdirSync(join(output, "texts"))).toHaveLength(9);
    expect(readFileSync(join(output, "texts", sha + ".txt"))).toEqual(license);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

it("collects hoisted, nested and workspace-local dependencies without following links", () => {
  const fixture = mkdtempSync(join(tmpdir(), "vdt-notice-hoisted-"));
  function pkg(root: string, name: string) {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    writeFileSync(join(root, "LICENSE"), name + " notice");
  }
  try {
    const source = join(fixture, "source");
    const modules = join(source, "node_modules");
    pkg(join(modules, "parent"), "parent");
    pkg(join(modules, "parent/node_modules/@group/nested"), "@group/nested");
    pkg(join(source, "apps/web/node_modules/parent"), "parent");
    pkg(join(source, "packages/core/node_modules/local-dep"), "local-dep");
    pkg(join(source, "packages/core"), "workspace-core");
    pkg(join(fixture, "external"), "external");
    symlinkSync(join(source, "packages/core"), join(modules, "workspace"), "junction");
    symlinkSync(join(fixture, "external"), join(modules, "external"), "junction");
    const output = join(fixture, "output");
    collectThirdPartyNotices(source, output, {
      resolve: { nodes: [{ id: "crate" }] },
      packages: [{ id: "crate", source: "registry", name: "crate", version: "1.0.0", manifest_path: join(modules, "parent/Cargo.toml") }]
    });
    const { packages } = JSON.parse(readFileSync(join(output, "inventory.json"), "utf8"));
    expect(packages.filter((entry: { ecosystem: string }) => entry.ecosystem === "npm").map((entry: { name: string }) => entry.name))
      .toEqual(["@group/nested", "local-dep", "parent"]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
