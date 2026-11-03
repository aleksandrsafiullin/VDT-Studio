import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildKpiSuggestionContext, createSmartKpiMeasuredFixture } from "@vdt-studio/vdt-core";
vi.mock("../app/api/skills/service", () => ({ getVdtSkill: vi.fn() }));
import { getVdtSkill } from "../app/api/skills/service";
import { assertCurrentSmartKpiSkill, readSmartKpiSkill } from "./smart-kpi-skill-host";

const pin = { id: "custom.manufacturing", title: "Factory throughput", version: 7, contentHash: `sha256:${"a".repeat(64)}`, raw: "# Manufacturing\nFollow the process stages." };
beforeEach(() => { vi.mocked(getVdtSkill).mockReset(); vi.mocked(getVdtSkill).mockResolvedValue({ pin } as unknown as Awaited<ReturnType<typeof getVdtSkill>>); });
describe("Smart uses the exact Context skill", () => {
  it("projects the selected pinned content without filesystem/tool authority", async () => {
    expect(await readSmartKpiSkill("project", "vdt", "Output")).toEqual({ id: pin.id, title: pin.title, version: pin.version, contentHash: pin.contentHash, content: pin.raw });
    expect(getVdtSkill).toHaveBeenCalledWith("project", "vdt", "Output");
  });
  it("rejects missing, substituted and obsolete pins instead of silently falling back", async () => {
    const context = await buildKpiSuggestionContext(createSmartKpiMeasuredFixture(0), { workspaceId: "project", vdtId: "vdt", targetNodeId: "measured_output", period: { key: "2026", grain: "year" } });
    await expect(assertCurrentSmartKpiSkill(context)).rejects.toMatchObject({ code: "STALE_SKILL" });
    const selectedSkill = await readSmartKpiSkill("project", "vdt");
    await expect(assertCurrentSmartKpiSkill({ ...context, selectedSkill })).resolves.toBeUndefined();
    await expect(assertCurrentSmartKpiSkill({ ...context, selectedSkill: { ...selectedSkill, content: "unselected text" } })).rejects.toMatchObject({ code: "STALE_SKILL" });
    vi.mocked(getVdtSkill).mockResolvedValue({ pin: { ...pin, version: 8 } } as unknown as Awaited<ReturnType<typeof getVdtSkill>>);
    await expect(assertCurrentSmartKpiSkill({ ...context, selectedSkill })).rejects.toMatchObject({ code: "STALE_SKILL" });
  });
});
