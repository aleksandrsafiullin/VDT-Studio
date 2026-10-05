import { strToU8, zipSync } from "fflate";
import type { FormulaExpression } from "../formula/ast";
import { calculateGraph } from "../formula/calculate";
import { extractReferencesFromAst } from "../formula/evaluator";
import { parseFormula } from "../formula/parser";
import { calculateScenarioGraph, getActiveScenarioOverrides } from "../scenario/scenario";
import { rankScenarioInputNodes } from "../scenario/sensitivity";
import type { GraphCalculationResult, VdtNode, VdtProject } from "../types";

export const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface ExcelNodeCells {
  /** One-based worksheet column and row. Adjacent depths use columns A, D, G, ... */
  column: number;
  headerRow: number;
  nameCell: string;
  baselineCell: string;
  potentialCell: string;
}

export interface ExcelExportOptions {
  scenarioId?: string | undefined;
}

export interface ExcelScenarioRow {
  row: number;
  baselineCell: string;
  scenarioCell: string;
  effectCell: string;
  /** Root cell on the hidden _Scenario Calc sheet, absent for additional overrides. */
  isolatedRootCell?: string;
}

export interface ExcelWorkbookCells {
  tree: Record<string, ExcelNodeCells>;
  source: Record<string, { row: number; valueCell: string; kpiLabel: string; keyCell: string }>;
  scenario: {
    selectedScenarioId?: string;
    drivers: Record<string, ExcelScenarioRow>;
    additionalOverrides: Record<string, ExcelScenarioRow>;
    totals: { baselineCell: string; scenarioCell: string; absoluteChangeCell: string; percentageChangeCell: string; multiplicativeEffectCell: string };
    calculation: { nodeRows: Record<string, number>; selectedRootCell: string };
  };
}

const CARD_ROWS = 5;
const FIRST_CARD_ROW = 5;
const MAX_COLUMNS = 16_384;
const MAX_ROWS = 1_048_576;
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function xml(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnName(column: number) {
  let name = "";
  while (column > 0) {
    column -= 1;
    name = String.fromCharCode(65 + column % 26) + name;
    column = Math.floor(column / 26);
  }
  return name;
}

function address(column: number, row: number) {
  return `${columnName(column)}${row}`;
}

function textHeight(text: string, columnWidth: number, lineHeight = 15) {
  // Column widths use the width of a digit, while names can contain wider letters.
  // Leave room for that difference and Excel's cell padding when estimating wraps.
  const capacity = Math.max(1, Math.floor(columnWidth * 0.8));
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    let used = 0;
    lines++;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (used && used + word.length + 1 > capacity) { lines++; used = 0; }
      const length = word.length + (used ? 1 : 0);
      lines += Math.floor((length + used - 1) / capacity);
      used = (used + length - 1) % capacity + 1;
    }
  }
  return Math.min(409, Math.max(24, lines * lineHeight + 12));
}

/** Strongly connected components also make malformed visual cycles finite to lay out. */
function components(ids: string[], adjacent: Map<string, string[]>) {
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const result: string[][] = [];
  let index = 0;
  const visit = (id: string) => {
    indices.set(id, index);
    low.set(id, index++);
    stack.push(id);
    active.add(id);
    for (const child of adjacent.get(id) ?? []) {
      if (!indices.has(child)) {
        visit(child);
        low.set(id, Math.min(low.get(id)!, low.get(child)!));
      } else if (active.has(child)) {
        low.set(id, Math.min(low.get(id)!, indices.get(child)!));
      }
    }
    if (low.get(id) === indices.get(id)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        active.delete(member);
        component.push(member);
      } while (member !== id);
      result.push(component);
    }
  };
  for (const id of ids) if (!indices.has(id)) visit(id);
  return result;
}

function excelLayout(project: VdtProject) {
  const nodes = project.graph.nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ids = nodes.map((node) => node.id);
  const indexById = new Map(ids.map((id, i) => [id, i]));
  const adjacent = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of project.graph.edges) {
    if (nodeById.has(edge.sourceNodeId) && nodeById.has(edge.targetNodeId)) {
      adjacent.get(edge.sourceNodeId)!.push(edge.targetNodeId);
    }
  }
  const groups = components(ids, adjacent);
  const groupById = new Map(groups.flatMap((group, i) => group.map((id) => [id, i] as const)));
  const parents = groups.map(() => new Set<number>());
  for (const [id, children] of adjacent) {
    for (const child of children) {
      const parentGroup = groupById.get(id)!;
      const childGroup = groupById.get(child)!;
      if (parentGroup !== childGroup) parents[childGroup]!.add(parentGroup);
    }
  }
  const depths = new Map<number, number>();
  const depthOf = (group: number): number => {
    if (!depths.has(group)) {
      depths.set(group, Math.max(0, ...[...parents[group]!].map((parent) => depthOf(parent) + 1)));
    }
    return depths.get(group)!;
  };
  const depth = new Map(ids.map((id) => [id, depthOf(groupById.get(id)!)]));
  const children = new Map(ids.map((id) => [id, [] as string[]]));
  const owned = new Set<string>();
  // A shared node has one canonical card/input. Pick its first deepest incoming parent
  // for row placement; every visual edge still receives a border connector below.
  for (const id of ids) {
    for (const child of adjacent.get(id)!) {
      if (depth.get(child) === depth.get(id)! + 1 && !owned.has(child)) {
        children.get(id)!.push(child);
        owned.add(child);
      }
    }
  }
  const order = (a: string, b: string) =>
    (nodeById.get(a)?.position?.y ?? indexById.get(a)!) - (nodeById.get(b)?.position?.y ?? indexById.get(b)!);
  for (const entries of children.values()) entries.sort(order);
  const roots = ids.filter((id) => !owned.has(id)).sort((a, b) =>
    a === project.rootNodeId ? -1 : b === project.rootNodeId ? 1 : order(a, b));
  const slots = new Map<string, number>();
  let nextSlot = 0;
  const place = (id: string): number => {
    const childSlots = children.get(id)!.map(place);
    const slot = childSlots.length > 0
      ? Math.floor((childSlots[0]! + childSlots[childSlots.length - 1]!) / 2)
      : nextSlot++;
    slots.set(id, slot);
    return slot;
  };
  for (const root of roots) place(root);
  const mapping: Record<string, ExcelNodeCells> = Object.create(null) as Record<string, ExcelNodeCells>;
  for (const id of ids) {
    const column = depth.get(id)! * 3 + 1;
    const headerRow = FIRST_CARD_ROW + slots.get(id)! * CARD_ROWS;
    if (column > MAX_COLUMNS || headerRow + 2 > MAX_ROWS) {
      throw new Error("The VDT exceeds Excel's worksheet row or column limit.");
    }
    mapping[id] = {
      column, headerRow, nameCell: address(column, headerRow),
      baselineCell: address(column, headerRow + 1), potentialCell: address(column, headerRow + 2)
    };
  }
  return mapping;
}

