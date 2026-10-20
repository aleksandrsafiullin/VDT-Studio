import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkillLibraryFromFs } from "../packages/vdt-agent/src/index.ts";
import { projectSmartKpiRecipeCatalog } from "../packages/vdt-agent/src/smart-kpi-recipes.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = projectSmartKpiRecipeCatalog((await loadSkillLibraryFromFs(resolve(root, "packages/vdt-agent/skills"))).skills);
const destination = resolve(root, "packages/vdt-core/src/suggestions/recipe-catalog.generated.json");
const bytes = `${JSON.stringify(catalog, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8") !== bytes) throw new Error("Smart recipe projection is stale. Run node --import tsx scripts/generate-smart-kpi-recipes.mjs.");
  process.stdout.write(`Smart recipe projection verified: ${catalog.recipes.length} audited recipes.\n`);
} else {
  writeFileSync(destination, bytes, "utf8");
  process.stdout.write(`Smart recipe projection generated: ${catalog.recipes.length} audited recipes.\n`);
}
