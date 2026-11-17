import { expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ execFileSync: vi.fn(), getWindowsSupervisorIdentity: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: calls.execFileSync }));
vi.mock("@vdt-studio/storage", () => ({ getWindowsSupervisorIdentity: calls.getWindowsSupervisorIdentity }));

it("does not rerun a failed macOS subprocess when issuing later audit fences", async () => {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...original, value: "darwin" });
  calls.execFileSync.mockImplementation(() => { throw new Error("identity probe timed out"); });
  try {
    const { supervisorControllerFenceToken } = await import("./supervisor-controller-owner");
    expect(supervisorControllerFenceToken()).toMatch(/^agent-fence:/);
    expect(supervisorControllerFenceToken()).toMatch(/^agent-fence:/);
    expect(calls.execFileSync).toHaveBeenCalledTimes(1);
    expect(calls.getWindowsSupervisorIdentity).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
});
