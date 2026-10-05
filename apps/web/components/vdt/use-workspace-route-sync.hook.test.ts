import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VdtWorkspaceState } from "./vdt-store";

// The Node test runner has no DOM renderer. This small scheduler preserves the
// relevant lifecycle contract: all effects see one render snapshot, and a
// synchronous store update rerenders only after that effect batch completes.
// Browser E2E coverage remains the authority for real React/Next navigation.
const harness = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: readonly unknown[] | undefined; cleanup?: (() => void) | undefined };
  const runtime = {
    slots: [] as Slot[],
    cursor: 0,
    effects: [] as Array<() => void>,
    dirty: false,
    hook: undefined as (() => unknown) | undefined,
    result: undefined as unknown,
    params: new URLSearchParams(),
    navigations: [] as string[],
    store: {} as {
      workspace: VdtWorkspaceState;
      refreshWorkspace: ReturnType<typeof vi.fn>;
      selectWorkspaceProject: ReturnType<typeof vi.fn>;
      selectWorkspaceVdt: ReturnType<typeof vi.fn>;
      closeWorkspaceVdtEditor: ReturnType<typeof vi.fn>;
    },
    router: { push: vi.fn(), replace: vi.fn() }
  };
  const nextSlot = () => runtime.slots[runtime.cursor++] ?? (runtime.slots[runtime.cursor - 1] = {});
  const changed = (previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined) =>
    !previous || !next || previous.length !== next.length || next.some((value, index) => !Object.is(value, previous[index]));
  const updateWorkspace = (update: Partial<VdtWorkspaceState>) => {
    runtime.store.workspace = { ...runtime.store.workspace, ...update };
    runtime.dirty = true;
  };
  const render = () => {
    let count = 0;
    while (runtime.dirty) {
      if (++count > 30) throw new Error("Hook did not settle within 30 renders.");
      runtime.dirty = false;
      runtime.cursor = 0;
      runtime.result = runtime.hook!();
      const effects = runtime.effects.splice(0);
      for (const effect of effects) effect();
    }
  };
  const flush = async () => {
    for (let index = 0; index < 16; index++) {
      await Promise.resolve();
      render();
    }
  };
  const setRoute = (vdtId?: string) => {
    runtime.params = new URLSearchParams(vdtId ? { vdt: vdtId } : {});
    runtime.dirty = true;
    render();
  };
  const commitNavigation = () => {
    const destination = runtime.navigations.at(-1);
    if (!destination) throw new Error("No queued navigation to commit.");
    runtime.navigations = [];
    runtime.params = new URL(destination, "http://localhost").searchParams;
    runtime.dirty = true;
    render();
  };
  return {
    runtime,
    render,
    flush,
    setRoute,
    commitNavigation,
    updateWorkspace,
    reset: (workspace: Partial<VdtWorkspaceState> = {}, vdtId?: string) => {
      runtime.slots = [];
      runtime.cursor = 0;
      runtime.effects = [];
      runtime.dirty = true;
      runtime.navigations = [];
      runtime.params = new URLSearchParams(vdtId ? { vdt: vdtId } : {});
      runtime.router.push = vi.fn((url: string) => { runtime.navigations.push(url); });
      runtime.router.replace = vi.fn((url: string) => { runtime.navigations.push(url); });
      runtime.store = {
        workspace: {
          activePanel: "project",
          activeProjectId: "project_a",
          projectSummaries: [],
          isLoading: false,
          isMutating: false,
          ...workspace
        },
        refreshWorkspace: vi.fn(async () => {}),
        selectWorkspaceProject: vi.fn(async (projectId: string) => {
          updateWorkspace({ activeProjectId: projectId, activePanel: "project" });
          return true;
        }),
        selectWorkspaceVdt: vi.fn(async (nextVdt: string) => {
          updateWorkspace({ activeVdtId: nextVdt, activePanel: "vdt", isLoading: false });
          return true;
        }),
        closeWorkspaceVdtEditor: vi.fn(() => {
          updateWorkspace({ activeVdtId: undefined, activePanel: "project" });
        })
      };
    },
    hooks: {
      useRef: <T>(initial: T) => {
        const slot = nextSlot();
        slot.value ??= { current: initial };
        return slot.value as { current: T };
      },
      useState: <T>(initial: T | (() => T)) => {
        const slot = nextSlot();
        if (!("value" in slot)) slot.value = typeof initial === "function" ? (initial as () => T)() : initial;
        return [slot.value, (next: T | ((previous: T) => T)) => {
          const value = typeof next === "function" ? (next as (previous: T) => T)(slot.value as T) : next;
          if (!Object.is(value, slot.value)) { slot.value = value; runtime.dirty = true; }
        }] as const;
      },
      useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
        const slot = nextSlot();
        if (changed(slot.deps, deps)) {
          slot.deps = deps;
          runtime.effects.push(() => {
            slot.cleanup?.();
            slot.cleanup = effect() || undefined;
          });
        }
      },
      useCallback: <T>(callback: T, deps: readonly unknown[]) => {
        const slot = nextSlot();
        if (changed(slot.deps, deps)) { slot.deps = deps; slot.value = callback; }
        return slot.value as T;
      }
    }
  };
});

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  ...harness.hooks
}));
vi.mock("next/navigation", () => ({
  useRouter: () => harness.runtime.router,
  useSearchParams: () => harness.runtime.params
}));
vi.mock("./vdt-store", () => ({
  useVdtStudioStore: Object.assign(
    (selector: (state: typeof harness.runtime.store) => unknown) => selector(harness.runtime.store),
    { getState: () => harness.runtime.store }
  )
}));

