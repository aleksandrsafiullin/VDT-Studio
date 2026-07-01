import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}));

function installLocalStorageStub() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    }
  });
}

describe("VdtStudioApp project mode", () => {
  beforeEach(() => {
    vi.resetModules();
    installLocalStorageStub();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows project management without VDT editor surfaces", async () => {
    const { VdtStudioApp } = await import("./vdt-studio-app");

    const html = renderToStaticMarkup(<VdtStudioApp projectId="project_mode_test" />);

    expect(html).toContain('data-testid="workspace-mode-project"');
    expect(html).toContain('data-testid="workspace-mode-vdt"');
    expect(html).toContain("disabled");
    expect(html).toContain("Project management");
    expect(html).toContain("Project workspace");
    expect(html).toContain("No saved project selected");
    expect(html).toContain("No project selected");
    expect(html).not.toContain("VDT Agent");
    expect(html).not.toContain("Current brief");
  });
});
