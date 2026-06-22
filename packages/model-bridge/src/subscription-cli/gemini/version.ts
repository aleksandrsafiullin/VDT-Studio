import type { ModelBackendStatus } from "../../contract";

/** Minimum Gemini CLI version validated for headless JSON and policy-engine tool denial. */
export const GEMINI_CLI_MIN_VERSION = "0.43.0";

export interface ParsedGeminiVersion {
  raw: string;
  semver?: string;
  major?: number;
  minor?: number;
  patch?: number;
}

const SEMVER_PATTERN = /(\d+)\.(\d+)\.(\d+)/;

export function parseGeminiVersionOutput(output: string): ParsedGeminiVersion | null {
  const raw = output.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!raw) return null;
  const match = raw.match(SEMVER_PATTERN);
  if (!match) return { raw };
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return { raw, semver: `${major}.${minor}.${patch}`, major, minor, patch };
}

function compare(a: ParsedGeminiVersion, b: ParsedGeminiVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    const difference = (a[key] ?? 0) - (b[key] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export interface GeminiVersionEvaluation {
  supported: boolean;
  status: ModelBackendStatus;
  diagnostics: string[];
}

export function evaluateGeminiVersion(version: string | null): GeminiVersionEvaluation {
  if (!version) {
    return { supported: false, status: "installed", diagnostics: ["Gemini CLI is installed, but its version could not be determined."] };
  }
  const parsed = parseGeminiVersionOutput(version);
  if (!parsed?.semver) {
    return { supported: false, status: "installed", diagnostics: [`Gemini CLI version "${parsed?.raw ?? version}" is not recognized; compatibility is unknown.`] };
  }
  const minimum = parseGeminiVersionOutput(GEMINI_CLI_MIN_VERSION)!;
  if (compare(parsed, minimum) < 0) {
    return { supported: false, status: "unsupported_version", diagnostics: [`Gemini CLI ${parsed.semver} is below the minimum supported version ${GEMINI_CLI_MIN_VERSION}.`] };
  }
  return { supported: true, status: "installed", diagnostics: [] };
}
