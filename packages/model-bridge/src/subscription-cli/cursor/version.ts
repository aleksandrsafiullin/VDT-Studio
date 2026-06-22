import type { ModelBackendStatus } from "../../contract";

/** Minimum Cursor Agent CLI semver validated for stream-json + --print (see provider-compatibility.md). */
export const CURSOR_CLI_MIN_VERSION = "0.45.0";

export interface ParsedCursorVersion {
  raw: string;
  semver?: string;
  major?: number;
  minor?: number;
  patch?: number;
}

const SEMVER_PATTERN = /(\d+)\.(\d+)\.(\d+)/;

export function parseCursorVersionOutput(output: string): ParsedCursorVersion | null {
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

function compareSemver(a: ParsedCursorVersion, b: ParsedCursorVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    const left = a[key] ?? 0;
    const right = b[key] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

export interface CursorVersionEvaluation {
  supported: boolean;
  status: ModelBackendStatus;
  diagnostics: string[];
}

export function evaluateCursorVersion(version: string | null): CursorVersionEvaluation {
  if (!version) {
    return {
      supported: false,
      status: "installed",
      diagnostics: ["Cursor Agent is installed, but the CLI version could not be determined."]
    };
  }

  const parsed = parseCursorVersionOutput(version);
  if (!parsed?.semver) {
    return {
      supported: false,
      status: "installed",
      diagnostics: [
        `Cursor Agent version "${parsed?.raw ?? version}" is not a recognized semver; compatibility is unknown.`
      ]
    };
  }

  const minimum = parseCursorVersionOutput(CURSOR_CLI_MIN_VERSION);
  if (!minimum?.semver) {
    return { supported: true, status: "installed", diagnostics: [] };
  }

  if (compareSemver(parsed, minimum) < 0) {
    return {
      supported: false,
      status: "unsupported_version",
      diagnostics: [
        `Cursor Agent ${parsed.semver} is below the minimum supported version ${CURSOR_CLI_MIN_VERSION}.`
      ]
    };
  }

  return { supported: true, status: "installed", diagnostics: [] };
}