/** Stable node ID to canonical editable card coordinates. Formula dependencies do not use visual edges. */
export function getExcelNodeCells(project: VdtProject): Record<string, ExcelNodeCells> {
  return excelLayout(project);
}

function selectedScenario(project: VdtProject, options: ExcelExportOptions) {
  return project.scenarios.find((scenario) => scenario.id === options.scenarioId) ?? project.scenarios[0];
}

/** Coordinates on Source, Scenario Mode and _Scenario Calc; Source labels remain stable during table sorting. */
export function getExcelWorkbookCells(project: VdtProject, options: ExcelExportOptions = {}): ExcelWorkbookCells {
  const tree = excelLayout(project);
  const source: ExcelWorkbookCells["source"] = Object.create(null) as ExcelWorkbookCells["source"];
  const labels = new Set<string>();
  for (const [index, node] of project.graph.nodes.entries()) {
    if (node.formula?.trim() || source[node.id]) continue;
    const base = `${node.name}${node.unit ? ` [${node.unit}]` : ""}`;
    let label = base;
    let suffix = 2;
    while (labels.has(label.toLocaleLowerCase("en-US"))) label = `${base} (${suffix++})`;
    labels.add(label.toLocaleLowerCase("en-US"));
    const row = Object.keys(source).length + 6;
    source[node.id] = { row, valueCell: address(2, row), kpiLabel: label, keyCell: address(1, index + 3) };
  }
  const selected = selectedScenario(project, options);
  const ranked = rankScenarioInputNodes(project);
  const drivers: Record<string, ExcelScenarioRow> = Object.create(null) as Record<string, ExcelScenarioRow>;
  const nodeRows = Object.fromEntries(project.graph.nodes.map((node, i) => [node.id, i + 3]));
  ranked.forEach((node, i) => {
    const row = i + 11;
    drivers[node.nodeId] = { row, baselineCell: address(3, row), scenarioCell: address(4, row), effectCell: address(5, row), isolatedRootCell: address(i + 3, nodeRows[project.rootNodeId] ?? 2) };
  });
  const activeOverrides = new Map(selected ? getActiveScenarioOverrides(project, selected).map((item) => [item.nodeId, item.value]) : []);
  const additionalOverrides: Record<string, ExcelScenarioRow> = Object.create(null) as Record<string, ExcelScenarioRow>;
  for (const node of project.graph.nodes) {
    if (drivers[node.id] || !activeOverrides.has(node.id)) continue;
    const row = ranked.length + Object.keys(additionalOverrides).length + 15;
    additionalOverrides[node.id] = { row, baselineCell: address(3, row), scenarioCell: address(4, row), effectCell: address(5, row) };
  }
  if (ranked.length + 2 > MAX_COLUMNS || project.graph.nodes.length + 2 > MAX_ROWS) {
    throw new Error("The scenario calculation exceeds Excel's worksheet row or column limit.");
  }
  return { tree, source, scenario: {
    ...(selected ? { selectedScenarioId: selected.id } : {}), drivers, additionalOverrides,
    totals: { baselineCell: "B4", scenarioCell: "E4", absoluteChangeCell: "B6", percentageChangeCell: "E6", multiplicativeEffectCell: "E8" },
    calculation: { nodeRows, selectedRootCell: address(2, nodeRows[project.rootNodeId] ?? 2) }
  } };
}

function numericLink(reference: string) { return `IF(ISNUMBER(${reference}),${reference},NA())`; }
function inheritsBaseline(reference: string, baselineCell: string) {
  // Only the exact exported adjacent-cell formula is an inherited default.
  // Other user formulas (even one equal to Baseline) are genuine own overrides.
  return `OR(ISBLANK(${reference}),IFERROR(_xlfn.FORMULATEXT(${reference}),"")="=${baselineCell}")`;
}
function sourceLookup(keyCell: string) {
  const key = `'_Scenario Calc'!${keyCell}`;
  // Boolean equality avoids COUNTIF/MATCH criteria operators, wildcards and their
  // 255-character criteria limit. INDEX makes the boolean array work without CSE.
  const equality = `SourceInputs[KPI]=${key}`;
  // A one-row table produces a scalar equality; INDEX(scalar,0) is not portable.
  // The uniqueness guard below already proves that its only row is the matching row.
  const row = `IF(ROWS(SourceInputs[KPI])=1,1,MATCH(TRUE,INDEX(${equality},0),0))`;
  const lookup = `INDEX(SourceInputs[Value],${row})`;
  return `IF(SUMPRODUCT(--(${equality}))=1,IF(ISBLANK(${lookup}),NA(),${numericLink(lookup)}),NA())`;
}

function variadicCall(name: "MIN" | "MAX" | "AND", args: string[]): string {
  // Excel allows 255 arguments per call; the VDT grammar has no such restriction.
  if (args.length <= 255) return `${name}(${args.join(",")})`;
  const groups: string[] = [];
  for (let i = 0; i < args.length; i += 255) groups.push(variadicCall(name, args.slice(i, i + 255)));
  return variadicCall(name, groups);
}

