import type { ModelBackendStatus } from "../../contract";

/** Minimum GA Copilot CLI version validated for JSONL output and tool availability filtering. */
export const COPILOT_CLI_MIN_VERSION = "1.0.0";

export interface ParsedCopilotVersion { raw: string; semver?: string; major?: number; minor?: number; patch?: number; }
const SEMVER_PATTERN = /(\d+)\.(\d+)\.(\d+)/;

export function parseCopilotVersionOutput(output: string): ParsedCopilotVersion | null {
  const raw = output.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!raw) return null;
  const match = raw.match(SEMVER_PATTERN);
  if (!match) return { raw };
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return { raw, semver: `${major}.${minor}.${patch}`, major, minor, patch };
}

function compare(a: ParsedCopilotVersion, b: ParsedCopilotVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    const difference = (a[key] ?? 0) - (b[key] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export interface CopilotVersionEvaluation { supported: boolean; status: ModelBackendStatus; diagnostics: string[]; }

export function evaluateCopilotVersion(version: string | null): CopilotVersionEvaluation {
  if (!version) return { supported: false, status: "installed", diagnostics: ["Copilot CLI is installed, but its version could not be determined."] };
  const parsed = parseCopilotVersionOutput(version);
  if (!parsed?.semver) return { supported: false, status: "installed", diagnostics: [`Copilot CLI version "${parsed?.raw ?? version}" is not recognized; compatibility is unknown.`] };
  const minimum = parseCopilotVersionOutput(COPILOT_CLI_MIN_VERSION)!;
  if (compare(parsed, minimum) < 0) {
    return { supported: false, status: "unsupported_version", diagnostics: [`Copilot CLI ${parsed.semver} is below the minimum supported version ${COPILOT_CLI_MIN_VERSION}.`] };
  }
  return { supported: true, status: "installed", diagnostics: [] };
}
