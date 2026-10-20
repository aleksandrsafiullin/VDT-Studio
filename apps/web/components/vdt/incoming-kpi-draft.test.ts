import { describe, expect, it } from "vitest";
import { buildKpiSuggestionContext, buildRecipeKpiSuggestions, createSmartKpiMeasuredFixture, extractFormulaReferences, inspectIncomingKpiDraft,
  KPI_SUGGESTION_RECIPES, kpiCanonicalJson, validateKpiSuggestionSet } from "@vdt-studio/vdt-core";
import { createIncomingGraphFixture, fixtureContext, fixtureExecution, manualKey, modelProposal } from "../../../../packages/vdt-core/src/suggestions/incoming-contract.fixtures";
import { createIncomingKpiDraft, editIncomingKpiDraft, incomingKpiDraftReferences, IncomingKpiDraftBook } from "./incoming-kpi-draft";

describe("mixed incoming KPI local drafts", () => {
  it("starts with the coherent complete proposed formula and keeps the source immutable", async () => {
    const project = createIncomingGraphFixture("measured"), context = await fixtureContext(project);
    const proposal = modelProposal(context), original = kpiCanonicalJson(proposal);
    const input = createIncomingKpiDraft(context, project, proposal);
    expect(input.draft).toMatchObject({ childKeys: ["first", "second"], formula: "(p_1 + p_2)", formulaAuthorship: "model" });
    expect(inspectIncomingKpiDraft(input).readyForCompile).toBe(true);
    expect(kpiCanonicalJson(proposal)).toBe(original);
  });

  it("keeps an unchecked reference invalid until an explicit mixed formula repairs it, with original aliases and model lineage", async () => {
    const project = createIncomingGraphFixture("measured"), context = await fixtureContext(project), proposal = modelProposal(context);
    const input = createIncomingKpiDraft(context, project, proposal);
    const partial = editIncomingKpiDraft(input, { childKeys: ["second"] });
    expect(partial.draft.formula).toBe(input.draft.formula);
    expect(inspectIncomingKpiDraft(partial)).toMatchObject({ readyForCompile: false, issues: [{ code: "UNSELECTED_REFERENCE" }] });
    const mixed = editIncomingKpiDraft(partial, { manualChildren: [{ key: manualKey, name: "Own distance", unit: "km/trip", selected: true }], formula: `p_2 + ${manualKey}` });
    expect(inspectIncomingKpiDraft(mixed, project)).toMatchObject({ readyForCompile: true, newNodeCount: 2,
      lineage: { kind: "model", requiresExecution: true }, bindings: [{ alias: "p_2", proposalChildKey: "second" }, { alias: manualKey }] });
    const renamed = editIncomingKpiDraft(mixed, { manualChildren: [{ ...mixed.draft.manualChildren[0]!, name: "Renamed distance" }] });
    expect(renamed.draft.formula).toBe(mixed.draft.formula);
    expect(incomingKpiDraftReferences(renamed, project)).toContainEqual({ alias: manualKey, name: "Renamed distance", unit: "km/trip", selected: true });
    const replacementOnly = editIncomingKpiDraft(renamed, { childKeys: [], formula: manualKey });
    expect(inspectIncomingKpiDraft(replacementOnly, project)).toMatchObject({ readyForCompile: true, lineage: { kind: "model", requiresExecution: true } });
  });

  it("starts manual work without a proposal, retains six current factors and permits one new own row", async () => {
    const project = createIncomingGraphFixture("existing_six"), context = await fixtureContext(project);
    const input = createIncomingKpiDraft(context, project);
    expect(input.proposal).toBeUndefined();
    expect(input.draft.source).toEqual({ kind: "manual" });
    expect(input.draft.existingFactors).toHaveLength(6);
    expect(extractFormulaReferences(input.draft.formula)).toEqual(input.draft.existingFactors.map(row => row.key));
    const mixed = editIncomingKpiDraft(input, { manualChildren: [{ key: manualKey, name: "Own component", unit: "km/trip", selected: true }],
      formula: `${input.draft.formula} + ${manualKey}` });
    expect(inspectIncomingKpiDraft(mixed, project)).toMatchObject({ readyForCompile: true, newNodeCount: 1, existingReferenceCount: 6,
      lineage: { kind: "manual", requiresExecution: false } });
    expect(context.target.formula).toBe(project.graph.nodes.find(node => node.id === "target")!.formula);
  });

  it("never turns historical contextual suggestions into an implicit sum", async () => {
    const project = createIncomingGraphFixture("measured"), context = await fixtureContext(project), proposal = modelProposal(context);
    const group = proposal.groups[0]!;
    delete group.formula; group.selectionMode = "independent"; group.requiredKeys = [];
    const input = createIncomingKpiDraft(context, project, proposal);
    expect(input.draft.formula).toBe("");
    expect(input.draft.formulaAuthorship).toBe("user_edited");
    expect(inspectIncomingKpiDraft(input).readyForCompile).toBe(false);
  });

  it("retains incomplete dirty expressions/source/selection across new sources, alternatives and owner switches", async () => {
    const project = createIncomingGraphFixture("measured"), context = await fixtureContext(project), proposal = modelProposal(context);
    const book = new IncomingKpiDraftBook(), opened = book.open("owner/a", createIncomingKpiDraft(context, project, proposal));
    const dirty = book.save(opened, editIncomingKpiDraft(opened.input, { childKeys: ["second"], formula: "p_2 + (@",
      manualChildren: [{ key: manualKey, name: "Unfinished own row", unit: "", selected: false }] }));
    const later = { ...proposal, proposalId: "later_source" };
    expect(book.get("owner/a", context.targetNodeId)).toBe(dirty);
    const reviewed = book.open("owner/a", createIncomingKpiDraft(context, project, later));
    expect(reviewed.input.draft.formula).toBe("(p_1 + p_2)");
    expect(book.select(dirty.key)?.input.draft).toMatchObject({ childKeys: ["second"], formula: "p_2 + (@",
      manualChildren: [{ key: manualKey, name: "Unfinished own row" }] });
    book.open("owner/b", createIncomingKpiDraft(context, project));
    expect(book.get("owner/a", context.targetNodeId)).toBe(dirty);
    expect(book.get("owner/b", context.targetNodeId)?.input.proposal).toBeUndefined();
    expect(book.list("owner/a", context.targetNodeId)).toHaveLength(2);
  });

  it("does not let row removal silently repair the retained expression", async () => {
    const project = createIncomingGraphFixture("measured"), context = await fixtureContext(project);
    const input = editIncomingKpiDraft(createIncomingKpiDraft(context, project), { manualChildren: [{ key: manualKey, name: "Distance", unit: "km/trip", selected: true }], formula: manualKey });
    const removed = editIncomingKpiDraft(input, { manualChildren: [] });
    expect(removed.draft.formula).toBe(manualKey);
    expect(inspectIncomingKpiDraft(removed, project)).toMatchObject({ readyForCompile: false, issues: [{ code: "UNSELECTED_REFERENCE" }] });
  });

  it("copies own rows only on first source open and restores distinct dirty alternative drafts exactly", async () => {
    const project = createIncomingGraphFixture("measured"), context = await fixtureContext(project), proposal = modelProposal(context);
    proposal.groups.push({ ...proposal.groups[0]!, id: "alternative", title: "Second alternative" });
    const book = new IncomingKpiDraftBook();
    let a = book.open("owner", createIncomingKpiDraft(context, project, proposal, "components"));
    a = book.save(a, editIncomingKpiDraft(a.input, { manualChildren: [{ key: manualKey, name: "Own A", unit: "km/trip", selected: true }], formula: `p_1 + ${manualKey}` }));
    let b = book.open("owner", createIncomingKpiDraft(context, project, proposal, "alternative"), a.input);
    expect(b.input.draft.manualChildren[0]!.name).toBe("Own A");
    const bKey = `m_${"b".repeat(32)}` as const;
    b = book.save(b, editIncomingKpiDraft(b.input, { manualChildren: [{ key: bKey, name: "Own B", unit: "km/trip", selected: true }], formula: `p_2 + ${bKey}` }));
    const returnedA = book.open("owner", createIncomingKpiDraft(context, project, proposal, "components"), b.input);
    const returnedB = book.open("owner", createIncomingKpiDraft(context, project, proposal, "alternative"), returnedA.input);
    expect(returnedA.input).toEqual(a.input);
    expect(returnedB.input).toEqual(b.input);
    expect(returnedA.input.draft.manualChildren).not.toEqual(returnedB.input.draft.manualChildren);
  });

  it("seeds all six long existing references from the full graph formula, never the 500-character context excerpt", async () => {
    const project = createIncomingGraphFixture("existing_six");
    const ids = Array.from({ length: 6 }, (_, index) => `factor_${index}_${"x".repeat(90)}`);
    for (let index = 0; index < ids.length; index++) {
      const oldId = `factor_${index}`;
      project.graph.nodes.find(node => node.id === oldId)!.id = ids[index]!;
      for (const edge of project.graph.edges) if (edge.targetNodeId === oldId) edge.targetNodeId = ids[index]!;
    }
    const fullFormula = ids.join(" + ");
    project.graph.nodes.find(node => node.id === "target")!.formula = fullFormula;
    const context = await fixtureContext(project);
    expect(context.target.formula!.length).toBeLessThan(fullFormula.length);
    expect(context.omissions.text).toBe(true);
    const input = createIncomingKpiDraft(context, project);
    expect(input.draft.existingFactors.map(row => row.nodeId)).toEqual(ids);
    const mixed = editIncomingKpiDraft(input, { manualChildren: [{ key: manualKey, name: "New distance", unit: "km/trip", selected: true }],
      formula: `${input.draft.formula} + ${manualKey}` });
    expect(extractFormulaReferences(mixed.draft.formula)).toEqual([...input.draft.existingFactors.map(row => row.key), manualKey]);
    expect(inspectIncomingKpiDraft(mixed, project)).toMatchObject({ readyForCompile: true, newNodeCount: 1, existingReferenceCount: 6 });
    expect(project.graph.nodes.find(node => node.id === "target")!.formula).toBe(fullFormula);
  });

  it("recognizes an unchanged audited model-selected recipe without erasing its model execution lineage", async () => {
    const project = createSmartKpiMeasuredFixture(), context = await buildKpiSuggestionContext(project, {
      workspaceId: "owner", vdtId: null, targetNodeId: project.rootNodeId, period: { key: "2026-10", grain: "month" }
    });
    const recipe = KPI_SUGGESTION_RECIPES.recipes.find(recipe => recipe.id === "production.time_rate")!;
    const proposal = buildRecipeKpiSuggestions(context, [{ binding: { id: "explicit_qa_recipe", recipeId: recipe.id, recipeHash: recipe.recipeHash,
      skillHash: recipe.skillHash, targetRole: recipe.targetRole, contextHash: context.contextHash, basis: "selected_skill", sourceRef: "explicit_recipe_fixture", rationale: "Explicit QA decision." } }],
      { now: new Date().toISOString(), proposalId: "bound_model_source" })!;
    proposal.origin = { kind: "model", requestId: "qa_model_request", execution: fixtureExecution };
    validateKpiSuggestionSet(proposal);
    const input = createIncomingKpiDraft(context, project, proposal);
    expect(input.draft.formulaAuthorship).toBe("recipe");
    expect(inspectIncomingKpiDraft(input, project)).toMatchObject({ readyForCompile: true,
      lineage: { kind: "model", formulaAuthorship: "recipe", requiresExecution: true, execution: fixtureExecution } });
    expect(editIncomingKpiDraft(input, { childKeys: [input.draft.childKeys[0]!] }).draft.formulaAuthorship).toBe("user_edited");
  });
});
