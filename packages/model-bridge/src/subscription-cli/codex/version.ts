import type { ModelBackendStatus } from "../../contract";

/** Minimum Codex CLI semver validated for exec + --json structured output (see provider-compatibility.md). */
export const CODEX_CLI_MIN_VERSION = "0.20.0";

export interface ParsedCodexVersion {
  raw: string;
  semver?: string;
  major?: number;
  minor?: number;
  patch?: number;
}

const SEMVER_PATTERN = /(\d+)\.(\d+)\.(\d+)/;

export function parseCodexVersionOutput(output: string): ParsedCodexVersion | null {
  const raw = output.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!raw) return null;

  const match = raw.match(SEMVER_PATTERN);
  if (!match) return { raw };

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isFinite)) return { raw };

  return { raw, semver: `${major}.${minor}.${patch}`, major, minor, patch };
}

function compareSemver(a: ParsedCodexVersion, b: ParsedCodexVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    const left = a[key] ?? 0;
    const right = b[key] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

export interface CodexVersionEvaluation {
  supported: boolean;
  status: ModelBackendStatus;
  diagnostics: string[];
}

export function evaluateCodexVersion(version: string | null): CodexVersionEvaluation {
  if (!version) {
    return {
      supported: false,
      status: "installed",
      diagnostics: ["Codex CLI is installed, but the version could not be determined."]
    };
  }

  const parsed = parseCodexVersionOutput(version);
  if (!parsed?.semver) {
    return {
      supported: false,
      status: "installed",
      diagnostics: [
        `Codex CLI version "${parsed?.raw ?? version}" is not a recognized semver; compatibility is unknown.`
      ]
    };
  }

  const minimum = parseCodexVersionOutput(CODEX_CLI_MIN_VERSION);
  if (!minimum?.semver) {
    return { supported: true, status: "installed", diagnostics: [] };
  }

  if (compareSemver(parsed, minimum) < 0) {
    return {
      supported: false,
      status: "unsupported_version",
      diagnostics: [`Codex CLI ${parsed.semver} is below the minimum supported version ${CODEX_CLI_MIN_VERSION}.`]
    };
  }

  return { supported: true, status: "installed", diagnostics: [] };
}