function translate(expression: FormulaExpression, resolve: (id: string) => string): string {
  switch (expression.type) {
    case "number": return String(expression.value);
    case "reference": return resolve(expression.name);
    case "unary": return `(-${translate(expression.expression, resolve)})`;
    case "binary": return `(${translate(expression.left, resolve)}${expression.operator}${translate(expression.right, resolve)})`;
    case "call": return variadicCall(expression.name === "min" ? "MIN" : "MAX", expression.args.map((arg) => translate(arg, resolve)));
  }
}

function resolvedFormula(expression: FormulaExpression, resolve: (id: string) => string) {
  const references = extractReferencesFromAst(expression);
  const formula = translate(expression, resolve);
  // Excel arithmetic and MIN/MAX otherwise treat blanks/text as zero or ignore them.
  return references.length === 0 ? formula
    : `IF(${variadicCall("AND", references.map((id) => `ISNUMBER(${resolve(id)})`))},${formula},NA())`;
}

function guardedFormula(expression: FormulaExpression, mapping: Record<string, ExcelNodeCells>, potential: boolean) {
  return resolvedFormula(expression, (id) => {
    const cell = mapping[id];
    return cell ? (potential ? cell.potentialCell : cell.baselineCell) : "#REF!";
  });
}

function formulaCycles(nodes: VdtNode[], overrides: Map<string, number>) {
  const ids = nodes.map((node) => node.id);
  const known = new Set(ids);
  const adjacent = new Map(nodes.map((node) => {
    let references: string[] = [];
    if (node.status !== "rejected" && !overrides.has(node.id) && node.formula?.trim()) {
      try { references = extractReferencesFromAst(parseFormula(node.formula)).filter((id) => known.has(id)); } catch { /* Reported in Guide. */ }
    }
    return [node.id, references] as const;
  }));
  return new Set(components(ids, adjacent).flatMap((group) =>
    group.length > 1 || adjacent.get(group[0]!)!.includes(group[0]!) ? group : []));
}

interface Cell {
  column: number;
  row: number;
  text?: string;
  number?: number;
  formula?: string;
  error?: string;
  label?: string;
  style: number;
  numberFormat?: "base" | "potential" | "plain" | "percent";
}

function cellXml(cell: Cell) {
  const label = cell.label ? `KPI "${cell.label.slice(0, 120)}" at cell ${address(cell.column, cell.row)}` : `cell ${address(cell.column, cell.row)}`;
  if ((cell.text?.length ?? 0) > 32_767) {
    throw new Error(`The ${label} exceeds Excel's cell text length limit (32,767 characters).`);
  }
  if ((cell.formula?.length ?? 0) > 8_192) {
    throw new Error(`The ${label} exceeds Excel's formula length limit (8,192 characters).`);
  }
  if (cell.formula) {
    const functionParentheses: boolean[] = [];
    let functionDepth = 0;
    let quote: '"' | "'" | undefined;
    for (let index = 0; index < cell.formula.length; index++) {
      const char = cell.formula[index];
      if (quote) {
        if (char === quote) {
          if (cell.formula[index + 1] === quote) index++;
          else quote = undefined;
        }
        continue;
      }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "(") {
        const isFunction = /[A-Z]/.test(cell.formula[index - 1] ?? "");
        functionParentheses.push(isFunction);
        if (isFunction && ++functionDepth > 64) {
          throw new Error(`The ${label} exceeds Excel's nested function limit (64 levels).`);
        }
      } else if (cell.formula[index] === ")" && functionParentheses.pop()) {
        functionDepth--;
      }
    }
  }
  const start = `<c r="${address(cell.column, cell.row)}" s="${cell.style}"`;
  if (cell.text !== undefined) return `${start} t="inlineStr"><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>`;
  const formula = cell.formula === undefined ? "" : `<f>${xml(cell.formula)}</f>`;
  if (cell.error) return `${start} t="e">${formula}<v>${xml(cell.error)}</v></c>`;
  return `${start}>${formula}${cell.number === undefined ? "" : `<v>${cell.number}</v>`}</c>`;
}

