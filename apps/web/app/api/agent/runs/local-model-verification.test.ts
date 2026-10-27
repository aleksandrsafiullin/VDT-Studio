import { describe, expect, it } from "vitest";
import { LocalModelVerification, LOCAL_MODEL_VERIFICATION_TOOLS } from "./local-model-verification";

const admitted = new Set<string>(LOCAL_MODEL_VERIFICATION_TOOLS);
const hash = `sha256:${"a".repeat(64)}`;
const result = (toolName: string, output: unknown = toolName === "vdt.calculate" ? { rootValue: 2000, errors: [] } : { valid: true, errors: [] }) => ({
  toolName, status: "succeeded", resultHash: hash, payload: { output }
});
const checks = () => LOCAL_MODEL_VERIFICATION_TOOLS.map((name) => result(name));
const delta = (results: unknown[]) => ({ type: "tool_results", results });

describe("local model verification progress", () => {
  it("retains only successful current-revision Gateway checks, including replayed receipts", () => {
    const progress = new LocalModelVerification();
    progress.observe(delta([result("vdt.validate")]), 5, admitted);
    expect(progress.progress()).toMatchObject({ revision: 5, completed: ["vdt.validate"], nextStep: "run_checks" });
    progress.observe(delta([{ ...result("vdt.calculate"), status: "replayed" }, result("vdt.inspect_hierarchy")]), 5, admitted);
    expect(progress.progress()).toMatchObject({ completed: LOCAL_MODEL_VERIFICATION_TOOLS, pending: [], nextStep: "request_finish" });
    progress.observe(delta([]), 6, admitted);
    expect(progress.progress()).toMatchObject({ revision: 6, completed: [], pending: LOCAL_MODEL_VERIFICATION_TOOLS });
    progress.observe(delta(checks()), undefined, admitted);
    expect(progress.progress()).toBeUndefined();
  });

  it.each([
    { type: "human_input", input: { type: "user_answer" } },
    { type: "human_inputs", inputs: [{ type: "user_instruction" }] },
    { type: "checkpoint_inputs", checkpointDelta: delta(checks()), inputs: [{ type: "user_instruction" }] },
    { type: "manual_reconciliation", results: checks(), reconciliation: {} },
    { type: "recovery", checkpoint: {} },
    delta([{ toolName: "vdt.update_node", resultCode: "STALE_REVISION" }])
  ])("rechecks after new user intent, reconciliation, recovery or a stale revision: $type", (input) => {
    const progress = new LocalModelVerification();
    progress.observe(delta(checks()), 5, admitted);
    progress.observe(input, 5, admitted);
    expect(progress.progress()).toMatchObject({ completed: [], pending: LOCAL_MODEL_VERIFICATION_TOOLS });
  });

  it("counts checks only after the last mutation in a mixed batch", () => {
    const progress = new LocalModelVerification();
    const mutation = { toolName: "vdt.set_formula", status: "succeeded", payload: { projectChanged: true } };
    progress.observe(delta([...checks(), mutation, result("vdt.calculate")]), 6, admitted);
    expect(progress.progress()).toMatchObject({ completed: ["vdt.calculate"], pending: ["vdt.validate", "vdt.inspect_hierarchy"] });
    progress.observe(delta([mutation, ...checks()]), 7, admitted);
    expect(progress.progress()).toMatchObject({ pending: [], nextStep: "request_finish" });
  });

  it("rejects missing receipts, failures, invalid graphs and non-finite calculations", () => {
    const invalid = [
      { ...result("vdt.validate"), resultHash: undefined },
      { ...result("vdt.validate"), status: "failed" },
      result("vdt.validate", { valid: false, errors: [] }),
      result("vdt.inspect_hierarchy", { valid: true, errors: [{ code: "HIERARCHY_INCOMPLETE" }] }),
      result("vdt.calculate", { rootValue: null, errors: [] }),
      result("vdt.calculate", { rootValue: Infinity, errors: [] }),
      result("vdt.calculate", { rootValue: 2000, errors: [{ code: "MISSING_INPUT" }] })
    ];
    for (const failed of invalid) {
      const progress = new LocalModelVerification();
      progress.observe(delta(checks()), 5, admitted);
      progress.observe(delta([failed]), 5, admitted);
      expect(progress.progress()?.pending).toEqual([failed.toolName]);
    }
    const unadmitted = new LocalModelVerification();
    unadmitted.observe(delta(checks()), 5, new Set());
    expect(unadmitted.progress()?.completed).toEqual([]);
  });
});
