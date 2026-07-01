import { describe, expect, it } from "vitest";
import { compileSkillRecipe, loadDefaultSkillLibrary } from "@vdt-studio/vdt-agent";

describe("mining agent integration contracts", () => {
  it("mine_production_system recipe creates stage-readiness skeleton without additive stage formula", async () => {
    const library = await loadDefaultSkillLibrary();
    const skill = library.byId.get("mining.mine_production_system");
    expect(skill).toBeDefined();

    const recipe = compileSkillRecipe(skill!);

    expect(recipe).toMatchObject({
      skillId: "mining.mine_production_system",
      recipeQuality: "complete",
      recipeSource: "template"
    });
    expect(recipe.initialDrivers.map((driver) => driver.id)).toEqual(expect.arrayContaining([
      "production_boundary",
      "mine_type",
      "material_scope",
      "stage_readiness_tonnes",
      "material_allocation_policy",
      "downstream_capacity_tonnes"
    ]));
    expect(recipe.formulaTemplates).toEqual([]);
    expect(recipe.warnings.join(" ")).toContain("Do not add sequential production stages together");
  });

  it("drill/blast and block preparation compile to executable templates without generic fallback", async () => {
    const library = await loadDefaultSkillLibrary();
    const recipes = [
      compileSkillRecipe(library.byId.get("mining.drill_and_blast")!),
      compileSkillRecipe(library.byId.get("mining.block_preparation_dozer")!)
    ];

    expect(recipes.map((recipe) => recipe.recipeQuality)).toEqual(["complete", "complete"]);
    expect(recipes.map((recipe) => recipe.recipeSource)).toEqual(["template", "template"]);
    expect(recipes.every((recipe) => recipe.initialDrivers.length >= 3)).toBe(true);
  });
});