function sheetXml(cells: Map<string, Cell>, columns: number, rowHeights: Map<number, number>, widths: number[], tree: boolean, options: { table?: boolean; mergeTitle?: boolean; freezeRows?: number } = {}) {
  const byRow = new Map<number, Cell[]>();
  for (const cell of cells.values()) {
    if (!byRow.has(cell.row)) byRow.set(cell.row, []);
    byRow.get(cell.row)!.push(cell);
  }
  const rows = [...byRow].sort(([a], [b]) => a - b).map(([row, entries]) =>
    `<row r="${row}"${rowHeights.has(row) ? ` ht="${rowHeights.get(row)}" customHeight="1"` : ""}>${entries.sort((a, b) => a.column - b.column).map(cellXml).join("")}</row>`).join("");
  const lastRow = Math.max(1, ...byRow.keys());
  const cols = Array.from({ length: columns }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${widths[i] ?? 32}" customWidth="1"/>`).join("");
  const frozen = options.freezeRows ?? (tree ? 3 : 0);
  return `${XML_HEADER}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><dimension ref="A1:${address(columns, lastRow)}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0">${frozen ? `<pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/>` : ""}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${cols}</cols><sheetData>${rows}</sheetData>${(tree || options.mergeTitle) && columns > 1 ? `<mergeCells count="2"><mergeCell ref="A1:${address(columns, 1)}"/><mergeCell ref="A2:${address(columns, 2)}"/></mergeCells>` : ""}${conditionalFormats(cells)}<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>${options.table ? '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>' : ""}</worksheet>`;
}

const NUMBER_KINDS = ["base", "potential", "plain", "percent"] as const;
// Excel rejects sections with more than 48 numeric placeholders. Fifteen
// space groups use 48 including the two decimal digits; larger values use E notation.
const SPACE_GROUPS = 15;
const SCIENTIFIC_THRESHOLD = "1E48";
const NUMBER_RULES_PER_KIND = SPACE_GROUPS + 1;
function numberFormat(kind: typeof NUMBER_KINDS[number], groups = 0, scientific = false) {
  const prefix = kind === "base" ? '"Base: "' : kind === "potential" ? '"Potential: "' : "";
  const suffix = kind === "percent" ? '"%"' : "";
  // Literal-space groups do not repeat like Excel's comma group operator.
  // A magnitude-dependent mask prevents unused leading groups/padding.
  const mask = scientific ? "0.00E+00" : groups ? "#" + '\\ ###'.repeat(groups - 1) + '\\ ##0.00' : "0.00";
  return prefix ? `${prefix}${mask};${prefix}-${mask}` : mask + suffix;
}
const numberRules = NUMBER_KINDS.flatMap((kind) => [
  { kind, threshold: SCIENTIFIC_THRESHOLD, format: numberFormat(kind, 0, true) },
  ...Array.from({ length: SPACE_GROUPS }, (_, i) => ({ kind, threshold: `1E${(SPACE_GROUPS - i) * 3}`, format: numberFormat(kind, SPACE_GROUPS - i) }))
]);

function conditionalFormats(cells: Map<string, Cell>) {
  let priority = 0;
  return NUMBER_KINDS.map((kind, kindIndex) => {
    const numericCells = [...cells.values()].filter((cell) =>
      (cell.formula !== undefined || cell.number !== undefined || cell.error !== undefined || cell.style === 9 || cell.style === 10)
      && (cell.numberFormat ?? (cell.style === 2 ? "base" : cell.style === 3 ? "potential" : cell.style === 12 ? "percent" : "plain")) === kind);
    const byColumn = new Map<number, number[]>();
    for (const cell of numericCells) {
      if (!byColumn.has(cell.column)) byColumn.set(cell.column, []);
      byColumn.get(cell.column)!.push(cell.row);
    }
    // Use one origin per column. Spreadsheet engines disagree about the origin
    // of sparse multi-column sqref areas when the earliest cell is not leftmost.
    return [...byColumn].sort(([a], [b]) => a - b).map(([column, rows]) => {
      rows.sort((a, b) => a - b);
      const ranges: { row: number; last: number }[] = [];
      for (const row of rows) {
        const previous = ranges[ranges.length - 1];
        if (previous && previous.last === row - 1) previous.last = row;
        else ranges.push({ row, last: row });
      }
      const reference = address(column, ranges[0]!.row);
      const sqref = ranges.map((range) => address(column, range.row) + (range.last > range.row ? `:${address(column, range.last)}` : "")).join(" ");
      return `<conditionalFormatting sqref="${sqref}">${numberRules.slice(kindIndex * NUMBER_RULES_PER_KIND, (kindIndex + 1) * NUMBER_RULES_PER_KIND).map((rule, i) =>
        `<cfRule type="expression" dxfId="${kindIndex * NUMBER_RULES_PER_KIND + i}" priority="${++priority}" stopIfTrue="1"><formula>${xml(`IFERROR(AND(ISNUMBER(${reference}),ROUND(ABS(${reference}),2)>=${rule.threshold}),FALSE)`)}</formula></cfRule>`).join("")}</conditionalFormatting>`;
    }).join("");
  }).join("");
}

function stylesXml() {
  const thin = '<left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/>';
  // Connector bit 1 = top, bit 2 = right. Border-only cells stay truly empty.
  const connectorBorders = [1, 2, 3].map((bits) => `<border><left/>${bits & 2 ? '<right style="thin"><color rgb="FF64748B"/></right>' : '<right/>'}${bits & 1 ? '<top style="thin"><color rgb="FF64748B"/></top>' : '<top/>'}<bottom/><diagonal/></border>`).join("");
  const xf = (font: number, fill: number, border: number, format = 0, wrap = false) =>
    `<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"${wrap ? ' wrapText="1"' : ""}/></xf>`;
  const formats = [numberFormat("base"), numberFormat("potential"), numberFormat("percent"), numberFormat("plain"), ...numberRules.map((rule) => rule.format)];
  const font = (size: number, color: string, bold = false) => `<font>${bold ? "<b/>" : ""}<sz val="${size}"/><color rgb="FF${color}"/><name val="Calibri"/></font>`;
  const fonts = [font(11, "0F172A"), font(11, "FFFFFF", true), font(16, "0F172A", true), font(14, "0F766E", true), font(10, "475569", true), font(11, "64748B"), font(14, "FFFFFF", true)];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', ...["334155", "DBEAFE", "DCFCE7", "F1F5F9", "E6F4F1", "0F766E"].map((color) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`)];
  const xfs = [xf(0, 0, 0, 167), xf(1, 2, 1, 0, true), xf(0, 3, 1, 164), xf(0, 4, 1, 165), xf(2, 0, 0, 0, true), xf(0, 0, 2), xf(0, 0, 3), xf(0, 0, 4), xf(0, 0, 0, 0, true), xf(0, 3, 1, 167), xf(0, 4, 1, 167), xf(0, 0, 1, 167), xf(0, 0, 1, 166),
    xf(4, 5, 0, 0, true), xf(3, 5, 0, 167), xf(4, 6, 0, 0, true), xf(3, 6, 0, 167), xf(1, 7, 0, 0, true), xf(6, 7, 0, 167), xf(3, 6, 0, 166), xf(0, 5, 1, 0, true), xf(0, 0, 1, 0, true), xf(0, 5, 1, 167), xf(3, 0, 1, 167), xf(3, 5, 1, 167), xf(5, 0, 0, 0, true)];
  return `${XML_HEADER}<styleSheet xmlns="${MAIN_NS}"><numFmts count="${formats.length}">${formats.map((format, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(format)}"/>`).join("")}</numFmts><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="5"><border><left/><right/><top/><bottom/><diagonal/></border><border>${thin}</border>${connectorBorders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${numberRules.length}">${numberRules.map((rule, i) => `<dxf><numFmt numFmtId="${168 + i}" formatCode="${xml(rule.format)}"/></dxf>`).join("")}</dxfs></styleSheet>`;
}

function cachedResult(calculation: GraphCalculationResult, nodeId: string): Pick<Cell, "number" | "error"> {
  const value = calculation.values[nodeId];
  if (value !== undefined) return { number: value };
  const error = calculation.errors.find((item) => item.nodeId === nodeId);
  return { error: error?.type === "division_by_zero" ? "#DIV/0!" : error?.type === "invalid_value" ? "#NUM!" : "#N/A" };
}

