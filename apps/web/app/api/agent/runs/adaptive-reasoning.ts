/** Host-side reasoning for an explicitly selected Ollama Model Agent binding. */
export type AdaptiveReasoningLevel = boolean | string;

export interface AdaptiveReasoningPolicy {
  readonly start: AdaptiveReasoningLevel;
  readonly repair: AdaptiveReasoningLevel;
}

export interface AdaptiveReasoningReceipt {
  readonly reason: "initial_plan_semantic_repair";
  readonly previousLevel: AdaptiveReasoningLevel;
  readonly effectiveLevel: AdaptiveReasoningLevel;
  readonly result: "valid_plan_proposal" | "unresolved_plan" | "transport_failed" | "aborted";
  readonly elapsedMs: number;
  readonly attempts: number;
  /** Reported prompt and generated token counts. Null means unreported. */
  readonly inputUnits: number | null;
  readonly outputUnits: number | null;
}

const off = [false, "none", "off", "disabled"] as const;
const named = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

export function adaptiveReasoningPolicy(capabilities: {
  parameter: string;
  source: string;
  values: readonly unknown[];
} | undefined): AdaptiveReasoningPolicy | undefined {
  if (capabilities?.parameter !== "think" || capabilities.source !== "provider") return;
  const advertised = capabilities.values;
  const disabled = off.find(value => advertised.includes(value));
  const enabled = named.filter(value => advertised.includes(value));
  // Boolean On is only ordered when the provider supplies no graded levels.
  const levels = [...(disabled === undefined ? [] : [disabled]), ...(enabled.length ? enabled : advertised.includes(true) ? [true] : [])];
  const [start, repair] = levels;
  if (start === undefined || repair === undefined) return;
  return Object.freeze({ start, repair });
}

export function validAdaptiveReasoningPolicy(value: unknown): value is AdaptiveReasoningPolicy {
  if (!value || typeof value !== "object" || !("start" in value) || !("repair" in value) || Object.keys(value).length !== 2) return false;
  const canonical = adaptiveReasoningPolicy({ parameter: "think", source: "provider", values: [value.start, value.repair] });
  return canonical !== undefined && canonical.start === value.start && canonical.repair === value.repair;
}

export const ADAPTIVE_BINDING_PREFIX = "local_model_ollama_adaptive_";
export interface AdaptiveStartScope { readonly projectId: string; readonly vdtId: string }

export function isAdaptiveReasoningOffer(bindingId: string): boolean {
  return bindingId.startsWith(ADAPTIVE_BINDING_PREFIX);
}

export class AdaptiveRunReasoning {
  private used = false;
  private active = false;

  constructor(private readonly policy: AdaptiveReasoningPolicy) {}

  effective(): AdaptiveReasoningLevel {
    return this.active ? this.policy.repair : this.policy.start;
  }

  beginPlanRepair(issues: readonly string[], signal?: AbortSignal): boolean {
    const semanticIssue = issues.some(issue => /^(?:CALCULATION_NEEDS_FACTORS|ROOT_NEEDS_FACTORS|ROOT_CONTEXT_LEAVES_REQUIRE_GROUP|PLAN_INPUT_HAS_CHILDREN|PLAN_FACTOR_PARENT_NOT_CALCULATED|PLAN_CYCLE):/.test(issue));
    if (this.used || signal?.aborted || !semanticIssue) return false;
    this.used = true;
    this.active = true;
    return true;
  }

  finishPlanRepair(): void {
    this.active = false;
  }

}
