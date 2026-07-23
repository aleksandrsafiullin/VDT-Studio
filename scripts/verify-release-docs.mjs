import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

const REQUIRED_DOCS = [
  {
    file: "AGENTS.md",
    snippets: ["Documentation Is Part of Every Change", "Documentation impact: none", "pnpm docs:verify"]
  },
  {
    file: "docs/README.md",
    snippets: ["Source-Of-Truth Order", "DATA_INGESTION.md", "AGENTS.md"]
  },
  {
    file: "docs/PRODUCT_SPEC.md",
    snippets: ["Capability Status Summary", "Data and reports", "metadata-only mappings"]
  },
  {
    file: "docs/ARCHITECTURE.md",
    snippets: ["packages/vdt-storage", "packages/data-harness", "Known Architectural Gaps"]
  },
  {
    file: "docs/AI_HARNESS.md",
    snippets: ["18 task contracts", "Current runtime limitations", "search-only"]
  },
  {
    file: "docs/DATA_INGESTION.md",
    snippets: ["metadata only", "4096-byte", "MetricBinding"]
  },
  {
    file: "docs/PRODUCTION_READINESS.md",
    snippets: ["No-Go for production", "3 high vulnerabilities", "P0 Correctness Blockers"]
  },
  {
    file: "docs/ROADMAP.md",
    snippets: ["Wave 0", "Wave 4", "Evidence And Benchmarks"]
  },
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
    snippets: ["Hosted web is API/BYOK only", "UNSAFE_CONFIGURATION", "desktop:native:preflight"]
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
  "clean-machine desktop installation support is available",
  "Source of truth: `Technical Specification for Codex.docx`",
  "Durable SQLite project storage. Current web persistence is browser-local.",
  "High/critical production dependency audit, provider-certification completeness"
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
