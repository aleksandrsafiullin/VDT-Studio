import type { ExecFileOptionsWithStringEncoding } from "node:child_process";
import type { ModelBackendDetectionResult } from "../contract";
import type { SubscriptionCliId } from "../detection";
import type { VdtSchemaId } from "../schema-registry";

export type ExecFileProbe = (
  executable: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding
) => Promise<{ stdout: string; stderr: string }>;

export interface SubscriptionCliBuildArgsInput {
  model?: string;
  promptPath?: string;
  promptText?: string;
  schemaPath?: string;
  outputPath?: string;
}

export interface SubscriptionCliSpawnHints {
  readonly stdin?: "prompt";
}

export interface SubscriptionCliParseResult {
  output: unknown;
  rawText?: string;
  error?: string;
}

export interface SubscriptionCliAdapter {
  readonly id: SubscriptionCliId;
  readonly backendId: string;
  readonly spawnHints?: SubscriptionCliSpawnHints;
  buildArgs(input: SubscriptionCliBuildArgsInput): readonly string[];
  parseOutput(stdout: string, stderr: string, schemaId: VdtSchemaId): unknown;
  probeAuth?(executable: string, signal?: AbortSignal): Promise<ModelBackendDetectionResult>;
}
