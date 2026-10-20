import { createHash } from "node:crypto";
import type { KpiSuggestionRecipeCatalog } from "@vdt-studio/vdt-core";
import { kpiCanonicalJson, smartAssert, smartList, smartRecord, smartString } from "@vdt-studio/vdt-core";
import { extractFormulaReferences } from "@vdt-studio/vdt-core";
import type { VdtSkill } from "./index";

const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const roles = ["target", "working_time", "mass_rate", "fraction", "quantity", "unit_price"];
const relations = ["multiplicative_driver", "additive_component", "subtractive_component", "divisive_driver", "formula_dependency"];

/** No template extraction, keyword matching, generic fallback or partial block.
 * The full immutable canonical skill bytes pin each rebuildable projection. */
export function projectSmartKpiRecipeCatalog(skills: readonly VdtSkill[]): KpiSuggestionRecipeCatalog {
  const recipes: KpiSuggestionRecipeCatalog["recipes"] = [];
  for (const skill of skills) {
    const blocks = [...skill.raw.matchAll(/^```vdt-smart-recipes\s*\n([\s\S]*?)^```\s*$/gm)];
    if (!blocks.length) continue;
    smartAssert(blocks.length === 1, "INVALID_RECIPE", "A canonical skill must have exactly one Smart recipe block.");
    const block: unknown = JSON.parse(blocks[0]![1]!);
    smartRecord(block, ["schemaVersion", "recipes"]);
    smartAssert(block.schemaVersion === "vdt_smart_recipe_source.v1", "INVALID_RECIPE", "Unknown Smart recipe source schema.");
    smartList(block.recipes, 6);
    for (const entry of block.recipes) {
      smartRecord(entry, ["id", "title", "targetRole", "formula", "unitRule", "children", "limitations"]);
      for (const field of ["id", "title", "targetRole", "formula"]) smartString(entry[field], field === "formula" ? 500 : 160);
      smartAssert(["mass_time_rate", "time_losses", "rate_yield", "revenue_net"].includes(String(entry.unitRule)), "INVALID_RECIPE", "Unaudited Smart unit rule.");
      smartList(entry.children, 6); smartList(entry.limitations, 6);
      entry.limitations.forEach(v => smartString(v));
      const keys = new Set<string>();
      for (const child of entry.children) {
        smartRecord(child, ["key", "conceptKey", "name", "unitRole", "relation"]);
        for (const field of ["key", "conceptKey"]) {
          smartString(child[field], 48); smartAssert(/^[a-z][a-z0-9_]*$/.test(child[field] as string), "INVALID_RECIPE", "Invalid Smart recipe key.");
        }
        smartString(child.name, 160);
        smartAssert(!keys.has(child.key as string) && roles.includes(String(child.unitRole)) && relations.includes(String(child.relation)), "INVALID_RECIPE", "Invalid/duplicate Smart recipe child.");
        keys.add(child.key as string);
      }
      const refs = new Set(extractFormulaReferences(entry.formula as string));
      smartAssert(keys.size > 0 && refs.size === keys.size && [...refs].every(ref => keys.has(ref)), "INVALID_RECIPE", "Audited recipe must include every immediate formula factor.");
      smartAssert(Number.isInteger(skill.frontmatter.version) && skill.frontmatter.version! > 0, "INVALID_RECIPE", "A canonical skill needs a version.");
      const projected = { ...entry, skillId: skill.id, skillVersion: skill.frontmatter.version!, skillHash: sha(skill.raw), recipeHash: sha(kpiCanonicalJson(entry)) };
      recipes.push(projected as unknown as KpiSuggestionRecipeCatalog["recipes"][number]);
    }
  }
  recipes.sort((a, b) => a.id.localeCompare(b.id, "en"));
  smartAssert(new Set(recipes.map(r => r.id)).size === recipes.length, "INVALID_RECIPE", "Duplicate canonical Smart recipe.");
  return { schemaVersion: "kpi_recipe_catalog.v1", version: sha(kpiCanonicalJson(recipes)), recipes };
}
