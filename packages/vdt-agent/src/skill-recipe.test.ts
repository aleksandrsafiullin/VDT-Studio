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
    expect(recipes.every((recipe) => recipe.formulaTemplates.length > 0)).toBe(true);
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
});
