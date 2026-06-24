import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

const WORKFLOW_REQUIREMENTS = [
  {
    file: ".github/workflows/quality.yml",
    snippets: ["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm build", "pnpm ci:verify", "pnpm phase7:verify", "pnpm docs:verify", "pnpm evaluation:verify", "pnpm desktop:verify"]
  },
  {
    file: ".github/workflows/e2e.yml",
    snippets: ["pnpm exec playwright install --with-deps chromium webkit", "pnpm test:e2e"]
  },
  {
    file: ".github/workflows/e2e-desktop.yml",
    snippets: ["macos-14", "windows-latest", "pnpm desktop:verify", "scripts/verify-desktop-shell.test.ts", "scripts/verify-desktop-sidecar.test.ts"]
  },
  {
    file: ".github/workflows/package.yml",
    snippets: ["ubuntu-latest", "macos-14", "windows-latest", "pnpm package:alpha", "pnpm release:bundle:verify", "pnpm package:verify"]
  },
  {
    file: ".github/workflows/package-desktop.yml",
    snippets: ["workflow_dispatch", "macos-14", "windows-latest", "pnpm desktop:sidecar:prepare", "pnpm desktop:verify", "pnpm desktop:native:preflight"]
  },
  {
    file: ".github/workflows/security.yml",
    snippets: ["pnpm security:audit", "pnpm certification:verify"]
  },
  {
    file: ".github/workflows/release.yml",
    snippets: [
      "pnpm release:verify",
      "pnpm test:e2e",
      "output/release/v*/vdt-studio-cli-*.tgz",
      "output/release/v*/SHA256SUMS",
      "output/release/v*/manifest.json",
      "output/release/v*/sbom.spdx.json"
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

    for (const snippet of requirement.snippets) {
      if (!text.includes(snippet)) fail(`${requirement.file} is missing required gate: ${snippet}`);
    }
    verified.push(requirement.file);
  }

  return { workflows: verified };
}

if (process.argv[1] === SCRIPT_PATH) {
  const result = verifyCiWorkflows(DEFAULT_ROOT);
  process.stdout.write(`CI workflows verified: ${result.workflows.length} workflow contracts.\n`);
}
