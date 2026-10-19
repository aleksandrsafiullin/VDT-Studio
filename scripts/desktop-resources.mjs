import { createHash } from "node:crypto";
import { cpSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

export function isPlatformMetadata(path) {
  const name = basename(path);
  return name === ".DS_Store" || name.startsWith("._") || name === "Thumbs.db" || name === "desktop.ini";
}

export function directorySha256(directory) {
  const hash = createHash("sha256");
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (isPlatformMetadata(path)) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        hash.update(relative(directory, path).replaceAll("\\", "/"));
        hash.update("\0");
        hash.update(readFileSync(path));
        hash.update("\0");
      } else {
        throw new Error(`Desktop skill resources must contain only regular files and directories: ${path}`);
      }
    }
  };
  walk(directory);
  return hash.digest("hex");
}

export function copySkillLibrary(source, destination) {
  // Preserve existing files; unexpected stale product resources fail closed
  // instead of recursively deleting a pre-existing directory during a build.
  cpSync(source, destination, { recursive: true, filter: (path) => !isPlatformMetadata(path) });
  if (directorySha256(source) !== directorySha256(destination)) {
    throw new Error("Generated desktop skills contain unexpected product files; review the resource directory before removing stale files.");
  }
}