function cachedNumber(value: number | undefined): Pick<Cell, "number" | "error"> {
  return value === undefined || !Number.isFinite(value) ? { error: "#N/A" } : { number: value };
}

function provenance(project: VdtProject, node: VdtNode) {
  const sources: string[] = [];
  const comments: string[] = [];
  if (node.valueSource?.sourceTier) sources.push(node.valueSource.sourceTier);
  if (node.valueSource?.catalogRef) sources.push(node.valueSource.catalogRef);
  if (node.dataMapping) {
    const mapping = node.dataMapping;
    const dataSource = project.dataSources.find((candidate) => candidate.id === mapping.sourceId);
    sources.push([dataSource?.name ?? mapping.sourceId, mapping.tableId, mapping.field].filter(Boolean).join(" / "));
    if (dataSource?.file?.fileName) sources.push(dataSource.file.fileName);
    if (mapping.aggregation) comments.push(`Aggregation: ${mapping.aggregation}`);
    if (mapping.transform) comments.push(`Transform: ${mapping.transform}`);
  }
  if (node.description) comments.push(node.description);
  if (node.valueSource?.note) comments.push(node.valueSource.note);
  if (node.valueSource?.confidence) comments.push(`Confidence: ${node.valueSource.confidence}`);
  if (node.fixedInScenario) comments.push("Fixed in Scenario: own override is ignored.");
  if (node.status === "rejected") comments.push("Rejected KPI: excluded from calculations.");
  return { source: [...new Set(sources)].join("; "), comment: comments.join("\n") };
}

