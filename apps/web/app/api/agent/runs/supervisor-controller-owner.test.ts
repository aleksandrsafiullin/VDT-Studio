import { describe, expect, it } from "vitest";
import { encodeSupervisorProcessOwner, supervisorFenceOwnership, supervisorOwnerDeath, type SupervisorProcessOwner } from "./supervisor-controller-owner";

const owner: SupervisorProcessOwner = { version: 1, machine: "a".repeat(64), boot: "b".repeat(64), pid: 1234, instance: "00000000-0000-4000-a000-000000000001" };

describe("Supervisor owner death proof", () => {
  it("requires ESRCH in the same machine and boot; live, EPERM and unknown errors cannot authorize recovery", () => {
    const token = encodeSupervisorProcessOwner(owner);
    expect(supervisorOwnerDeath(token, owner, () => undefined)).toBe("alive");
    expect(supervisorOwnerDeath(token, owner, () => { throw Object.assign(new Error(), { code: "ESRCH" }); })).toBe("dead");
    for (const code of ["EPERM", "EACCES", "EINVAL"]) {
      expect(supervisorOwnerDeath(token, owner, () => { throw Object.assign(new Error(), { code }); })).toBe("unverified");
    }
    expect(supervisorOwnerDeath(token, owner, () => { throw new Error("unknown"); })).toBe("unverified");
  });

  it("accepts a prior boot only after matching machine identity and rejects malformed or legacy ownership", () => {
    const token = encodeSupervisorProcessOwner(owner);
    const unexpectedProbe = () => { throw new Error("must not probe a PID from another boot"); };
    expect(supervisorOwnerDeath(token, { ...owner, boot: "c".repeat(64) }, unexpectedProbe)).toBe("dead");
    expect(supervisorOwnerDeath(token, { ...owner, machine: "c".repeat(64) }, unexpectedProbe)).toBe("unverified");
    expect(supervisorOwnerDeath(token, null, unexpectedProbe)).toBe("unverified");
    for (const malformed of ["agent-fence:old-uuid", "agent-process-owner:v1:e30", token + ":extra", ""]) {
      expect(supervisorOwnerDeath(malformed, owner, unexpectedProbe)).toBe("unverified");
    }
  });

  it("compares boot evidence only within the native Windows scheme", () => {
    const native = { ...owner, version: 2 as const };
    const token = encodeSupervisorProcessOwner(native);
    const notProbed = () => { throw new Error("A mismatched identity scheme must not probe"); };
    expect(supervisorOwnerDeath(token, { ...owner, boot: "c".repeat(64) }, notProbed)).toBe("unverified");
    expect(supervisorOwnerDeath(encodeSupervisorProcessOwner(owner), native, notProbed)).toBe("unverified");
    expect(supervisorOwnerDeath(token.replace(":v2:", ":v1:"), native, notProbed)).toBe("unverified");
    expect(supervisorOwnerDeath(token, { ...native, machine: "c".repeat(64) }, notProbed)).toBe("unverified");
    expect(supervisorOwnerDeath(token, { ...native, boot: "c".repeat(64) }, notProbed)).toBe("dead");
    expect(supervisorOwnerDeath(token, native, () => undefined)).toBe("alive");
    expect(supervisorOwnerDeath(token, native, () => { throw Object.assign(new Error(), { code: "EPERM" }); })).toBe("unverified");
    expect(supervisorOwnerDeath(token, native, () => { throw Object.assign(new Error(), { code: "ESRCH" }); })).toBe("dead");
    expect(supervisorFenceOwnership(token, owner)).toBe("foreign");
    expect(supervisorFenceOwnership(token, native)).toBe("owned");
  });

  it("keeps per-write fence tokens unique while admitting only the original process instance", () => {
    const first = encodeSupervisorProcessOwner(owner), second = encodeSupervisorProcessOwner(owner);
    expect(first).not.toBe(second);
    expect(supervisorFenceOwnership(first, owner)).toBe("owned");
    expect(supervisorFenceOwnership(second, owner)).toBe("owned");
    expect(supervisorFenceOwnership(first, { ...owner, instance: "00000000-0000-4000-a000-000000000002" })).toBe("foreign");
    expect(supervisorFenceOwnership(first, { ...owner, pid: owner.pid + 1 })).toBe("foreign");
    expect(supervisorFenceOwnership(first, null)).toBe("foreign");
    expect(supervisorFenceOwnership(first + ":malformed", owner)).toBe("foreign");
    expect(supervisorFenceOwnership("unknown-token", owner)).toBe("foreign");
    expect(supervisorFenceOwnership("agent-fence:00000000-0000-4000-a000-000000000001", owner)).toBe("unverified");
  });
});
