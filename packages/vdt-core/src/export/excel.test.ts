import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { productionVolumeProject } from "../examples/production-volume";
import { calculateGraph } from "../formula/calculate";
import { calculateScenarioGraph } from "../scenario/scenario";
import { rankScenarioInputNodes } from "../scenario/sensitivity";
import type { VdtNode, VdtProject } from "../types";
import { exportProjectExcel, getExcelNodeCells, getExcelWorkbookCells, type ExcelExportOptions } from "./excel";

const date = "2026-01-01T00:00:00.000Z";
function node(id: string, fields: Partial<VdtNode> = {}): VdtNode {
  return { id, name: id, type: "input", status: "accepted", aiGenerated: false, createdAt: date, updatedAt: date, ...fields };
}
function project(nodes: VdtNode[], edges: [string, string][] = []): VdtProject {
  return { ...structuredClone(productionVolumeProject), rootNodeId: nodes[0]!.id,
    graph: { nodes, edges: edges.map(([sourceNodeId, targetNodeId], i) => ({ id: `edge_${i}`, sourceNodeId, targetNodeId, relation: "formula_dependency", aiGenerated: false })) }, scenarios: [] };
}
function workbook(input: VdtProject, options: ExcelExportOptions = {}) {
  const bytes = exportProjectExcel(input, options);
  const parts = Object.fromEntries(Object.entries(unzipSync(bytes)).map(([path, part]) => [path, strFromU8(part)]));
  const sheet = parts["xl/worksheets/sheet1.xml"]!;
  return { bytes, parts, sheet, mapping: getExcelNodeCells(input), workbookMapping: getExcelWorkbookCells(input, options) };
}
function cell(sheet: string, address: string) {
  const content = sheet.match(new RegExp(`<c r="${address}"[^>]*>[\\s\\S]*?<\\/c>`))?.[0];
  if (!content) throw new Error(`Missing cell ${address}`);
  return {
    content,
    formula: content.match(/<f>([\s\S]*?)<\/f>/)?.[1]?.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"'),
    value: content.match(/<v>(.*?)<\/v>/)?.[1],
    type: content.match(/ t="(.*?)"/)?.[1],
    style: Number(content.match(/ s="(.*?)"/)?.[1])
  };
}

