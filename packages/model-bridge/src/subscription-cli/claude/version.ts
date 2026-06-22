import type { ModelBackendStatus } from "../../contract";

/** Minimum Claude Code semver validated for json + --json-schema output (see provider-compatibility.md). */
export const CLAUDE_CLI_MIN_VERSION = "1.0.0";

export interface ParsedClaudeVersion {
  raw: string;
  semver?: string;
  major?: number;
  minor?: number;
  patch?: number;
}

const SEMVER_PATTERN = /(\d+)\.(\d+)\.(\d+)/;

export function parseClaudeVersionOutput(output: string): ParsedClaudeVersion | null {
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

function compareSemver(a: ParsedClaudeVersion, b: ParsedClaudeVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    const left = a[key] ?? 0;
    const right = b[key] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

export interface ClaudeVersionEvaluation {
  supported: boolean;
  status: ModelBackendStatus;
  diagnostics: string[];
}

export function evaluateClaudeVersion(version: string | null): ClaudeVersionEvaluation {
  if (!version) {
    return {
      supported: false,
      status: "installed",
      diagnostics: ["Claude Code is installed, but the version could not be determined."]
    };
  }

  const parsed = parseClaudeVersionOutput(version);
  if (!parsed?.semver) {
    return {
      supported: false,
      status: "installed",
      diagnostics: [
        `Claude Code version "${parsed?.raw ?? version}" is not a recognized semver; compatibility is unknown.`
      ]
    };
  }

  const minimum = parseClaudeVersionOutput(CLAUDE_CLI_MIN_VERSION);
  if (!minimum?.semver) {
    return { supported: true, status: "installed", diagnostics: [] };
  }

  if (compareSemver(parsed, minimum) < 0) {
    return {
      supported: false,
      status: "unsupported_version",
      diagnostics: [
        `Claude Code ${parsed.semver} is below the minimum supported version ${CLAUDE_CLI_MIN_VERSION}.`
      ]
    };
  }

  return { supported: true, status: "installed", diagnostics: [] };
}
