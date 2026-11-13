import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");
// @eslint/eslintrc is a declared root tool dependency; its YAML parser is
// pinned by the workspace override and is present in every frozen install.
const require = createRequire(import.meta.url);
const { load: parseYaml } = createRequire(require.resolve("@eslint/eslintrc"))("js-yaml");

const BROWSER_E2E_GATES = [
  "pnpm build:web",
  "pnpm exec playwright install --with-deps chromium webkit",
  "pnpm test:e2e",
  "pnpm test:e2e:saved-copy",
  'VDT_E2E_USE_BUILD: "1"'
];

const WORKFLOW_REQUIREMENTS = [
  {
    file: ".github/workflows/quality.yml",
    snippets: ["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm build", "pnpm ci:verify", "pnpm phase7:verify", "pnpm docs:verify", "pnpm evaluation:verify", "pnpm desktop:verify"]
  },
  {
    file: ".github/workflows/e2e.yml",
    snippets: BROWSER_E2E_GATES
  },
  {
    file: ".github/workflows/e2e-desktop.yml",
    snippets: ["pnpm desktop:verify", "scripts/verify-desktop-shell.test.ts", "scripts/verify-desktop-sidecar.test.ts", "scripts/verify-windows-native-runtime.mjs", "packages/vdt-storage/src/storage-platform.test.ts", "packages/vdt-storage/scripts/probe-windows-storage.mjs"]
  },
  {
    file: ".github/workflows/windows-storage-native.yml",
    snippets: ["corepack pnpm install --frozen-lockfile --ignore-scripts", "./.github/scripts/windows-storage-standard-user.ps1"]
  },
  {
    file: ".github/workflows/package.yml",
    snippets: ["pnpm package:alpha", "pnpm release:bundle:verify", "pnpm package:verify"]
  },
  {
    file: ".github/workflows/package-desktop.yml",
    snippets: ["scripts/package-macos-alpha.sh", "pnpm desktop:package:windows", "scripts/verify-native-alpha-artifact.mjs"]
  },
  {
    file: ".github/workflows/security.yml",
    snippets: ["pnpm security:audit", "pnpm certification:verify"]
  },
  {
    file: ".github/workflows/release.yml",
    snippets: [
      "pnpm release:verify",
      ...BROWSER_E2E_GATES,
    ]
  }
];

function fail(message) {
  throw new Error(`CI workflow verification failed: ${message}`);
}

