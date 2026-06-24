import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

const REQUIRED_DOCS = [
  {
    file: "docs/architecture/desktop-local-execution.md",
    snippets: ["reviewed commands", "desktop:verify", "self-contained packaged sidecar binary"]
  },
  {
    file: "docs/architecture/runtime-protocol.md",
    snippets: ["private pipes", "bounded frame size", "startup handshake"]
  },
  {
    file: "docs/security/local-ai-threat-model.md",
    snippets: ["Hosted web mode is API/BYOK only", "UNSAFE_CONFIGURATION", "desktop:native:preflight"]
  },
  {
    file: "docs/provider-compatibility.md",
    snippets: ["Cursor", "Codex", "Claude", "Gemini", "Copilot"]
  },
  {
    file: "docs/desktop-installation.md",
    snippets: [
      "Do not claim clean-machine desktop installation support",
      "Node installation",
      "desktop:native:preflight",
      "cross-platform desktop bundle targets",
      "VDT_DESKTOP_SELF_CONTAINED_SIDECAR"
    ]
  },
  {
    file: "docs/development/standalone-runner.md",
    snippets: ["not the production desktop Local AI user journey", "loopback", "pairing"]
  },
  {
    file: "docs/release-checklist.md",
    snippets: ["pnpm release:verify", "pnpm desktop:native:preflight", "Manual Evidence"]
  }
];

const FORBIDDEN_CLAIMS = [
  "21 agents",
  "MCP control",
  "all providers supported",
  "production-ready desktop installer",
  "clean-machine desktop installation support is available"
];

function fail(message) {
  throw new Error(`Release docs verification failed: ${message}`);
}

export function verifyReleaseDocs(root = DEFAULT_ROOT) {
  const verified = [];
  for (const requirement of REQUIRED_DOCS) {
    let text;
    try {
      text = readFileSync(join(root, requirement.file), "utf8");
    } catch (error) {
      fail(`missing required document ${requirement.file}: ${error instanceof Error ? error.message : String(error)}`);
    }

    for (const snippet of requirement.snippets) {
      if (!text.includes(snippet)) fail(`${requirement.file} is missing required release-doc text: ${snippet}`);
    }

    for (const forbidden of FORBIDDEN_CLAIMS) {
      if (text.includes(forbidden)) fail(`${requirement.file} contains forbidden claim: ${forbidden}`);
    }
    verified.push(requirement.file);
  }

  return { docs: verified };
}

if (process.argv[1] === SCRIPT_PATH) {
  const result = verifyReleaseDocs(DEFAULT_ROOT);
  process.stdout.write(`Release docs verified: ${result.docs.length} documents.\n`);
}
