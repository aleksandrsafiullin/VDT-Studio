import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32" || process.arch !== "x64") {
  console.error("Windows native runtime checks require Windows x64 (native or explicitly recorded emulation).");
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.env.VDT_NATIVE_CHECK_DIR || join(root, "output/release/windows-native-checks"));
mkdirSync(output, { recursive: true });
const stage = mkdtempSync(join(output, "owned-"));
writeFileSync(join(stage, ".owned"), "vdt-windows-native-checks");
try {
  const env = { ...process.env, CARGO_TARGET_DIR: join(stage, "target"),
    VDT_TEST_NODE: process.execPath, VDT_TEST_WINDOWS_RUNTIME: join(root, "apps/desktop/windows-runtime.cjs"),
    TMPDIR: stage, TMP: stage, TEMP: stage };
  execFileSync("cargo", ["test", "--locked", "--manifest-path", join(root, "apps/desktop/native-checks/Cargo.toml"),
    "--target", "x86_64-pc-windows-msvc", "--", "--test-threads=1"], { cwd: root, env, stdio: "inherit", windowsHide: true });
} finally {
  if (readFileSync(join(stage, ".owned"), "utf8") === "vdt-windows-native-checks" && dirname(stage) === output) {
    rmSync(stage, { recursive: true, force: true });
  }
}
