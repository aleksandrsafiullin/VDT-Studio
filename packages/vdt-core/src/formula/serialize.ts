import type { FormulaToken } from "./ast";

function tokenText(token: FormulaToken): string {
  switch (token.type) {
    case "number":
      return token.raw;
    case "identifier":
      return token.value;
    case "operator":
      return token.value;
    case "left_paren":
      return "(";
    case "right_paren":
      return ")";
    case "eof":
      return "";
  }
}

function isUnaryMinus(tokens: FormulaToken[], index: number): boolean {
  const token = tokens[index];
  if (token?.type !== "operator" || token.value !== "-") {
    return false;
  }

  const previous = tokens[index - 1];
  if (!previous || previous.type === "eof") {
    return true;
  }

  return previous.type === "left_paren" || previous.type === "operator";
}

function shouldInsertSpaceBetween(tokens: FormulaToken[], index: number): boolean {
  const previous = tokens[index - 1];
  const next = tokens[index];

  if (!previous || previous.type === "eof" || !next || next.type === "eof") {
    return false;
  }

  if (next.type === "right_paren") {
    return false;
  }

  if (previous.type === "left_paren") {
    return false;
  }

  if (previous.type === "operator") {
    if (
      isUnaryMinus(tokens, index - 1) &&
      (next.type === "identifier" || next.type === "number" || next.type === "left_paren")
    ) {
      return false;
    }
    return true;
  }

  if (next.type === "operator") {
    if (isUnaryMinus(tokens, index)) {
      return false;
    }
    return true;
  }

  return true;
}

export function serializeFormulaTokens(tokens: FormulaToken[]): string {
  const contentTokens = tokens.filter((token) => token.type !== "eof");
  if (contentTokens.length === 0) {
    return "";
  }

  const parts: string[] = [];

  for (let index = 0; index < contentTokens.length; index += 1) {
    const token = contentTokens[index];
    if (!token) {
      continue;
    }

    if (index > 0 && shouldInsertSpaceBetween(contentTokens, index)) {
      parts.push(" ");
    }

    parts.push(tokenText(token));
  }

  return parts.join("");
}
