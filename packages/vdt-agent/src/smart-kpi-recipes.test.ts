import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkillLibraryFromFs, parseSkillMarkdown } from "./index";
import { projectSmartKpiRecipeCatalog } from "./smart-kpi-recipes";
import { KPI_SUGGESTION_RECIPES } from "@vdt-studio/vdt-core";

describe("canonical audited Smart recipe projection", () => {
  it("matches generated browser projection byte-for-byte and omits partial/generic recipes", async () => {
    const library = await loadSkillLibraryFromFs(resolve("packages/vdt-agent/skills"));
    const catalog = projectSmartKpiRecipeCatalog(library.skills);
    expect(catalog).toEqual(KPI_SUGGESTION_RECIPES);
    expect(catalog.recipes.map(r => r.id)).toEqual(["production.rate_yield", "production.time_losses", "production.time_rate", "revenue.quantity_price_net"]);
    expect(catalog.recipes.every(r => r.skillHash.startsWith("sha256:") && r.recipeHash.startsWith("sha256:"))).toBe(true);
    expect(projectSmartKpiRecipeCatalog([library.byId.get("generic.logical_kpi_decomposition")!].filter(Boolean)).recipes).toEqual([]);
  });
  it("pins exact canonical bytes and rejects partial, duplicate, unknown or numeric-default artifacts", () => {
    const path = resolve("packages/vdt-agent/skills/mining/production-volume.md"), source = readFileSync(path, "utf8");
    const original = projectSmartKpiRecipeCatalog([parseSkillMarkdown(path, source)]);
    const changed = projectSmartKpiRecipeCatalog([parseSkillMarkdown(path, `${source}\n`)]);
    expect(changed.recipes[0]!.skillHash).not.toBe(original.recipes[0]!.skillHash);
    expect(changed.version).not.toBe(original.version);
    const block = /```vdt-smart-recipes\s*\n([\s\S]*?)\n```/m.exec(source)![1]!;
    for (const mutate of [
      (v: any) => { v.recipes[0].children.pop(); },
      (v: any) => { v.recipes[0].children[0].baselineValue = 24; },
      (v: any) => { v.recipes[0].children[0].formula = "1"; },
      (v: any) => { v.recipes.push(v.recipes[0]); },
      (v: any) => { v.extra = "authority"; }
    ]) {
      const value = JSON.parse(block); mutate(value);
      const bad = source.replace(block, JSON.stringify(value));
      expect(() => projectSmartKpiRecipeCatalog([parseSkillMarkdown(path, bad)])).toThrow();
    }
  });
});
