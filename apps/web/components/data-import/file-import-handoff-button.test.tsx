import { afterEach, describe, expect, it, vi } from "vitest";
import { FileImportHandoffButton } from "./file-import-handoff-button";
import { FILE_IMPORT_REQUEST_EVENT } from "./import-context";

const { state } = vi.hoisted(() => ({
  state: {
    selectedNodeId: "selected" as string | undefined,
    project: {
      rootNodeId: "root",
      graph: { nodes: [{ id: "root", name: "Root" }, { id: "selected", name: "Selection" }, { id: "pinned", name: "Pinned" }] }
    }
  }
}));
vi.mock("@/components/vdt/vdt-store", () => ({
  useVdtStudioStore: (select: (value: typeof state) => unknown) => select(state)
}));

afterEach(() => {
  vi.unstubAllGlobals();
  state.selectedNodeId = "selected";
});

describe("chat file import handoff", () => {
  it.each([
    ["pinned", "selected", "pinned"],
    [undefined, "selected", "selected"],
    [undefined, undefined, "root"]
  ])("opens the shared wizard for target %s with selection %s only after a click", (nodeId, selection, expectedTarget) => {
    state.selectedNodeId = selection;
    const events = new EventTarget();
    const listener = vi.fn();
    vi.stubGlobal("window", events);
    events.addEventListener(FILE_IMPORT_REQUEST_EVENT, listener);

    const button = FileImportHandoffButton(nodeId === undefined ? {} : { nodeId });
    expect(listener).not.toHaveBeenCalled();
    button.props.onClick();
    expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      detail: { targetNodeId: expectedTarget, source: "agent_composer_attachment" }
    }));
  });

  it("does not fall back to the selection if an explicitly targeted KPI has disappeared", () => {
    const unavailable = FileImportHandoffButton({ nodeId: "removed" });
    expect(unavailable.props.children).toBe("The target KPI is no longer available.");
    expect(unavailable.props.onClick).toBeUndefined();
  });
});