const { useWorkspaceRouteSync } = await import("./use-workspace-route-sync");
type HookActions = ReturnType<typeof useWorkspaceRouteSync>;
function useTestHook() {
  return useWorkspaceRouteSync("project_a");
}
const actions = () => harness.runtime.result as HookActions;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
async function mountEditor() {
  harness.reset({ activePanel: "vdt", activeVdtId: "vdt_a" }, "vdt_a");
  harness.render();
  await harness.flush();
  harness.runtime.router.push.mockClear();
  harness.runtime.router.replace.mockClear();
  harness.runtime.store.selectWorkspaceVdt.mockClear();
  harness.runtime.store.closeWorkspaceVdtEditor.mockClear();
}

describe("useWorkspaceRouteSync navigation lifecycle", () => {
  beforeEach(() => { harness.runtime.hook = useTestHook; });

  it("keeps a route-only Back link in project mode without replacing the removed query", async () => {
    await mountEditor();

    harness.setRoute();
    await harness.flush();

    expect(harness.runtime.store.workspace.activePanel).toBe("project");
    expect(harness.runtime.store.selectWorkspaceVdt).not.toHaveBeenCalled();
    expect(harness.runtime.router.replace).not.toHaveBeenCalled();
  });

  it("keeps browser Forward's query while the requested VDT is loading", async () => {
    harness.reset();
    harness.render();
    await harness.flush();
    const selection = deferred<boolean>();
    harness.runtime.store.selectWorkspaceVdt.mockImplementation(async (vdtId: string) => {
      harness.updateWorkspace({ activePanel: "vdt", isLoading: true });
      const selected = await selection.promise;
      harness.updateWorkspace({ activePanel: "vdt", activeVdtId: vdtId, isLoading: false });
      return selected;
    });

    harness.setRoute("vdt_a");
    await harness.flush();
    expect(harness.runtime.router.replace).not.toHaveBeenCalled();
    expect(harness.runtime.store.selectWorkspaceVdt).toHaveBeenCalledTimes(1);

    selection.resolve(true);
    await harness.flush();
    expect(harness.runtime.store.workspace.activeVdtId).toBe("vdt_a");
    expect(harness.runtime.router.replace).not.toHaveBeenCalled();
  });

  it("holds project-mode navigation until push commits, so the stale query cannot reopen the editor", async () => {
    await mountEditor();

    actions().showProjectWorkspace();
    harness.render();
    await harness.flush();

    expect(harness.runtime.router.push).toHaveBeenCalledWith("/projects/project_a");
    expect(harness.runtime.store.workspace.activePanel).toBe("project");
    expect(harness.runtime.store.selectWorkspaceVdt).not.toHaveBeenCalled();
    expect(harness.runtime.router.replace).not.toHaveBeenCalled();

    harness.commitNavigation();
    await harness.flush();
    expect(harness.runtime.store.workspace.activePanel).toBe("project");
    expect(harness.runtime.store.selectWorkspaceVdt).not.toHaveBeenCalled();
  });

  it("honors browser Back when an earlier Forward selection resolves afterward", async () => {
    harness.reset();
    harness.render();
    await harness.flush();
    const selection = deferred<boolean>();
    harness.runtime.store.selectWorkspaceVdt.mockImplementation(async (vdtId: string) => {
      const selected = await selection.promise;
      harness.updateWorkspace({ activePanel: "vdt", activeVdtId: vdtId });
      return selected;
    });

    harness.setRoute("vdt_a");
    harness.setRoute();
    selection.resolve(true);
    await harness.flush();

    expect(harness.runtime.store.workspace.activePanel).toBe("project");
    expect(harness.runtime.store.workspace.activeVdtId).toBeUndefined();
    expect(harness.runtime.router.replace).not.toHaveBeenCalled();
  });

  it("preserves the current editor and restores its query when selection fails", async () => {
    await mountEditor();
    harness.runtime.store.selectWorkspaceVdt.mockResolvedValueOnce(false);

    harness.setRoute("vdt_missing");
    await harness.flush();

    expect(harness.runtime.store.workspace.activePanel).toBe("vdt");
    expect(harness.runtime.store.workspace.activeVdtId).toBe("vdt_a");
    expect(harness.runtime.router.replace).toHaveBeenCalledTimes(1);
    expect(harness.runtime.router.replace).toHaveBeenCalledWith("/projects/project_a?vdt=vdt_a", { scroll: false });
    harness.commitNavigation();
    await harness.flush();
    expect(harness.runtime.store.selectWorkspaceVdt).toHaveBeenCalledTimes(1);
    expect(harness.runtime.router.replace).toHaveBeenCalledTimes(1);
  });

  it("removes a failed query once when no existing editor can be restored", async () => {
    harness.reset();
    harness.render();
    await harness.flush();
    const selection = deferred<boolean>();
    harness.runtime.store.selectWorkspaceVdt.mockImplementation(() => selection.promise);

    harness.setRoute("vdt_missing");
    await harness.flush();
    expect(harness.runtime.router.replace).not.toHaveBeenCalled();
    selection.resolve(false);
    await harness.flush();

    expect(harness.runtime.store.workspace.activePanel).toBe("project");
    expect(harness.runtime.router.replace).toHaveBeenCalledTimes(1);
    expect(harness.runtime.router.replace).toHaveBeenCalledWith("/projects/project_a", { scroll: false });
    harness.commitNavigation();
    await harness.flush();
    expect(harness.runtime.store.selectWorkspaceVdt).toHaveBeenCalledTimes(1);
    expect(harness.runtime.router.replace).toHaveBeenCalledTimes(1);
  });

  it("holds editor-opening navigation until push commits without duplicating it with replace", async () => {
    harness.reset();
    harness.render();
    await harness.flush();

    await actions().openWorkspaceVdt("vdt_a");
    harness.render();
    await harness.flush();

    expect(harness.runtime.router.push).toHaveBeenCalledWith("/projects/project_a?vdt=vdt_a");
    expect(harness.runtime.router.replace).not.toHaveBeenCalled();

    harness.commitNavigation();
    await harness.flush();
    expect(harness.runtime.store.workspace.activeVdtId).toBe("vdt_a");
    expect(harness.runtime.store.selectWorkspaceVdt).toHaveBeenCalledTimes(1);
    expect(harness.runtime.router.replace).not.toHaveBeenCalled();
  });

  it("accepts a newer browser route when a pending push is superseded", async () => {
    harness.reset();
    harness.render();
    await harness.flush();
    await actions().openWorkspaceVdt("vdt_a");
    harness.render();
    await harness.flush();

    // A browser history navigation can cancel Next.js's pending URL commit.
    harness.runtime.navigations = [];
    harness.setRoute("vdt_b");
    await harness.flush();

    expect(harness.runtime.store.workspace.activeVdtId).toBe("vdt_b");
    expect(harness.runtime.store.selectWorkspaceVdt).toHaveBeenCalledTimes(2);
    expect(harness.runtime.router.replace).not.toHaveBeenCalled();
  });

  it("reconciles the latest query after asynchronous bootstrap completes without a store update", async () => {
    harness.reset();
    const refresh = deferred<void>();
    harness.runtime.store.refreshWorkspace.mockImplementation(() => refresh.promise);
    harness.render();
    harness.setRoute("vdt_a");
    await harness.flush();
    expect(harness.runtime.store.selectWorkspaceVdt).not.toHaveBeenCalled();

    refresh.resolve();
    await harness.flush();

    expect(harness.runtime.store.workspace.activeVdtId).toBe("vdt_a");
    expect(harness.runtime.store.selectWorkspaceVdt).toHaveBeenCalledTimes(1);
    expect(harness.runtime.router.replace).not.toHaveBeenCalled();
  });

  it("adds the query for a newly created local VDT when the route has not changed", async () => {
    harness.reset();
    harness.render();
    await harness.flush();
    harness.runtime.store.selectWorkspaceVdt.mockClear();

    harness.updateWorkspace({ activePanel: "vdt", activeVdtId: "vdt_created" });
    harness.render();
    await harness.flush();

    expect(harness.runtime.router.replace).toHaveBeenCalledTimes(1);
    expect(harness.runtime.router.replace).toHaveBeenCalledWith("/projects/project_a?vdt=vdt_created", { scroll: false });
    expect(harness.runtime.store.selectWorkspaceVdt).not.toHaveBeenCalled();
    harness.commitNavigation();
    await harness.flush();
    expect(harness.runtime.store.workspace.activeVdtId).toBe("vdt_created");
    expect(harness.runtime.router.replace).toHaveBeenCalledTimes(1);
  });
});