export function verifyCiWorkflows(root = DEFAULT_ROOT) {
  const verified = [];
  for (const requirement of WORKFLOW_REQUIREMENTS) {
    let text;
    try {
      text = readFileSync(join(root, requirement.file), "utf8");
    } catch (error) {
      fail(`missing workflow file ${requirement.file}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const workflow = parseYaml(text);
    const jobs = Object.values(workflow?.jobs ?? {});
    const steps = jobs.flatMap((job) => job.steps ?? []);
    const executable = steps.filter((step) => typeof step.run === "string")
      .map((step) => step.run.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n")).join("\n");
    for (const snippet of requirement.snippets.filter((snippet) => !snippet.startsWith("VDT_E2E_USE_BUILD:"))) {
      if (!executable.includes(snippet)) fail(`${requirement.file} is missing required executable gate: ${snippet}`);
    }
    if (requirement.snippets.some((snippet) => snippet.startsWith("VDT_E2E_USE_BUILD:")) && !steps.some((step) => typeof step.run === "string" && step.run.split("\n").some((line) => /^pnpm test:e2e(?:\s|$)/.test(line.trim())) && String(step.env?.VDT_E2E_USE_BUILD) === "1")) {
      fail(`${requirement.file} must set VDT_E2E_USE_BUILD on the browser test step`);
    }
    if (requirement.file.endsWith("e2e-desktop.yml") || requirement.file.endsWith("/package.yml")) {
      const platforms = jobs.flatMap((job) => job.strategy?.matrix?.os ?? []);
      if (!platforms.includes("macos-15") || !platforms.includes("windows-latest")) fail(`${requirement.file} must cover active Mac and Windows runners`);
    }
    if (requirement.file.endsWith("windows-storage-native.yml")) {
      const triggers = workflow.on ?? {};
      const job = workflow.jobs?.["standard-user-storage"];
      if (!("workflow_dispatch" in triggers) || !("pull_request" in triggers) ||
          "pull_request_target" in triggers || !triggers.push?.branches?.includes("main")) {
        fail("Windows storage must run on pull requests and main and support candidate dispatch");
      }
      if (job?.["runs-on"] !== "windows-latest" || workflow.permissions?.contents !== "read" ||
          job.permissions || steps.some((step) => /\bsecrets\./.test(JSON.stringify(step)))) {
        fail("Windows storage must use a hosted Windows runner with read-only repository access and no secrets");
      }
      if (!steps.some((step) => step.uses?.startsWith("actions/upload-artifact@") && step.if === "always()" &&
          step.with?.path?.includes("VDT_STORAGE_PROBE_EVIDENCE"))) {
        fail("Windows storage must preserve failure evidence");
      }
      const script = readFileSync(join(root, ".github/scripts/windows-storage-standard-user.ps1"), "utf8");
      for (const gate of ["New-LocalUser", "-Credential $credential", "$probe.tokenElevated",
        "$probe.ownerMatchesToken", "$probe.daclProtected", "build-windows-storage-addon.ps1",
        "windows-storage.native.test.ts", "store.windows-native.test.ts",
        "supervisor-controller-owner-native.test.ts", "windows-packaged-bootstrap.native.test.ts",
        "sequence-3-windows-matrix.ts", "sequence-3-windows-matrix-evidence.ts", "cleanup.json"]) {
        if (!script.split("\n").filter(line => !line.trim().startsWith("#")).join("\n").includes(gate)) {
          fail(`Windows storage helper is missing required gate: ${gate}`);
        }
      }
    }
    if (requirement.file.endsWith("package-desktop.yml")) {
      if (!("workflow_dispatch" in (workflow.on ?? {}))) fail("native candidate builds must be explicitly dispatched");
      for (const [name, runner, builder, extension] of [["macos-candidate", "macos-15", "scripts/package-macos-alpha.sh", ".dmg"], ["windows-candidate", "windows-latest", "pnpm desktop:package:windows", ".exe"]]) {
        const job = workflow.jobs?.[name];
        if (job?.["runs-on"] !== runner) fail(`${name} must use ${runner}`);
        const nativeSteps = job.steps ?? [];
        if (!nativeSteps.some((step) => step.run?.includes(builder) && step.run.includes("--allow-unsigned-validation"))) fail(`${name} must execute its native validation builder`);
        if (!nativeSteps.some((step) => step.run?.includes("scripts/verify-native-alpha-artifact.mjs") && step.run.includes("--source-commit") && step.run.includes("github.sha"))) fail(`${name} must verify its produced artifact against the source commit`);
        if (!nativeSteps.some((step) => step.uses?.startsWith("actions/upload-artifact@") && step.if === "always()" && step.with?.path?.includes(extension) && step.with.path.includes(".json"))) fail(`${name} must retain installers and failure diagnostics`);
      }
    }
    if (requirement.file.endsWith("package-desktop.yml") || requirement.file.endsWith("/release.yml")) {
      if (workflow.permissions?.contents !== "read" || jobs.some((job) => job.permissions?.contents === "write") || steps.some((step) => step.uses?.includes("action-gh-release") || /\bgh\s+release\s/.test(step.run ?? ""))) fail(`${requirement.file} must not publish a public release`);
    }
    if (requirement.file.endsWith("/release.yml")) {
      const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@") && step.if === "always()");
      for (const path of ["output/release/v*/vdt-studio-cli-*.tgz", "output/release/v*/SHA256SUMS", "output/release/v*/manifest.json", "output/release/v*/sbom.spdx.json", "output/playwright/", "test-results/"]) {
        if (!upload?.with?.path?.includes(path)) fail(`source release verification must retain ${path}`);
      }
    }
    verified.push(requirement.file);
  }

  return { workflows: verified, scope: "workflow structure only; native installed qualification is separate" };
}

if (process.argv[1] === SCRIPT_PATH) {
  const result = verifyCiWorkflows(DEFAULT_ROOT);
  process.stdout.write(`CI workflows verified: ${result.workflows.length} workflow contracts.\n`);
}