describe("editable Excel VDT export", () => {
  it("serializes a deterministic XLSX package with styles, formulas, cached core values and automatic recalculation", () => {
    const model = structuredClone(productionVolumeProject);
    model.scenarios[0]!.isMain = true;
    const { bytes, parts, sheet, mapping } = workbook(model);
    expect(bytes.subarray(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    expect(exportProjectExcel(model)).toEqual(bytes);
    expect(Object.keys(parts)).toHaveLength(12);
    expect(parts["xl/workbook.xml"]).toContain('sheet name="VDT"');
    expect(parts["xl/workbook.xml"]).toContain('sheet name="Guide"');
    expect(parts["xl/workbook.xml"]).toContain('calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"');
    expect(parts["xl/styles.xml"]).toContain("Base: ");
    expect(parts["xl/styles.xml"]).toContain("Potential: ");
    expect(parts["xl/styles.xml"]).toContain("&quot;Base: &quot;0.00;&quot;Base: &quot;-0.00");
    expect(parts["xl/styles.xml"]).not.toContain("#,##0.######");
    const base = calculateGraph(model);
    const potential = calculateScenarioGraph(model, model.scenarios[0]!);
    for (const item of model.graph.nodes) {
      expect(Number(cell(sheet, mapping[item.id]!.baselineCell).value)).toBe(base.values[item.id]);
      expect(Number(cell(sheet, mapping[item.id]!.potentialCell).value)).toBe(potential.values[item.id]);
      expect(cell(sheet, mapping[item.id]!.nameCell).type).toBe("inlineStr");
    }
    const root = cell(sheet, mapping.production_volume!.baselineCell);
    expect(root.formula).toContain(`${mapping.effective_working_time!.baselineCell}*${mapping.average_productivity!.baselineCell}`);
  });

  it("opens a compact Scenario Mode dashboard first, with residual label and value on one row", () => {
    const model = project([node("root", { type: "calculated", formula: "input*2" }), node("input", { value: 1 })]);
    const { parts, workbookMapping } = workbook(model);
    const names = [...parts["xl/workbook.xml"]!.matchAll(/<sheet name="([^"]+)"/g)].map((match) => match[1]);
    expect(names).toEqual(["Scenario Mode", "VDT", "Source", "Guide", "_Scenario Calc"]);
    expect(parts["xl/workbook.xml"]).toContain('activeTab="0"');
    const mode = parts["xl/worksheets/sheet4.xml"]!;
    expect(workbookMapping.scenario.totals).toEqual({ baselineCell: "B4", scenarioCell: "E4", absoluteChangeCell: "B6", percentageChangeCell: "E6", multiplicativeEffectCell: "E8" });
    expect(cell(mode, "D8").content).toContain("Multiplicative effect");
    expect(cell(mode, "E8").value).toBe("0");
    expect(cell(mode, "A2").content).toContain("Baseline scenario");
    expect(mode).not.toMatch(/Edit |Blank Scenario|clear a cell|upstream|total change minus/i);
    expect(parts["xl/worksheets/sheet2.xml"]).toContain("Default Scenario formulas reference the adjacent Baseline cell");
    expect(mode).toContain('<col min="5" max="5" width="30"');
    expect(cell(mode, "B4").style).not.toBe(cell(mode, "E4").style);
  });

  it("keeps full precision while formatting every numeric area to two decimals with dynamic space groups", () => {
    const value = 1234567890.123456;
    const model = project([node("root", { type: "calculated", formula: "input*2" }), node("input", { value }), node("missing")], [["root", "input"]]);
    model.scenarios = [{ id: "selected", name: "Selected", overrides: [{ nodeId: "input", value: -value }], createdAt: date, updatedAt: date }];
    const { parts, sheet, workbookMapping } = workbook(model);
    const styles = parts["xl/styles.xml"]!;
    const formats = [...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]+)"/g)].map((match) => ({ id: Number(match[1]), code: match[2]!.replace(/&quot;/g, '"') }));
    expect(formats.every((format) => format.code.includes("0.00") && format.code.length <= 255)).toBe(true);
    // Native Excel repairs masks with more than 48 numeric placeholders/section.
    expect(formats.every((format) => format.code.split(";").every((section) =>
      [...section.replace(/"[^"]*"/g, "")].filter((char) => /[0-9#?]/.test(char)).length <= 48))).toBe(true);
    expect(new Set(formats.map((format) => format.id)).size).toBe(68);
    expect(styles).toContain('dxfs count="64"');
    expect(formats.find((format) => format.id === 164)!.code).toBe('"Base: "0.00;"Base: "-0.00');
    expect(formats.some((format) => format.code === '#\\ ###\\ ###\\ ##0.00')).toBe(true);
    expect(formats.some((format) => format.code === '"Potential: "#\\ ###\\ ###\\ ##0.00;"Potential: "-#\\ ###\\ ###\\ ##0.00')).toBe(true);
    expect(cell(parts["xl/worksheets/sheet3.xml"]!, workbookMapping.source.input!.valueCell).value).toBe(String(value));
    expect(cell(parts["xl/worksheets/sheet4.xml"]!, workbookMapping.scenario.drivers.input!.scenarioCell).value).toBe(String(-value));
    expect(cell(sheet, workbookMapping.tree.input!.baselineCell).value).toBe(String(value));
    for (const part of [1, 3, 4, 5]) {
      const worksheet = parts[`xl/worksheets/sheet${part}.xml`]!;
      const rules = [...worksheet.matchAll(/<cfRule [^>]*priority="(\d+)"/g)].map((match) => match[1]);
      expect(new Set(rules).size).toBe(rules.length);
      expect(worksheet).toContain('stopIfTrue="1"');
      expect(worksheet).toContain("ROUND(ABS(");
      expect(worksheet).toContain("ISNUMBER(");
      expect(worksheet).toContain("&gt;=1E3");
      expect(worksheet).toContain("&gt;=1E48");
    }
    const source = parts["xl/worksheets/sheet3.xml"]!;
    expect(source).toContain(`sqref="B6:B7"`);
    for (const entry of Object.values(workbookMapping.tree)) {
      const column = entry.baselineCell.replace(/\d+$/, "");
      const cellsInColumn = Object.values(workbookMapping.tree).filter((item) => item.column === entry.column).sort((a, b) => a.headerRow - b.headerRow);
      expect(sheet).toContain(`sqref="${cellsInColumn.map((item) => item.baselineCell).join(" ")}"`);
      expect(sheet).toContain(`ISNUMBER(${column}${cellsInColumn[0]!.headerRow + 1})`);
    }
  });

  it("gives each numeric column its own conditional-format origin when children are above their parent", () => {
    const model = project([node("root", { formula: "a+b", type: "calculated" }), node("a", { value: 1 }), node("b", { value: 2000000 }), node("c", { value: 2000 })], [["root", "a"], ["root", "b"], ["root", "c"]]);
    const { sheet, mapping } = workbook(model);
    expect(mapping.root!.headerRow).toBeGreaterThan(mapping.a!.headerRow);
    for (const match of sheet.matchAll(/<conditionalFormatting sqref="([^"]+)">([\s\S]*?)<\/conditionalFormatting>/g)) {
      const references = match[1]!.match(/[A-Z]+\d+/g)!;
      expect(new Set(references.map((reference) => reference.replace(/\d+$/, ""))).size).toBe(1);
      expect(match[2]).toContain(`ISNUMBER(${references[0]})`);
      expect(match[2]).toContain(`ROUND(ABS(${references[0]}),2)`);
    }
  });

  it("exports same-sheet baseline defaults for all drivers and keeps scratch Potential tied to the combined graph", () => {
    const model = project([node("root", { type: "calculated", formula: "derived" }), node("derived", { formula: "input*2" }), node("input", { value: 1 })]);
    const { parts, sheet, workbookMapping } = workbook(model);
    const mode = parts["xl/worksheets/sheet4.xml"]!;
    const helpers = parts["xl/worksheets/sheet5.xml"]!;
    for (const [id, entry] of Object.entries(workbookMapping.scenario.drivers)) {
      expect(cell(mode, entry.scenarioCell).formula).toBe(entry.baselineCell);
      const combined = cell(helpers, `B${workbookMapping.scenario.calculation.nodeRows[id]}`).formula!;
      expect(combined).toContain(`IFERROR(_xlfn.FORMULATEXT('Scenario Mode'!${entry.scenarioCell}),"")="=${entry.baselineCell}"`);
      // There is no numeric-equality shortcut: explicit equal/zero values and
      // other user formulas therefore remain own overrides.
      expect(combined).not.toContain(`${entry.scenarioCell}=${entry.baselineCell}`);
      expect(cell(sheet, workbookMapping.tree[id]!.potentialCell).formula).toBeDefined();
    }
    expect(cell(sheet, workbookMapping.tree.root!.potentialCell).formula).toContain(`'_Scenario Calc'!${workbookMapping.scenario.calculation.selectedRootCell}`);
    expect(cell(sheet, workbookMapping.tree.derived!.potentialCell).value).toBe("2");
  });

  it("puts parents left, siblings in one depth column, exactly two narrow border-only columns between depths", () => {
    const model = project([node("root", { formula: "a+b" }), node("a", { baselineValue: 1 }), node("b", { baselineValue: 2 })], [["root", "a"], ["root", "b"]]);
    const { sheet, mapping, parts } = workbook(model);
    expect(mapping.root!.column).toBe(1);
    expect(mapping.a!.column).toBe(4);
    expect(mapping.b!.column).toBe(4);
    expect(Math.abs(mapping.a!.headerRow - mapping.b!.headerRow)).toBeGreaterThanOrEqual(5);
    expect(sheet).toContain('<col min="2" max="2" width="3" customWidth="1"/>');
    expect(sheet).toContain('<col min="3" max="3" width="3" customWidth="1"/>');
    const gapCells = [...sheet.matchAll(/<c r="[BC]\d+"[^>]*>(.*?)<\/c>/g)];
    expect(gapCells.length).toBeGreaterThan(2);
    expect(gapCells.every((match) => match[1] === "")).toBe(true);
    expect(gapCells.some((match) => match[0].includes('s="6"') || match[0].includes('s="7"'))).toBe(true);
    expect(parts["xl/styles.xml"]).toContain('<right style="thin"><color rgb="FF64748B"/>');
    expect(parts["xl/styles.xml"]).toContain('<top style="thin"><color rgb="FF64748B"/>');
    expect(sheet).not.toContain("drawing");
  });

  it("translates the AST with exact grouping, unary negatives, raw percentage values and normalized numeric literals", () => {
    const model = project([
      node("root", { formula: "-(a - b) / (a + b) + min(a, max(b, 90%))" }),
      node("a", { baselineValue: 2, unit: "%" }), node("b", { baselineValue: 1 }),
      node("comma", { formula: "1,85 * a + 1,000" }), node("min", { baselineValue: 3 }),
      node("reserved", { formula: "min + max(a, b)" })
    ]);
    const { sheet, mapping } = workbook(model);
    const a = mapping.a!.baselineCell;
    const b = mapping.b!.baselineCell;
    expect(cell(sheet, mapping.root!.baselineCell).formula).toBe(`IF(AND(ISNUMBER(${a}),ISNUMBER(${b})),(((-(${a}-${b}))/(${a}+${b}))+MIN(${a},MAX(${b},0.9))),NA())`);
    expect(cell(sheet, mapping.comma!.baselineCell).formula).toContain(`((1.85*${a})+1000)`);
    expect(cell(sheet, mapping.reserved!.baselineCell).formula).toContain(`(${mapping.min!.baselineCell}+MAX(${a},${b}))`);
    expect(cell(sheet, a).value).toBe("2");
    expect(cell(sheet, a).style).toBe(2);
  });

  it("uses the selected scenario, preserves last and zero overrides, ignores own fixed override and keeps fixed calculated dependencies live", () => {
    const model = project([
      node("root", { formula: "fixed_calc + overridden + input" }),
      node("fixed_calc", { formula: "input * 2", fixedInScenario: true, baselineValue: 999 }),
      node("overridden", { formula: "input * 3" }), node("input", { baselineValue: 4, value: 888 })
    ], [["root", "fixed_calc"], ["fixed_calc", "input"], ["root", "overridden"]]);
    model.scenarios = [
      { id: "active", name: "Selected", overrides: [{ nodeId: "input", value: 400 }], createdAt: date, updatedAt: date },
      { id: "main", name: "Main", isMain: true, overrides: [
        { nodeId: "input", value: 10 }, { nodeId: "input", value: 6 },
        { nodeId: "fixed_calc", value: 500 }, { nodeId: "overridden", value: 0 }
      ], createdAt: date, updatedAt: date }
    ];
    const { sheet, mapping, parts, workbookMapping } = workbook(model, { scenarioId: "main" });
    expect(cell(sheet, mapping.input!.baselineCell).value).toBe("4");
    expect(cell(sheet, mapping.input!.potentialCell).value).toBe("6");
    expect(cell(sheet, mapping.input!.potentialCell).formula).toContain(`'Scenario Mode'!${workbookMapping.scenario.drivers.input!.scenarioCell}`);
    expect(cell(sheet, mapping.overridden!.potentialCell).value).toBe("0");
    expect(cell(sheet, mapping.overridden!.potentialCell).formula).toContain(`'_Scenario Calc'!B${workbookMapping.scenario.calculation.nodeRows.overridden}`);
    expect(cell(parts["xl/worksheets/sheet5.xml"]!, `B${workbookMapping.scenario.calculation.nodeRows.fixed_calc}`).formula).toContain(`B${workbookMapping.scenario.calculation.nodeRows.input}*2`);
    expect(cell(sheet, mapping.fixed_calc!.potentialCell).value).toBe("12");
    expect(cell(sheet, mapping.fixed_calc!.baselineCell).value).toBe("8");
    expect(cell(sheet, mapping.root!.potentialCell).value).toBe("18");
  });

  it("uses the first saved scenario without requiring a main scenario and links all cards to Scenario Mode", () => {
    const model = project([node("root", { formula: "input * 2" }), node("input", { value: 5 })]);
    model.scenarios = [{ id: "other", name: "Other", overrides: [{ nodeId: "input", value: 99 }], createdAt: date, updatedAt: date }];
    const { sheet, mapping, workbookMapping } = workbook(model);
    expect(cell(sheet, mapping.root!.potentialCell).value).toBe("198");
    expect(cell(sheet, mapping.input!.potentialCell).value).toBe("99");
    expect(cell(sheet, mapping.root!.potentialCell).formula).toContain(`'_Scenario Calc'!B${workbookMapping.scenario.calculation.nodeRows.root}`);
    expect(cell(sheet, mapping.input!.potentialCell).formula).toContain(`'Scenario Mode'!${workbookMapping.scenario.drivers.input!.scenarioCell}`);
    expect(sheet).toContain("Potential: Other");
  });

  it("leaves missing inputs editable and guards arithmetic and MIN/MAX against blank/text coercion", () => {
    const model = project([
      node("root", { formula: "min(missing, filled) + max(missing, filled)" }),
      node("missing"), node("filled", { baselineValue: 7 }), node("arithmetic", { formula: "missing * 0 + filled" })
    ]);
    const { sheet, mapping, parts, workbookMapping } = workbook(model);
    expect(cell(parts["xl/worksheets/sheet3.xml"]!, workbookMapping.source.missing!.valueCell).value).toBeUndefined();
    expect(cell(parts["xl/worksheets/sheet3.xml"]!, workbookMapping.source.missing!.valueCell).formula).toBeUndefined();
    expect(cell(sheet, mapping.missing!.baselineCell).value).toBe("#N/A");
    expect(cell(sheet, mapping.missing!.baselineCell).formula).toContain("ISBLANK(INDEX(SourceInputs[Value]");
    for (const id of ["root", "arithmetic"]) {
      const current = cell(sheet, mapping[id]!.baselineCell);
      expect(current.formula).toContain(`ISNUMBER(${mapping.missing!.baselineCell})`);
      expect(current.formula).toContain(",NA())");
      expect(current.type).toBe("e");
      expect(current.value).toBe("#N/A");
    }
  });

  it("keeps division-by-zero formulas live for repair and marks rejected, malformed, unknown and non-finite values unavailable", () => {
    const model = project([
      node("root", { formula: "numerator / denominator" }), node("numerator", { value: 10 }), node("denominator", { value: 0 }),
      node("rejected", { status: "rejected", value: 100 }), node("invalid", { formula: "sum(numerator)" }),
      node("unknown", { formula: "does_not_exist + numerator" }), node("overflow", { value: Infinity }),
      node("rejected_dep", { formula: "rejected + numerator" })
    ]);
    const { sheet, mapping, parts } = workbook(model);
    const divided = cell(sheet, mapping.root!.baselineCell);
    expect(divided.value).toBe("#DIV/0!");
    expect(divided.formula).toContain(`(${mapping.numerator!.baselineCell}/${mapping.denominator!.baselineCell})`);
    for (const id of ["rejected", "invalid", "unknown", "overflow", "rejected_dep"]) {
      expect(cell(sheet, mapping[id]!.baselineCell).type).toBe("e");
      expect(cell(sheet, mapping[id]!.baselineCell).formula).toBeDefined();
    }
    expect(parts["xl/worksheets/sheet2.xml"]).toContain("does_not_exist");
    expect(sheet).not.toContain("Infinity");
  });

  it("retains DAG/shared/disconnected nodes once with non-overlapping cards and canonical references independent of visual edges", () => {
    const model = project([
      node("root", { formula: "a + b" }), node("a", { formula: "shared * 2" }), node("b", { formula: "shared + 1" }),
      node("shared", { value: 3 }), node("disconnected", { formula: "shared - 1" })
    ], [["root", "a"], ["root", "b"], ["a", "shared"], ["b", "shared"], ["root", "shared"]]);
    const { sheet, mapping, parts } = workbook(model);
    expect(Object.keys(mapping)).toHaveLength(5);
    const occupied = Object.values(mapping).flatMap((entry) => [entry.nameCell, entry.baselineCell, entry.potentialCell]);
    expect(new Set(occupied).size).toBe(15);
    expect(mapping.shared!.column).toBe(7);
    expect(cell(sheet, mapping.a!.baselineCell).formula).toContain(mapping.shared!.baselineCell);
    expect(cell(sheet, mapping.b!.baselineCell).formula).toContain(mapping.shared!.baselineCell);
    expect(cell(sheet, mapping.disconnected!.baselineCell).formula).toContain(mapping.shared!.baselineCell);
    expect([...sheet.matchAll(/<t xml:space="preserve">shared<\/t>/g)]).toHaveLength(1);
    expect(parts["xl/worksheets/sheet2.xml"]).toContain("disconnected");
  });

  it("terminates visual cycles, reports formula cycles and allows scenario overrides to break calculation cycles", () => {
    const model = project([node("root", { formula: "other + 1" }), node("other", { formula: "root + 1" }), node("value", { value: 4 })], [["root", "other"], ["other", "root"]]);
    model.scenarios = [{ id: "main", name: "Main", isMain: true, overrides: [{ nodeId: "other", value: 10 }], createdAt: date, updatedAt: date }];
    const { sheet, mapping, parts } = workbook(model);
    expect(Object.keys(mapping)).toHaveLength(3);
    expect(mapping.root!.column).toBe(mapping.other!.column);
    expect(mapping.root!.headerRow).not.toBe(mapping.other!.headerRow);
    expect(cell(sheet, mapping.root!.baselineCell).value).toBe("#N/A");
    expect(cell(sheet, mapping.other!.baselineCell).value).toBe("#N/A");
    expect(cell(sheet, mapping.root!.potentialCell).value).toBe("11");
    expect(cell(sheet, mapping.root!.potentialCell).formula).toContain("'_Scenario Calc'!B3");
    expect(parts["xl/worksheets/sheet2.xml"]).toContain("Visual cycle");
    expect(parts["xl/worksheets/sheet2.xml"]).toContain("Circular formula dependency");
  });

  it("escapes user text as native string cells and excludes provider credentials", () => {
    const model = project([node("root", { name: '=HYPERLINK("evil") <&>', unit: "<unit>", value: 1 })]);
    Reflect.set(model.aiSettings, "apiKey", "session-secret-key");
    const { sheet, parts, mapping } = workbook(model);
    expect(cell(sheet, mapping.root!.nameCell).type).toBe("inlineStr");
    expect(cell(sheet, mapping.root!.nameCell).formula).toBeUndefined();
    expect(sheet).toContain("&lt;&amp;&gt;");
    expect(Object.values(parts).join("\n")).not.toContain("session-secret-key");
  });

  it("supports A1 references after column Z", () => {
    const nodes = Array.from({ length: 11 }, (_, i) => node(`n${i}`, i === 10 ? { value: 1 } : { formula: `n${i + 1} + 1` }));
    const model = project(nodes, nodes.slice(0, -1).map((entry, i) => [entry.id, nodes[i + 1]!.id]));
    const { sheet, mapping } = workbook(model);
    expect(mapping.n9!.column).toBe(28);
    expect(mapping.n9!.baselineCell).toMatch(/^AB/);
    expect(cell(sheet, mapping.n8!.baselineCell).formula).toContain(mapping.n9!.baselineCell);
    expect(cell(sheet, mapping.n0!.baselineCell).value).toBe("11");
  });

  it("sizes wrapped KPI headers and Guide rows for long names, units and formulas without widening spacer columns", () => {
    const model = project([node("root", {
      name: "Суммарный дополнительный операционный доход от повышения производительности производства",
      unit: "миллионов тенге на предприятие в год",
      formula: "input + input + input + input + input + input + input + input + input + input"
    }), node("input", { value: 1 })], [["root", "input"]]);
    const { sheet, parts, mapping } = workbook(model);
    const header = sheet.match(new RegExp(`<row r="${mapping.root!.headerRow}" ht="(\\d+)"`));
    expect(Number(header?.[1])).toBeGreaterThan(44);
    expect(parts["xl/worksheets/sheet2.xml"]).toMatch(/<row r="6" ht="(?:[6-9]\d|\d{3})" customHeight="1">/);
    expect(sheet).toContain('<col min="2" max="2" width="3"');
    expect(sheet).toContain('<col min="3" max="3" width="3"');
  });

  it.each(["min", "max", "sum"])("nests large %s calculations and numeric guards to respect Excel's 255-argument limit", (kind) => {
    // These constants exercise 256 AST operands without creating an unrelated
    // 256-column Scenario Mode sensitivity matrix in a native-argument-limit test.
    const inputs = Array.from({ length: 256 }, (_, i) => node(`input_${i}`, { type: "assumption", value: i }));
    const formula = kind === "sum" ? inputs.map((input) => input.id).join("+") : `${kind}(${inputs.map((input) => input.id).join(",")})`;
    const model = project([node("root", { type: "calculated", formula }), ...inputs]);
    const { sheet, mapping } = workbook(model);
    const current = cell(sheet, mapping.root!.baselineCell);
    expect(current.formula).toContain("AND(AND(ISNUMBER(");
    if (kind !== "sum") expect(current.formula).toContain(`${kind.toUpperCase()}(${kind.toUpperCase()}(`);
    expect(current.value).toBe(kind === "min" ? "0" : kind === "max" ? "255" : "32640");
  });

  it("reports Excel cell/formula limits before producing a silently truncated workbook", () => {
    expect(() => exportProjectExcel(project([node("root", { name: "x".repeat(32_768), value: 1 })])))
      .toThrow("cell text length limit");
    const model = project([node("root", { formula: `min(${Array.from({ length: 4_200 }, () => "1").join(",")})` })]);
    expect(() => exportProjectExcel(model)).toThrow("formula length limit (8,192 characters)");
    const inputs = Array.from({ length: 400 }, (_, i) => node(`i${i}`, { type: "assumption", value: 1 }));
    const tooLong = project([node("root", { name: "Large sum", formula: inputs.map((input) => input.id).join("+") }), ...inputs]);
    expect(() => exportProjectExcel(tooLong)).toThrow(/KPI "Large sum" at cell A6 exceeds Excel's formula length limit/);
  });

  it("reports native function nesting limits without converting valid but oversized formulas to NA", () => {
    const allowed = project([node("root", { type: "calculated", formula: "min(".repeat(64) + "1" + ")".repeat(64) })]);
    const { sheet, mapping } = workbook(allowed);
    expect(cell(sheet, mapping.root!.baselineCell).value).toBe("1");
    const refused = project([node("root", { name: "Too deep", formula: "min(".repeat(65) + "1" + ")".repeat(65) })]);
    expect(() => exportProjectExcel(refused)).toThrow(/KPI "Too deep" at cell A6 exceeds Excel's nested function limit/);
  });

  it("exports one native four-column Source table with numeric authoritative values and actual provenance", () => {
    const model = project([
      node("root", { type: "calculated", formula: "mapped + constant + assumption + external + fixed" }),
      node("mapped", { type: "data_mapped", value: 7, dataMapping: { sourceId: "upload", tableId: "Sheet1", field: "Rate", aggregation: "avg" }, valueSource: { sourceTier: "uploaded_data", catalogRef: "catalog-rate", note: "Reviewed by operator", confidence: "high" } }),
      node("constant", { type: "calculated", baselineValue: 3 }), node("assumption", { type: "assumption", value: 2 }),
      node("external", { type: "external_factor", value: 4 }), node("fixed", { value: 1, fixedInScenario: true }),
      node("rejected", { value: 999, status: "rejected" })
    ]);
    model.dataSources = [{ id: "upload", name: "Production register", type: "file" }];
    const { parts, sheet, workbookMapping } = workbook(model);
    const sourceSheet = parts["xl/worksheets/sheet3.xml"]!;
    expect(parts["xl/tables/table1.xml"]).toContain('ref="A5:D11"');
    expect(parts["xl/tables/table1.xml"]).toContain('<tableColumns count="4">');
    for (const name of ["KPI", "Value", "Source", "Comment"]) expect(parts["xl/tables/table1.xml"]).toContain(`name="${name}"`);
    expect(parts["xl/worksheets/_rels/sheet3.xml.rels"]).toContain('Target="../tables/table1.xml"');
    expect(sourceSheet).toContain('tablePart r:id="rId1"');
    expect(Object.keys(workbookMapping.source)).toEqual(["mapped", "constant", "assumption", "external", "fixed", "rejected"]);
    expect(workbookMapping.scenario.drivers.fixed).toBeUndefined();
    for (const [id, entry] of Object.entries(workbookMapping.source)) {
      expect(cell(sourceSheet, entry.valueCell).formula).toBeUndefined();
      expect(cell(sourceSheet, entry.valueCell).type).toBeUndefined();
      if (id !== "rejected") expect(cell(sheet, workbookMapping.tree[id]!.baselineCell).formula).toContain("SourceInputs[Value]");
    }
    expect(sourceSheet).toContain("Production register / Sheet1 / Rate");
    expect(sourceSheet).toContain("catalog-rate");
    expect(sourceSheet).toContain("Reviewed by operator");
    expect(cell(sheet, workbookMapping.tree.rejected!.baselineCell).value).toBe("#N/A");
  });

  it("binds Source values through unique case-insensitive labels and escaped lookups, protecting sorting, blanks and zero", () => {
    const model = project([
      node("root", { type: "calculated", formula: "a + b + c" }),
      node("a", { name: 'Rate * ? ~ "quoted"', unit: "units", value: 0 }),
      node("b", { name: 'Rate * ? ~ "quoted"', unit: "units", value: 2 }),
      node("c", { name: 'RATE * ? ~ "QUOTED"', unit: "units" })
    ]);
    const { sheet, parts, workbookMapping } = workbook(model);
    const labels = Object.values(workbookMapping.source).map((entry) => entry.kpiLabel.toLowerCase());
    expect(new Set(labels).size).toBe(3);
    expect(workbookMapping.source.b!.kpiLabel).toContain("(2)");
    expect(workbookMapping.source.c!.kpiLabel).toContain("(3)");
    const formula = cell(sheet, workbookMapping.tree.a!.baselineCell).formula!;
    const keyReference = `'_Scenario Calc'!${workbookMapping.source.a!.keyCell}`;
    expect(formula).toContain(`SUMPRODUCT(--(SourceInputs[KPI]=${keyReference}))=1`);
    expect(formula).toContain("ISBLANK(INDEX(SourceInputs[Value]");
    expect(formula).toContain("ISNUMBER(INDEX(SourceInputs[Value]");
    expect(formula).toContain(`MATCH(TRUE,INDEX(SourceInputs[KPI]=${keyReference},0),0)`);
    expect(formula).not.toContain("COUNTIF");
    expect(formula).not.toMatch(/'Source'!B\d+/);
    expect(cell(parts["xl/worksheets/sheet3.xml"]!, workbookMapping.source.a!.valueCell).value).toBe("0");
    expect(cell(parts["xl/worksheets/sheet3.xml"]!, workbookMapping.source.c!.valueCell).value).toBeUndefined();
  });

  it.each(["product", "ratio", "minmax"])("calculates selected %s totals, every isolated root effect and residual using live independent graph columns", (kind) => {
    const formula = kind === "product" ? "a*b" : kind === "ratio" ? "a/b" : "min(a,b)*max(a,b)";
    const model = project([node("root", { type: "calculated", formula }), node("a", { value: 10 }), node("b", { value: 5 })]);
    model.scenarios = [
      { id: "main", name: "Main", isMain: true, overrides: [{ nodeId: "a", value: 20 }], createdAt: date, updatedAt: date },
      { id: "selected", name: "Selected", overrides: [{ nodeId: "a", value: 15 }, { nodeId: "b", value: 3 }], createdAt: date, updatedAt: date }
    ];
    const { parts, sheet, workbookMapping } = workbook(model, { scenarioId: "selected" });
    const mode = parts["xl/worksheets/sheet4.xml"]!;
    const helpers = parts["xl/worksheets/sheet5.xml"]!;
    const base = calculateGraph(model);
    const selected = calculateScenarioGraph(model, model.scenarios[1]!);
    expect(Number(cell(mode, "B4").value)).toBe(base.rootValue);
    expect(Number(cell(mode, "E4").value)).toBe(selected.rootValue);
    for (const item of model.graph.nodes) expect(Number(cell(sheet, workbookMapping.tree[item.id]!.potentialCell).value)).toBe(selected.values[item.id]);
    expect(cell(mode, "E4").formula).toContain(`'_Scenario Calc'!${workbookMapping.scenario.calculation.selectedRootCell}`);
    let sumEffects = 0;
    for (const [id, entry] of Object.entries(workbookMapping.scenario.drivers)) {
      const value = model.scenarios[1]!.overrides.find((override) => override.nodeId === id)!.value;
      const isolated = calculateGraph(model, { overrides: [{ nodeId: id, value }] });
      const effect = isolated.rootValue! - base.rootValue!;
      sumEffects += effect;
      expect(Number(cell(helpers, entry.isolatedRootCell!).value)).toBe(isolated.rootValue);
      expect(Number(cell(mode, entry.effectCell).value)).toBe(effect);
      expect(cell(mode, entry.effectCell).formula).toContain(`'_Scenario Calc'!${entry.isolatedRootCell}`);
      expect(cell(mode, entry.scenarioCell).formula).toBeUndefined();
    }
    expect(Number(cell(mode, "E8").value)).toBe(selected.rootValue! - base.rootValue! - sumEffects);
    expect(cell(mode, "E8").formula).toContain("ISNUMBER(E11)");
    expect(cell(mode, "E8").formula).toContain("ISNUMBER(E12)");
    expect(parts["xl/workbook.xml"]).toContain('sheet name="_Scenario Calc" sheetId="5" r:id="rId5" state="hidden"');
    expect(Object.keys(workbookMapping.scenario.drivers)).toEqual(rankScenarioInputNodes(model).map((entry) => entry.nodeId));
  });

  it("preserves formula-bearing inputs, explicit equal-baseline overrides and cleared-override fallbacks", () => {
    const model = project([node("root", { type: "calculated", formula: "derived" }), node("derived", { formula: "input*2" }), node("input", { value: 1 })]);
    model.scenarios = [{ id: "selected", name: "Selected", overrides: [{ nodeId: "input", value: 3 }], createdAt: date, updatedAt: date }];
    const exported = workbook(model);
    const mapping = exported.workbookMapping;
    const row = mapping.scenario.drivers.derived!;
    const mode = exported.parts["xl/worksheets/sheet4.xml"]!;
    const helpers = exported.parts["xl/worksheets/sheet5.xml"]!;
    expect(cell(mode, row.scenarioCell).value).toBe("2");
    expect(cell(mode, row.scenarioCell).formula).toBe(row.baselineCell);
    expect(cell(mode, "E4").value).toBe("6");
    const sourceFormula = cell(exported.sheet, mapping.tree.input!.baselineCell).formula!;
    expect(sourceFormula).toContain("IF(ROWS(SourceInputs[KPI])=1,1,MATCH(TRUE,INDEX(");
    const helperDerived = `B${mapping.scenario.calculation.nodeRows.derived}`;
    expect(cell(helpers, helperDerived).formula).toContain(`IF(OR(ISBLANK('Scenario Mode'!${row.scenarioCell}),IFERROR(_xlfn.FORMULATEXT('Scenario Mode'!${row.scenarioCell}),"")="=${row.baselineCell}"),IF(AND(ISNUMBER(B5)),(B5*2),NA())`);
    model.scenarios[0]!.overrides.push({ nodeId: "derived", value: 2 });
    const explicit = workbook(model);
    expect(cell(explicit.parts["xl/worksheets/sheet4.xml"]!, "E4").value).toBe("2");
    expect(cell(explicit.parts["xl/worksheets/sheet4.xml"]!, explicit.workbookMapping.scenario.drivers.derived!.scenarioCell).value).toBe("2");
  });

  it("preserves fixed and additional calculated overrides while deduplicating driver effects last-wins", () => {
    const model = project([node("root", { type: "calculated", formula: "calc + input + fixed" }), node("calc", { type: "calculated", formula: "input*2" }), node("input", { value: 2 }), node("fixed", { value: 5, fixedInScenario: true })]);
    model.scenarios = [{ id: "selected", name: "Selected", overrides: [{ nodeId: "input", value: 10 }, { nodeId: "input", value: 0 }, { nodeId: "fixed", value: 100 }, { nodeId: "calc", value: 20 }], createdAt: date, updatedAt: date }];
    const { parts, workbookMapping } = workbook(model);
    const mode = parts["xl/worksheets/sheet4.xml"]!;
    expect(Object.keys(workbookMapping.scenario.drivers)).toEqual(["input"]);
    expect(Object.keys(workbookMapping.scenario.additionalOverrides)).toEqual(["calc"]);
    expect(cell(mode, workbookMapping.scenario.drivers.input!.scenarioCell).value).toBe("0");
    expect(cell(mode, workbookMapping.scenario.additionalOverrides.calc!.scenarioCell).value).toBe("20");
    expect(cell(mode, "B4").value).toBe("11");
    expect(cell(mode, "E4").value).toBe("25");
    expect(cell(mode, workbookMapping.scenario.drivers.input!.effectCell).value).toBe("-6");
    expect(cell(mode, "E8").value).toBe("20");
    expect(parts["xl/worksheets/sheet2.xml"]).toContain("Duplicate imported overrides normalize to the last value");
  });

  it("starts a usable baseline scenario without saved scenarios and reports missing and zero-baseline metrics honestly", () => {
    const model = project([node("root", { type: "calculated", formula: "input*2" }), node("input", { value: 0 })]);
    const { parts, workbookMapping } = workbook(model, { scenarioId: "unknown" });
    const mode = parts["xl/worksheets/sheet4.xml"]!;
    expect(workbookMapping.scenario.selectedScenarioId).toBeUndefined();
    expect(cell(mode, "E4").value).toBe("0");
    expect(cell(mode, "B6").value).toBe("0");
    expect(cell(mode, "E6").value).toBe("#N/A");
    expect(cell(mode, "E8").value).toBe("0");
    model.graph.nodes[1]!.value = undefined;
    const missing = workbook(model);
    const missingMode = missing.parts["xl/worksheets/sheet4.xml"]!;
    expect(cell(missingMode, "E4").value).toBe("#N/A");
    expect(cell(missingMode, "E8").value).toBe("#N/A");
    expect(cell(missingMode, "E8").formula).toContain("ISNUMBER(E11)");
  });

  it("shares selected main controls with tree Potential and uses first scenario fallback for an unknown selected ID", () => {
    const model = project([node("root", { type: "calculated", formula: "input*2" }), node("input", { value: 3 })]);
    model.scenarios = [{ id: "main", name: "Main", isMain: true, overrides: [{ nodeId: "input", value: 4 }], createdAt: date, updatedAt: date }];
    const { parts, sheet, workbookMapping } = workbook(model, { scenarioId: "unknown" });
    expect(workbookMapping.scenario.selectedScenarioId).toBe("main");
    expect(cell(sheet, workbookMapping.tree.input!.potentialCell).formula).toContain(`'Scenario Mode'!${workbookMapping.scenario.drivers.input!.scenarioCell}`);
    expect(parts["xl/worksheets/sheet4.xml"]).not.toContain("controls");
    expect(parts["xl/worksheets/sheet2.xml"]).toContain("uses this same Scenario Mode calculation");
  });

  it("ignores parentheses and doubled quotes inside Source key literals when checking native function depth", () => {
    const model = project([node("root", { name: 'X('.repeat(80) + '"quoted"' + ')'.repeat(80), value: 1 })]);
    expect(() => exportProjectExcel(model)).not.toThrow();
  });

  it("keeps an initial cycle-breaking override valid while removing it falls back to NA without restoring circular formulas", () => {
    const model = project([node("root", { formula: "other+1" }), node("other", { formula: "root+1" })]);
    model.scenarios = [{ id: "main", name: "Main", isMain: true, overrides: [{ nodeId: "other", value: 10 }], createdAt: date, updatedAt: date }];
    const { parts, sheet, workbookMapping } = workbook(model);
    const helpers = parts["xl/worksheets/sheet5.xml"]!;
    const helperRoot = cell(helpers, "B3");
    const helperOther = cell(helpers, "B4");
    expect(helperRoot.value).toBe("11");
    expect(helperRoot.formula).toContain("(B4+1)");
    expect(helperOther.formula).toContain(`IF(OR(ISBLANK('Scenario Mode'!${workbookMapping.scenario.drivers.other!.scenarioCell}),IFERROR(_xlfn.FORMULATEXT('Scenario Mode'!${workbookMapping.scenario.drivers.other!.scenarioCell}),"")="=${workbookMapping.scenario.drivers.other!.baselineCell}"),NA(),`);
    expect(helperOther.formula).not.toContain("B3");
    expect(cell(sheet, workbookMapping.tree.root!.potentialCell).formula).toContain("'_Scenario Calc'!B3");
    expect(parts["xl/worksheets/sheet2.xml"]).toContain("Clearing a saved cycle-breaking override makes the cyclic calculation unavailable");
  });

  it.each(["=Equals", "<Less", ">More", "x".repeat(300), '"Quoted" * ? ~'])
    ("uses native boolean Source equality for operator, wildcard and long label %s", (name) => {
      const model = project([node("root", { name, value: 7 })]);
      const { sheet, parts, workbookMapping } = workbook(model);
      const expression = cell(sheet, workbookMapping.tree.root!.baselineCell).formula!;
      expect(expression).toContain("MATCH(TRUE,INDEX(SourceInputs[KPI]=");
      expect(expression).not.toContain(name);
      expect(cell(parts["xl/worksheets/sheet5.xml"]!, workbookMapping.source.root!.keyCell).type).toBe("inlineStr");
      expect(cell(sheet, workbookMapping.tree.root!.baselineCell).value).toBe("7");
    });
});
