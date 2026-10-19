import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function resolveReleaseDirectory(root, version, override) {
  return override ? resolve(root, override) : join(root, "output/release", `v${version}`);
}

export function claimReleaseDirectory(directory) {
  mkdirSync(directory, { recursive: true });
  if (readdirSync(directory).length > 0) {
    throw new Error(`Release directory is not empty; existing artifacts were preserved. Set VDT_RELEASE_DIR to a new empty directory: ${directory}`);
  }
  const claim = join(directory, ".vdt-release-owner");
  writeFileSync(claim, `${process.pid}\n`, { flag: "wx" });
  return () => unlinkSync(claim);
}
