import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSkillRecipe, initialDriversFromRecipes, loadSkillLibraryFromFs } from "./index";

const skillsRoot = join(dirname(dirname(fileURLToPath(import.meta.url))), "skills");

describe("skill recipes", () => {
  it("compiles structured recipes for every seeded skill", async () => {
    const library = await loadSkillLibraryFromFs(skillsRoot);
    const recipes = library.skills.map((skill) => compileSkillRecipe(skill));

    expect(recipes.map((recipe) => recipe.skillId).sort()).toEqual([
      "finance.revenue_profit",
      "generic.logical_kpi_decomposition",
      "mining.block_preparation_dozer",
      "mining.drill_and_blast",
      "mining.excavation",
      "mining.haulage_truck_cycle",
      "mining.material_allocation_ore_waste",
      "mining.mine_production_system",
      "mining.production_volume",
      "mining.underground_production_cycle",
      "saas.funnel_growth"
    ]);
    expect(recipes.every((recipe) => recipe.requiredInputs.length > 0)).toBe(true);
    expect(recipes.every((recipe) => recipe.initialDrivers.length > 0)).toBe(true);
    expect(recipes.every((recipe) => recipe.recipeQuality !== "missing")).toBe(true);
    expect(recipes.every((recipe) => recipe.recipeSource === "template")).toBe(true);
    expect(recipes.find((recipe) => recipe.skillId === "mining.mine_production_system")?.formulaTemplates).toEqual([]);
    expect(recipes.find((recipe) => recipe.skillId === "mining.mine_production_system")?.warnings.join(" ")).toContain("min(stage_readiness_tonnes, downstream_capacity_tonnes)");
  });

  it("provides deterministic first-level mining drivers", async () => {
    const library = await loadSkillLibraryFromFs(skillsRoot);
    const skill = library.byId.get("mining.production_volume");
    expect(skill).toBeDefined();

    const drivers = initialDriversFromRecipes([compileSkillRecipe(skill!)]);

    expect(drivers.map((driver) => driver.id)).toEqual(["effective_working_time", "average_productivity"]);
  });

  it("does not seed hidden time-loss factors as generated drivers or formulas", async () => {
    const library = await loadSkillLibraryFromFs(skillsRoot);
    const recipes = library.skills.map((skill) => compileSkillRecipe(skill));
    const serialized = JSON.stringify(recipes);
    const forbiddenTerm = new RegExp(["util", "ization"].join(""), "i");

    expect(serialized).not.toMatch(forbiddenTerm);
    expect(serialized).toMatch(/working_time|Working time/);
  });

  it("does not report generic fallback as a complete domain recipe", () => {
    const missing = compileSkillRecipe({
      id: "mining.unseeded_process",
      path: "mining/unseeded-process.md",
      title: "Unseeded mining process",
      domain: "mining",
      excerpt: "No executable recipe is available yet."
    });
    const partial = compileSkillRecipe({
      id: "mining.markdown_only_process",
      path: "mining/markdown-only-process.md",
      title: "Markdown only mining process",
      domain: "mining",
      excerpt: [
        "```text",
        "custom_output",
        "  custom_working_time",
        "  custom_productivity_rate",
        "```"
      ].join("\n")
    });

    expect(missing).toMatchObject({
      recipeQuality: "missing",
      recipeSource: "generic_fallback"
    });
    expect(missing.warnings.join(" ")).toContain("Generic driver skeleton is support only");
    expect(partial).toMatchObject({
      recipeQuality: "partial",
      recipeSource: "markdown_extracted"
    });
    expect(partial.initialDrivers.map((driver) => driver.id)).toEqual([
      "custom_working_time",
      "custom_productivity_rate"
    ]);
  });
});
