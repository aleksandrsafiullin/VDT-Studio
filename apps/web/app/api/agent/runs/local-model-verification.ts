export const LOCAL_MODEL_VERIFICATION_TOOLS = [
  "vdt.validate", "vdt.calculate", "vdt.inspect_hierarchy"
] as const;

type VerificationTool = typeof LOCAL_MODEL_VERIFICATION_TOOLS[number];
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);

export interface LocalModelVerificationProgress {
  revision: number;
  completed: VerificationTool[];
  pending: VerificationTool[];
  nextStep: "run_checks" | "request_finish";
}

/** Transport guidance from this run's Gateway results, never a finish receipt
 * or a substitute for the actor's business review and canonical finish gates. */
export class LocalModelVerification {
  private revision: number | undefined;
  private readonly completed = new Set<VerificationTool>();

  observe(delta: unknown, revision: unknown, admittedTools: ReadonlySet<string>) {
    if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
      this.revision = undefined;
      this.completed.clear();
      return;
    }
    if (revision !== this.revision) this.completed.clear();
    this.revision = revision as number;
    this.observeDelta(delta, admittedTools);
  }

  progress(): LocalModelVerificationProgress | undefined {
    if (this.revision === undefined) return undefined;
    const pending = LOCAL_MODEL_VERIFICATION_TOOLS.filter((name) => !this.completed.has(name));
    return { revision: this.revision, completed: LOCAL_MODEL_VERIFICATION_TOOLS.filter((name) => this.completed.has(name)),
      pending, nextStep: pending.length ? "run_checks" : "request_finish" };
  }

  private observeDelta(delta: unknown, admittedTools: ReadonlySet<string>) {
    if (!object(delta)) return;
    if (delta.type === "checkpoint_inputs") {
      this.observeDelta(delta.checkpointDelta, admittedTools);
      if (Array.isArray(delta.inputs) && delta.inputs.some((input) => object(input) && ["user_answer", "user_instruction"].includes(String(input.type)))) this.completed.clear();
      return;
    }
    if (["human_input", "human_inputs", "recovery"].includes(String(delta.type))) { this.completed.clear(); return; }
    // These results may precede a concurrent manual edit; they cannot certify
    // the reconciled graph even when its current revision is already known.
    if (delta.type === "manual_reconciliation") { this.completed.clear(); return; }
    if (delta.type !== "tool_results" || !Array.isArray(delta.results)) return;
    for (const result of delta.results) {
      if (!object(result)) continue;
      if (result.resultCode === "STALE_REVISION" || (object(result.payload) && result.payload.projectChanged === true)) {
        this.completed.clear();
        continue;
      }
      const name = result.toolName as VerificationTool;
      if (!LOCAL_MODEL_VERIFICATION_TOOLS.includes(name) || !admittedTools.has(name)) continue;
      const output = object(result.payload) && object(result.payload.output) ? result.payload.output : undefined;
      const valid = ["succeeded", "replayed"].includes(String(result.status))
        && typeof result.resultHash === "string" && /^sha256:[a-f0-9]{64}$/.test(result.resultHash)
        && output && Array.isArray(output.errors) && output.errors.length === 0
        && (name === "vdt.calculate" ? typeof output.rootValue === "number" && Number.isFinite(output.rootValue) : output.valid === true);
      if (valid) this.completed.add(name); else this.completed.delete(name);
    }
  }
}