function analysisSheets(project: VdtProject, mapping: ExcelWorkbookCells, options: ExcelExportOptions, baseline: GraphCalculationResult) {
  const selected = selectedScenario(project, options);
  const configured = new Map(selected ? getActiveScenarioOverrides(project, selected).map((item) => [item.nodeId, item.value]) : []);
  const selectedCalculation = selected ? calculateScenarioGraph(project, selected) : baseline;
  const source = new Map<string, Cell>();
  const scenario = new Map<string, Cell>();
  const helpers = new Map<string, Cell>();
  const add = (sheet: Map<string, Cell>, cell: Cell) => sheet.set(address(cell.column, cell.row), cell);
  const text = (sheet: Map<string, Cell>, row: number, column: number, value: string, style = 8) => add(sheet, { row, column, text: value, style });
  text(source, 1, 1, "Source", 4);
  text(source, 2, 1, "Edit Value, Source and Comment. Values feed the entire workbook. KPI labels are unique lookup keys: keep them unchanged. Sorting and filtering are supported.");
  ["KPI", "Value", "Source", "Comment"].forEach((name, i) => text(source, 5, i + 1, name, 1));
  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  for (const [id, entry] of Object.entries(mapping.source)) {
    const node = nodeById.get(id)!;
    const value = node.baselineValue ?? node.value;
    const info = provenance(project, node);
    text(source, entry.row, 1, entry.kpiLabel);
    add(source, { row: entry.row, column: 2, ...(value === undefined ? {} : Number.isFinite(value) ? { number: value } : { formula: "NA()", error: "#NUM!" }), label: node.name, style: 9 });
    text(source, entry.row, 3, info.source);
    text(source, entry.row, 4, info.comment);
  }
  if (Object.keys(mapping.source).length === 0) {
    text(source, 3, 1, "This model has no formula-free inputs or constants.");
    for (let column = 1; column <= 4; column++) add(source, { row: 6, column, style: 0 });
  }
  text(scenario, 1, 1, "Scenario Mode", 4);
  text(scenario, 2, 1, selected?.name ?? "Baseline scenario", 25);
  text(scenario, 4, 1, "Total BASELINE", 13);
  text(scenario, 4, 4, "Total SCENARIO", 15);
  text(scenario, 6, 1, "Absolute change", 13);
  text(scenario, 6, 4, "Percent change", 15);
  text(scenario, 8, 4, "Multiplicative effect", 17);
  for (const row of [3, 5, 7, 9]) add(scenario, { row, column: 1, style: 0 });
  ["Name", "Unit", "Baseline", "Scenario", "Effect"].forEach((name, i) => text(scenario, 10, i + 1, name, 1));
  const delta = baseline.rootValue === undefined || selectedCalculation.rootValue === undefined ? undefined : selectedCalculation.rootValue - baseline.rootValue;
  const summary = mapping.scenario.totals;
  const baseRoot = mapping.tree[project.rootNodeId];
  const rootReference = baseRoot ? `'VDT'!${baseRoot.baselineCell}` : "#REF!";
  const selectedReference = `'_Scenario Calc'!${mapping.scenario.calculation.selectedRootCell}`;
  add(scenario, { row: 4, column: 2, formula: numericLink(rootReference), ...cachedNumber(baseline.rootValue), style: 14 });
  add(scenario, { row: 4, column: 5, formula: numericLink(selectedReference), ...cachedNumber(selectedCalculation.rootValue), style: 16 });
  add(scenario, { row: 6, column: 2, formula: `IF(AND(ISNUMBER(B4),ISNUMBER(E4)),E4-B4,NA())`, ...cachedNumber(delta), style: 14 });
  add(scenario, { row: 6, column: 5, formula: `IF(AND(ISNUMBER(B4),ISNUMBER(E4)),IF(B4=0,NA(),(E4-B4)/ABS(B4)*100),NA())`, ...cachedNumber(baseline.rootValue === undefined || baseline.rootValue === 0 || delta === undefined ? undefined : delta / Math.abs(baseline.rootValue) * 100), style: 19, numberFormat: "percent" });
  const isolatedResults = new Map<string, GraphCalculationResult>();
  const isolatedEffects: (number | undefined)[] = [];
  const allControls = { ...mapping.scenario.drivers, ...mapping.scenario.additionalOverrides };
  for (const [id, entry] of Object.entries(allControls)) {
    const node = nodeById.get(id)!;
    const base = mapping.tree[id]!;
    const baseReference = `'VDT'!${base.baselineCell}`;
    const zebra = entry.row % 2 === 1;
    text(scenario, entry.row, 1, node.name, zebra ? 20 : 21);
    text(scenario, entry.row, 2, node.unit ?? "", zebra ? 20 : 21);
    add(scenario, { row: entry.row, column: 3, formula: numericLink(baseReference), ...cachedResult(baseline, id), label: node.name, style: zebra ? 22 : 11 });
    const override = configured.get(id);
    const hasOverride = configured.has(id);
    add(scenario, { row: entry.row, column: 4,
      ...(hasOverride ? Number.isFinite(override) ? { number: override! } : { formula: "NA()", error: "#NUM!" }
        : { formula: entry.baselineCell, ...cachedResult(baseline, id) }), label: node.name, style: 10 });
    if (entry.isolatedRootCell) {
      const isolated = hasOverride ? calculateGraph(project, { overrides: [{ nodeId: id, value: override! }] }) : baseline;
      isolatedResults.set(id, isolated);
      const effect = baseline.rootValue === undefined || isolated.rootValue === undefined ? undefined : isolated.rootValue - baseline.rootValue;
      isolatedEffects.push(effect);
      add(scenario, { row: entry.row, column: 5, formula: `IF(AND(ISNUMBER('_Scenario Calc'!${entry.isolatedRootCell}),ISNUMBER(${summary.baselineCell})),'_Scenario Calc'!${entry.isolatedRootCell}-${summary.baselineCell},NA())`, ...cachedNumber(effect), label: node.name, style: zebra ? 24 : 23 });
    } else {
      text(scenario, entry.row, 5, "—", zebra ? 20 : 21);
    }
  }
  if (Object.keys(mapping.scenario.additionalOverrides).length > 0) {
    text(scenario, Object.values(mapping.scenario.additionalOverrides)[0]!.row - 2, 1, "Additional overrides", 4);
    ["Name", "Unit", "Baseline", "Scenario", "Effect"].forEach((name, i) => text(scenario, Object.values(mapping.scenario.additionalOverrides)[0]!.row - 1, i + 1, name, 1));
  }
  const effectRefs = Object.values(mapping.scenario.drivers).map((entry) => entry.effectCell);
  const effectSum = effectRefs.length ? effectRefs.join("+") : "0";
  const effectGuards = variadicCall("AND", [`ISNUMBER(${summary.absoluteChangeCell})`, ...effectRefs.map((ref) => `ISNUMBER(${ref})`)]);
  const residual = delta === undefined || isolatedEffects.some((value) => value === undefined) ? undefined : delta - isolatedEffects.reduce<number>((sum, value) => sum + value!, 0);
  add(scenario, { row: 8, column: 5, formula: `IF(${effectGuards},${summary.absoluteChangeCell}-(${effectSum}),NA())`, ...cachedNumber(residual), style: 18 });
  const nodes = project.graph.nodes;
  const baselineCycles = formulaCycles(nodes, new Map());
  text(helpers, 1, 1, "KPI / Source lookup key");
  text(helpers, 1, 2, "Selected scenario");
  const cases = [{ column: 2, label: "Selected scenario", calculation: selectedCalculation, overrides: configured, controls: allControls },
    ...Object.entries(mapping.scenario.drivers).map(([id, entry], i) => ({ column: i + 3, label: id, calculation: isolatedResults.get(id)!, overrides: configured.has(id) ? new Map([[id, configured.get(id)!]]) : new Map<string, number>(), controls: { [id]: entry } }))];
  for (const node of nodes) text(helpers, mapping.scenario.calculation.nodeRows[node.id]!, 1, mapping.source[node.id]?.kpiLabel ?? node.name);
  for (const item of cases) {
    text(helpers, 1, item.column, item.label);
    const cycles = formulaCycles(nodes, item.overrides);
    const resolve = (id: string) => mapping.scenario.calculation.nodeRows[id] ? address(item.column, mapping.scenario.calculation.nodeRows[id]!) : "#REF!";
    for (const node of nodes) {
      let formula: string;
      if (node.status === "rejected" || cycles.has(node.id)) formula = "NA()";
      else {
        try { formula = node.formula?.trim() ? resolvedFormula(parseFormula(node.formula), resolve) : numericLink(`'VDT'!${mapping.tree[node.id]!.baselineCell}`); }
        catch { formula = "NA()"; }
        const control = item.controls[node.id];
        if (control) {
          const reference = `'Scenario Mode'!${control.scenarioCell}`;
          formula = `IF(${inheritsBaseline(reference, control.baselineCell)},${baselineCycles.has(node.id) && item.overrides.has(node.id) ? "NA()" : formula},${numericLink(reference)})`;
        }
      }
      add(helpers, { row: mapping.scenario.calculation.nodeRows[node.id]!, column: item.column, formula, ...cachedResult(item.calculation, node.id), label: node.name, style: 0 });
    }
  }
  const heights = (sheet: Map<string, Cell>, widths: number[]) => {
    const result = new Map<number, number>();
    for (const cell of sheet.values()) if (cell.text) {
      const mergedWidth = cell.row === 1 || cell.row === 2 ? widths.reduce((sum, width) => sum + width, 0) : widths[cell.column - 1]!;
      result.set(cell.row, Math.max(result.get(cell.row) ?? 24, textHeight(cell.text, mergedWidth, cell.style === 4 ? 22 : 15)));
    }
    return result;
  };
  const sourceWidths = [44, 26, 48, 64];
  const scenarioWidths = [38, 28, 26, 32, 30];
  const scenarioHeights = heights(scenario, scenarioWidths);
  for (const [row, height] of [[1, 28], [2, 24], [3, 8], [4, 34], [5, 6], [6, 32], [7, 6], [8, 32], [9, 10], [10, 28]] as const) scenarioHeights.set(row, Math.max(height, row === 1 || row === 2 ? scenarioHeights.get(row) ?? 0 : 0));
  for (const entry of Object.values(allControls)) scenarioHeights.set(entry.row, Math.max(28, scenarioHeights.get(entry.row) ?? 0));
  const sourceLastRow = Math.max(6, Object.keys(mapping.source).length + 5);
  return {
    source: sheetXml(source, 4, heights(source, sourceWidths), sourceWidths, false, { table: true, mergeTitle: true, freezeRows: 5 }),
    scenario: sheetXml(scenario, 5, scenarioHeights, scenarioWidths, false, { mergeTitle: true, freezeRows: 10 }),
    helpers: sheetXml(helpers, cases.length + 1, new Map(), [], false),
    table: `${XML_HEADER}<table xmlns="${MAIN_NS}" id="1" name="SourceInputs" displayName="SourceInputs" ref="A5:D${sourceLastRow}" totalsRowShown="0"><autoFilter ref="A5:D${sourceLastRow}"/><tableColumns count="4">${["KPI", "Value", "Source", "Comment"].map((name, i) => `<tableColumn id="${i + 1}" name="${name}"/>`).join("")}</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`
  };
}

