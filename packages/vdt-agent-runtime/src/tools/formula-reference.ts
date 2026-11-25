import { parseFormula, serializeFormulaTokens, tokenizeFormula } from "@vdt-studio/vdt-core";
import { AgentToolError } from "../tool-registry";

/** A function name can also be a KPI ID when it appears without parentheses. */
export function replaceFormulaReference(formula: string, from: string, to: string): string {
  const [replacement, end] = tokenizeFormula(to);
  if (end?.type !== "eof" || (replacement?.type !== "identifier" && replacement?.type !== "number")) {
    throw new AgentToolError("INVALID_FORMULA_REFERENCE_REPLACEMENT", "A reference replacement must be one identifier or numeric literal.");
  }
  const tokens = tokenizeFormula(formula);
  let changed = false;
  const updated = tokens.map((token, index) => {
    if (token.type !== "identifier" || token.value !== from || tokens[index + 1]?.type === "left_paren") return token;
    changed = true;
    return replacement;
  });
  if (!changed || from === to) return formula;
  const result = serializeFormulaTokens(updated);
  parseFormula(result);
  return result;
}
