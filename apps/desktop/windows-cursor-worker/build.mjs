import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = path.dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];

if (process.platform !== "win32" || !output || !path.isAbsolute(output)) {
  throw new Error("A Windows host and an absolute worker output directory are required.");
}

const framework = { arm64: "FrameworkArm64", x64: "Framework64" }[process.arch];
const systemRoot = process.env.SystemRoot;
if (!framework || !systemRoot || !path.isAbsolute(systemRoot)) {
  throw new Error("A native Windows ARM64 or x64 .NET Framework compiler is required.");
}

const compiler = path.join(systemRoot, "Microsoft.NET", framework, "v4.0.30319", "csc.exe");
if (!existsSync(compiler)) throw new Error("The native Windows C# compiler is unavailable.");

mkdirSync(output, { recursive: true });
const executable = path.join(output, "vdt-windows-cursor-worker.exe");
const preload = path.join(output, "proxy-preload.cjs");
const nativeSources = ["Program.cs", "PrivateSession.cs", "AppContainerProcess.cs", "DedicatedAuth.cs"];
const compilerOptions = ["/nologo", "/target:exe", "/platform:anycpu", "/optimize+", "/r:System.Web.Extensions.dll"];
const policyInputs = [...nativeSources, "proxy-preload.cjs", "build.mjs"];
const policy = createHash("sha256").update("vdt-windows-cursor-lpac-v2\n");
for (const name of policyInputs) {
  const bytes = readFileSync(path.join(source, name));
  policy.update(`${name}\0${bytes.length}\0`).update(bytes);
}
const policyHash = `sha256:${policy.digest("hex")}`;
const generated = mkdtempSync(path.join(output, "policy-"));
const identitySource = path.join(generated, "StandardPolicy.cs");
try {
  writeFileSync(identitySource,
    `internal static class StandardPolicy { internal const string Identity = "${policyHash}"; }\n`,
    { flag: "wx" });
  execFileSync(compiler, [
    ...compilerOptions, `/out:${executable}`, ...nativeSources.map(name => path.join(source, name)), identitySource
  ], { stdio: "inherit", windowsHide: true });
} finally {
  if (existsSync(identitySource)) unlinkSync(identitySource);
  rmdirSync(generated);
}
copyFileSync(path.join(source, "proxy-preload.cjs"), preload);

const digest = filename => createHash("sha256").update(readFileSync(filename)).digest("hex");
console.log(JSON.stringify({ workerSha256: digest(executable), preloadSha256: digest(preload), policyHash }));