/** Editable, self-contained workbook. It contains model fields only, never provider settings or keys. */
export function exportProjectExcel(project: VdtProject, options: ExcelExportOptions = {}): Uint8Array {
  const workbookMapping = getExcelWorkbookCells(project, options);
  const mapping = workbookMapping.tree;
  const selected = selectedScenario(project, options);
  const overrides = new Map(selected ? getActiveScenarioOverrides(project, selected).map((item) => [item.nodeId, item.value]) : []);
  const baseline = calculateGraph(project);
  const potential = selected ? calculateScenarioGraph(project, selected) : baseline;
  const baselineCycles = formulaCycles(project.graph.nodes, new Map());
  const potentialCycles = selected ? formulaCycles(project.graph.nodes, overrides) : baselineCycles;
  const cells = new Map<string, Cell>();
  const rowHeights = new Map<number, number>([[1, 28]]);
  const put = (cell: Cell) => cells.set(address(cell.column, cell.row), cell);
  const columns = Math.max(1, ...Object.values(mapping).map((cell) => cell.column));
  put({ column: 1, row: 1, text: project.name, style: 4 });
  const instructions = `Potential: ${selected?.name ?? "Baseline scenario"}. Edit inputs on Source and scenario values on Scenario Mode. See Guide for calculation details.`;
  put({ column: 1, row: 2, text: instructions, style: 8 });
  const widths = Array.from({ length: columns }, (_, i) => i % 3 === 0 ? 32 : 3);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  rowHeights.set(1, textHeight(project.name, totalWidth * 11 / 16, 22));
  rowHeights.set(2, textHeight(instructions, totalWidth));
  const notes: string[][] = [];
  const numericCell = (node: VdtNode, isPotential: boolean): Pick<Cell, "number" | "formula" | "error"> => {
    const calculation = isPotential ? potential : baseline;
    const cached = cachedResult(calculation, node.id);
    if (isPotential) {
      const selectedReference = `'_Scenario Calc'!B${workbookMapping.scenario.calculation.nodeRows[node.id]}`;
      const control = workbookMapping.scenario.drivers[node.id] ?? workbookMapping.scenario.additionalOverrides[node.id];
      // Incoming cards consume visible Scenario controls; inherited defaults and
      // calculated cards consume the combined graph so upstream edits stay live.
      if (control && !node.formula?.trim() && node.status !== "rejected") {
        const reference = `'Scenario Mode'!${control.scenarioCell}`;
        return { formula: `IF(${inheritsBaseline(reference, control.baselineCell)},${numericLink(selectedReference)},${numericLink(reference)})`, ...cached };
      }
      return { formula: numericLink(selectedReference), ...cached };
    }
    if (node.status === "rejected" || baselineCycles.has(node.id)) return { formula: "NA()", error: "#N/A" };
    if (node.formula?.trim()) {
      try { return { formula: guardedFormula(parseFormula(node.formula), mapping, false), ...cached }; }
      catch { return { formula: "NA()", error: "#N/A" }; }
    }
    return { formula: sourceLookup(workbookMapping.source[node.id]!.keyCell), ...cached };
  };
  for (const node of project.graph.nodes) {
    const coordinates = mapping[node.id]!;
    const title = `${node.name}${node.unit ? `\n[${node.unit}]` : ""}`;
    put({ column: coordinates.column, row: coordinates.headerRow, text: title, label: node.name, style: 1 });
    put({ column: coordinates.column, row: coordinates.headerRow + 1, ...numericCell(node, false), label: node.name, style: 2 });
    put({ column: coordinates.column, row: coordinates.headerRow + 2, ...numericCell(node, true), label: node.name, style: 3 });
    rowHeights.set(coordinates.headerRow, Math.max(rowHeights.get(coordinates.headerRow) ?? 44, textHeight(title, 32)));
    const issues = [...baseline.errors, ...potential.errors].filter((item) => item.nodeId === node.id).map((item) => item.message);
    if (baselineCycles.has(node.id) || potentialCycles.has(node.id)) issues.push("Circular formula dependency: unavailable; repair the model formula before exporting.");
    notes.push([node.id, node.name, coordinates.baselineCell, coordinates.potentialCell, node.formula ?? "", node.fixedInScenario ? "Fixed: own scenario override ignored; edit Source" : overrides.has(node.id) ? "Scenario Mode: editable scenario override" : node.formula?.trim() ? "Calculated: edit upstream inputs" : `Source Value: ${workbookMapping.source[node.id]!.valueCell}; Scenario Mode controls Potential`, [...new Set(issues)].join("\n")]);
  }
  const border = (column: number, row: number, bits: number) => {
    const key = address(column, row);
    const existing = cells.get(key);
    if (existing && existing.style < 5) return; // Never overwrite a KPI/title.
    const previous = existing ? existing.style - 4 : 0;
    put({ column, row, style: 4 + (previous | bits) });
  };
  // Between adjacent depths, top borders meet right borders at the shared cell corner.
  // Long DAG links use an empty row beneath all cards and remain connected to the same card.
  const lastCardRow = Math.max(FIRST_CARD_ROW, ...Object.values(mapping).map((cell) => cell.headerRow + 2));
  let linkRow = lastCardRow + 2;
  const visualNotes: string[] = [];
  for (const edge of project.graph.edges) {
    const parent = mapping[edge.sourceNodeId];
    const child = mapping[edge.targetNodeId];
    if (!parent || !child) {
      visualNotes.push(`Missing endpoint: ${edge.sourceNodeId} -> ${edge.targetNodeId}`);
      continue;
    }
    const from = parent.headerRow + 1;
    const to = child.headerRow + 1;
    if (child.column === parent.column + 3) {
      border(parent.column + 1, from, 1);
      border(parent.column + 2, to, 1);
      for (let row = Math.min(from, to); row < Math.max(from, to); row++) border(parent.column + 1, row, 2);
    } else if (child.column > parent.column) {
      if (linkRow > MAX_ROWS) throw new Error("The VDT exceeds Excel's worksheet row limit.");
      border(parent.column + 1, from, 1);
      for (let row = from; row < linkRow; row++) border(parent.column + 1, row, 2);
      for (let column = parent.column + 2; column < child.column; column++) border(column, linkRow, 1);
      for (let row = to; row < linkRow; row++) border(child.column - 1, row, 2);
      linkRow++;
    } else {
      visualNotes.push(`Visual cycle: ${edge.sourceNodeId} -> ${edge.targetNodeId}; nodes retained at the same level, cycle connector omitted.`);
    }
  }
  const guide = new Map<string, Cell>();
  const guideText = (row: number, column: number, text: string, style = 8) => {
    if (row > MAX_ROWS) throw new Error("The VDT exceeds Excel's worksheet row limit.");
    guide.set(address(column, row), { row, column, text, style });
  };
  guideText(1, 1, "VDT workbook guide", 4);
  guideText(2, 1, "Edit numeric inputs on Source. Its native table supports sorting and filtering; unique KPI labels are lookup keys and must stay unchanged. Source and Comment are editable metadata. Empty values or text make dependent results #N/A. Percentage-unit values keep the application's raw scale.");
  guideText(3, 1, `Potential uses Scenario Mode: ${selected?.name ?? "Baseline scenario"}. Every KPI follows its combined scenario calculation. Fixed nodes ignore their own override but calculated fixed nodes still recalculate from scenario children.`);
  ["Node ID", "KPI", "Base cell", "Potential cell", "VDT formula", "Editing / scenario", "Calculation issues"].forEach((text, i) => guideText(5, i + 1, text, 1));
  notes.forEach((row, i) => row.forEach((text, j) => guideText(i + 6, j + 1, text)));
  let noteRow = notes.length + 7;
  for (const note of visualNotes) guideText(noteRow++, 1, note);
  guideText(noteRow++, 1, "Scenario Mode uses the selected scenario (fallback: first saved scenario). No saved scenario starts an editable Baseline scenario. VDT Potential uses this same Scenario Mode calculation, regardless of which saved scenario is main in the application.");
  guideText(noteRow++, 1, "Scenario rows follow the application's input/data-mapped sensitivity ranking at export time. Fixed KPIs remain on Source but have no driver overrides. Default Scenario formulas reference the adjacent Baseline cell on this sheet (=Crow) and mean no own override. Clearing a cell also removes its own override. Formula-bearing inputs then recalculate from upstream scenario values. Numeric values, including zero or a value equal to Baseline, and any other user formula are own overrides. Exact default-reference recognition uses FORMULATEXT (Excel 2013 or later).");
  guideText(noteRow++, 1, "The hidden _Scenario Calc sheet contains one complete graph column for Total SCENARIO and one graph column per driver's isolated case. Each isolated case changes only that driver. Additional configured calculated/non-driver overrides affect only the combined total.");
  guideText(noteRow++, 1, "Multiplicative effect = total root change minus the sum of the displayed isolated driver effects. Unchanged values contribute zero; an unavailable root/effect remains unavailable. Duplicate imported overrides normalize to the last value once per driver, avoiding the application's duplicate-count residual artifact.");
  guideText(noteRow++, 1, "Numbers display two decimal places with space thousands grouping. Formatting updates with magnitude; stored precision is unchanged. Extremely large magnitudes (at least 1e48) use scientific notation with two decimals.");
  guideText(noteRow++, 1, "Clearing a saved cycle-breaking override makes the cyclic calculation unavailable. Repair the model formulas and re-export to restore that model.");
  const guideWidths = [44, 32, 18, 18, 44, 50, 64];
  const guideHeights = new Map<number, number>([[1, 28]]);
  for (const cell of guide.values()) {
    if (cell.text && cell.row !== 1) {
      guideHeights.set(cell.row, Math.max(guideHeights.get(cell.row) ?? 24, textHeight(cell.text, guideWidths[cell.column - 1]!)));
    }
  }
  const treeXml = sheetXml(cells, columns, rowHeights, widths, true);
  const analysis = analysisSheets(project, workbookMapping, options, baseline);
  const sheetNames = ["VDT", "Guide", "Source", "Scenario Mode", "_Scenario Calc"];
  const visibleOrder = [3, 0, 2, 1, 4];
  const files: Record<string, string> = {
    "[Content_Types].xml": `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetNames.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>`,
    "_rels/.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${visibleOrder.map((i) => `<sheet name="${sheetNames[i]}" sheetId="${i + 1}" r:id="rId${i + 1}"${i === 4 ? ' state="hidden"' : ""}/>`).join("")}</sheets><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId6" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": stylesXml(),
    "xl/worksheets/sheet1.xml": treeXml,
    "xl/worksheets/sheet2.xml": sheetXml(guide, 7, guideHeights, guideWidths, false),
    "xl/worksheets/sheet3.xml": analysis.source,
    "xl/worksheets/sheet4.xml": analysis.scenario,
    "xl/worksheets/sheet5.xml": analysis.helpers,
    "xl/worksheets/_rels/sheet3.xml.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_NS}/table" Target="../tables/table1.xml"/></Relationships>`,
    "xl/tables/table1.xml": analysis.table
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, [strToU8(content), { mtime: new Date(1980, 0, 1), level: 6 }]])));
}
