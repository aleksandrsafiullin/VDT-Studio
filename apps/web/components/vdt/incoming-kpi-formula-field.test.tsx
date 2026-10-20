import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IncomingKpiFormulaField, incomingKpiReadableFormula, insertIncomingKpiFormulaReference } from "./incoming-kpi-formula-field";

describe("incoming formula reference insertion", () => {
  it("replaces the selected factor without rewriting the surrounding incomplete expression", () => {
    const raw = "(p_1 / p_2 + @";
    const start = raw.indexOf("p_2");
    const result = insertIncomingKpiFormulaReference(raw, "m_1234", start, start + 3);
    expect(result?.rawValue).toBe("(p_1 / m_1234 + @");
    expect(result?.rawValue.slice(result.caret)).toBe(" + @");
  });

  it("never invents an operator when inserting beside another factor", () => {
    expect(insertIncomingKpiFormulaReference("p_1", "m_1234")).toEqual({
      rawValue: "p_1 m_1234", caret: 10
    });
    expect(insertIncomingKpiFormulaReference("p_1+p_2", "e_1234", 3, 4)?.rawValue)
      .toBe("p_1 e_1234 p_2");
  });

  it("clamps stale selections and refuses oversized or nonreference insertion without truncating a draft", () => {
    expect(insertIncomingKpiFormulaReference("(@", "p_1", -20, 200)).toEqual({ rawValue: "p_1", caret: 3 });
    expect(insertIncomingKpiFormulaReference("p_1 + ", "p_2", Number.NaN)?.rawValue).toBe("p_1 + p_2");
    expect(insertIncomingKpiFormulaReference("x".repeat(1020), "p_1")?.rawValue).toHaveLength(1024);
    expect(insertIncomingKpiFormulaReference("x".repeat(1021), "p_1")).toBeUndefined();
    expect(insertIncomingKpiFormulaReference("p_1 + (", "p_2 * 10")).toBeUndefined();
  });
});

describe("incoming formula field", () => {
  it("presents the whole formula with readable KPI names, including an unchecked reference", () => {
    const ownAlias = `m_${"a".repeat(32)}`, rawValue = `(p_1 / ${ownAlias}) + (@`;
    const references = [{ alias: "p_1", name: "Moving distance", unit: "km/trip" },
      { alias: ownAlias, name: "Moving time", unit: "h/trip", selected: false }];
    const parts = incomingKpiReadableFormula(rawValue, references);
    expect(parts.map(part => part.kind === "reference" ? part.reference.name : part.text).join(""))
      .toBe("(Moving distance / Moving time) + (@");
    expect(parts.filter(part => part.kind === "reference")).toHaveLength(2);
    const html = renderToStaticMarkup(<IncomingKpiFormulaField rawValue={rawValue} references={references} onChange={() => {}} />);
    const preview = html.slice(html.indexOf('data-testid="incoming-kpi-readable-formula"'), html.indexOf("<details"));
    expect(preview).toContain("Moving distance"); expect(preview).toContain("Moving time");
    expect(preview).toContain("border-orange-300");
    expect(html).toContain("Edit as text");
  });
  it("retains raw partial text, shows readable escaped references and one linked error", () => {
    const html = renderToStaticMarkup(<IncomingKpiFormulaField rawValue={'p_1 + (@ <script>'} onChange={() => {}}
      references={[{ alias: "p_1", name: "Moving distance", unit: "km/trip" }, { alias: "m_abcd", name: "<Moving time>", unit: "h/trip" }]}
      error="Include Moving time in the formula." />);
    expect(html).toContain("p_1 + (@ &lt;script&gt;");
    expect(html).toContain("Moving distance");
    expect(html).toContain("&lt;Moving time&gt;");
    expect(html).toContain('aria-invalid="true"');
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).toContain("aria-describedby=");
    expect(html).not.toContain("<script>");
    expect(html).toContain('maxLength="1024"');
  });

  it("uses unique labels for simultaneous editors and native disabled reference buttons", () => {
    const html = renderToStaticMarkup(<>
      <IncomingKpiFormulaField rawValue="p_1" onChange={() => {}} references={[]} />
      <IncomingKpiFormulaField rawValue="p_1" onChange={() => {}} disabled
        references={[{ alias: "p_1", name: "Distance", unit: "km" }]} />
    </>);
    const labels = [...html.matchAll(/<label for="([^"]+)"/g)].map(match => match[1]);
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*disabled=""[^>]*aria-label="Insert Distance \(km\)"/);
  });
});
