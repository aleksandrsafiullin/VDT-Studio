import { describe, expect, it } from "vitest";
import { EditorHandoffController } from "./editor-handoff-controller";

const origin = { projectId: "project_a", vdtId: "vdt_a", revisionId: "revision_a", draftGeneration: 4 };
const changed = { ...origin, draftGeneration: 5, revisionId: "revision_b" };
const suggestion = { action: "suggested_kpis" as const, nodeId: "hours", projectId: origin.projectId,
  vdtId: origin.vdtId, revisionId: origin.revisionId };
const identity = { runId: "run_a", id: "control_a", handoff: suggestion };
const smart = { kind: "smart" as const, nodeId: "hours", durability: "stored" as const };

describe("editor handoff receipts", () => {
  it("keeps opening pending and accepts only a matched, observed change", () => {
    const controller = new EditorHandoffController();
    const attempt = controller.start(identity, origin)!;
    expect(controller.state(identity.runId, identity.id)).toBe("pending");
    for (const [before, after, effect] of [
      [origin, origin, smart],
      [origin, { ...origin, draftGeneration: 5 }, smart],
      [{ ...origin, revisionId: "stale" }, changed, smart],
      [origin, { ...changed, vdtId: "vdt_b" }, smart],
      [origin, changed, { ...smart, nodeId: "different" }]
    ] as const) expect(attempt.complete(before, after, effect)).toBe(false);
    expect(attempt.complete(origin, changed, smart)).toBe(true);
    expect(controller.state(identity.runId, identity.id)).toEqual(smart);
  });

  it("invalidates cancelled attempts and callbacks replaced by retries", () => {
    const controller = new EditorHandoffController();
    expect(controller.start(identity, { ...origin, revisionId: "stale" })).toBeUndefined();
    const first = controller.start(identity, origin)!;
    first.cancel();
    const second = controller.start(identity, origin)!;
    const third = controller.start(identity, origin)!;
    for (const old of [first, second]) expect(old.complete(origin, changed, smart)).toBe(false);
    expect(third.complete(origin, changed, smart)).toBe(true);
    expect(controller.state("other_run", identity.id)).toBeUndefined();
  });

  it("records portable download initiation without a graph write", () => {
    const controller = new EditorHandoffController();
    const handoff = { action: "vdt_export" as const, projectId: origin.projectId, vdtId: origin.vdtId, revisionId: origin.revisionId };
    const attempt = controller.start({ ...identity, handoff }, origin)!;
    const effect = { kind: "portable_download" as const, format: "md" as const };
    expect(attempt.complete(origin, changed, effect)).toBe(false);
    expect(attempt.complete(origin, origin, effect)).toBe(true);
    expect(controller.state(identity.runId, identity.id)).toEqual(effect);
  });
});
