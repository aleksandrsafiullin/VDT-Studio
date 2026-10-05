import { describe, expect, it } from "vitest";
import { getExcelDownloadFilename } from "./download";

describe("Excel download filename", () => {
  it.each([
    ["Ore haulage Driver Model", "Ore haulage Driver Model.xlsx"],
    ["Ore  haulage – 2026", "Ore  haulage – 2026.xlsx"],
    ["Перевозка руды — Модель драйверов", "Перевозка руды — Модель драйверов.xlsx"],
    ["  Leading spaces", "  Leading spaces.xlsx"],
    ["_", "_.xlsx"]
  ])("preserves the display name %s", (name, expected) => {
    expect(getExcelDownloadFilename(name)).toBe(expected);
  });

  it.each([
    ["Mine/Plant\\Output: <draft>?*|\"", "Mine_Plant_Output_ _draft_____.xlsx"],
    ["Output\n2026\u0000", "Output_2026_.xlsx"],
    ["Model...  ", "Model.xlsx"],
    ["CON", "_CON.xlsx"],
    ["nul.report", "_nul.report.xlsx"],
    ["LPT1", "_LPT1.xlsx"],
    ["COM¹", "_COM¹.xlsx"],
    ["", "VDT.xlsx"],
    [" .. ", "VDT.xlsx"],
    ["/**?", "VDT.xlsx"]
  ])("makes unsafe filename %s usable", (name, expected) => {
    expect(getExcelDownloadFilename(name)).toBe(expected);
  });
});
