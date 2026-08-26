import { FormulaParseError, type FormulaExpression, type FormulaToken } from "./ast";

function isDigit(char: string) {
  return /[0-9]/.test(char);
}

function isIdentifierStart(char: string) {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string) {
  return /[A-Za-z0-9_]/.test(char);
}

export function tokenizeFormula(formula: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  const functionParentheses: boolean[] = [];
  let index = 0;

  while (index < formula.length) {
    const char = formula[index];

    if (!char) {
      break;
    }

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (isDigit(char) || char === ".") {
      const start = index;
      let hasDot = char === ".";
      index += 1;

      while (index < formula.length) {
        const next = formula[index];
        if (!next) {
          break;
        }

        if (next === ".") {
          if (hasDot) {
            throw new FormulaParseError(`Invalid number literal near "${formula.slice(start, index + 1)}".`);
          }
          hasDot = true;
          index += 1;
          continue;
        }

        if (next === "," && !functionParentheses.includes(true)) {
          const comma = scanCommaNumericSegment(formula, start, index, hasDot);
          if (comma) {
            index = comma.end;
            continue;
          }
        }

        if (!isDigit(next)) {
          break;
        }

        index += 1;
      }

      const numericRaw = formula.slice(start, index);
      if (numericRaw === ".") {
        throw new FormulaParseError("A number cannot be only a decimal point.");
      }

      let raw = numericRaw;
      let value = Number(normalizeNumericLiteral(numericRaw));

      if (formula[index] === "%") {
        raw = `${numericRaw}%`;
        value /= 100;
        index += 1;
      }

      if (!Number.isFinite(value)) {
        throw new FormulaParseError(`Invalid number literal: ${raw}`);
      }

      tokens.push({ type: "number", value, raw });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (index < formula.length && isIdentifierPart(formula[index] ?? "")) {
        index += 1;
      }
      tokens.push({ type: "identifier", value: formula.slice(start, index) });
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "left_paren" });
      functionParentheses.push(tokens.at(-2)?.type === "identifier");
      index += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "right_paren" });
      functionParentheses.pop();
      index += 1;
      continue;
    }

    if (char === ",") {
      tokens.push({ type: "comma" });
      index += 1;
      continue;
    }

    throw new FormulaParseError(`Unsupported token "${char}" in formula.`);
  }

  tokens.push({ type: "eof" });
  return tokens;
}

interface CommaNumericSegment {
  end: number;
}

/**
 * A comma is part of a numeric literal only outside a function call. Inside
 * min/max it remains an argument separator, so min(1,2) cannot silently turn
 * into min(1.2). The accepted numeric forms are a decimal comma (1,85) or
 * conventional three-digit grouping (1,000 and 1,000,000).
 */
function scanCommaNumericSegment(
  formula: string,
  start: number,
  commaIndex: number,
  hasDot: boolean
): CommaNumericSegment | undefined {
  if (hasDot || !isDigit(formula[commaIndex - 1] ?? "") || !isDigit(formula[commaIndex + 1] ?? "")) {
    return undefined;
  }

  let end = commaIndex + 1;
  while (isDigit(formula[end] ?? "")) end += 1;
  const firstGroupLength = end - (commaIndex + 1);
  const next = formula[end];

  if (next === ",") {
    if (firstGroupLength !== 3) return undefined;
    let cursor = end;
    while (formula[cursor] === ",") {
      const groupStart = cursor + 1;
      cursor = groupStart;
      while (isDigit(formula[cursor] ?? "")) cursor += 1;
      if (cursor - groupStart !== 3) return undefined;
    }
    return { end: cursor };
  }

  const integerLength = commaIndex - start;
  if (integerLength < 1 || firstGroupLength < 1) return undefined;
  return { end };
}

function normalizeNumericLiteral(raw: string): string {
  if (!raw.includes(",")) return raw;
  const groups = raw.split(",");
  if (groups.length > 2 && groups.slice(1).every((group) => group.length === 3)) {
    return groups.join("");
  }
  if (groups.length === 2 && groups[1]?.length === 3) {
    return groups.join("");
  }
  return raw.replace(",", ".");
}

class FormulaParser {
  private cursor = 0;

  constructor(private readonly tokens: FormulaToken[]) {}

  parse() {
    const expression = this.parseAdditive();
    if (this.peek().type !== "eof") {
      throw new FormulaParseError("Unexpected token after formula expression.");
    }
    return expression;
  }

  private parseAdditive(): FormulaExpression {
    let expression = this.parseMultiplicative();

    while (true) {
      const next = this.peek();
      if (next.type !== "operator" || (next.value !== "+" && next.value !== "-")) {
        break;
      }
      const operator = this.advance() as Extract<FormulaToken, { type: "operator" }>;
      expression = {
        type: "binary",
        operator: operator.value,
        left: expression,
        right: this.parseMultiplicative()
      };
    }

    return expression;
  }

  private parseMultiplicative(): FormulaExpression {
    let expression = this.parseUnary();

    while (true) {
      const next = this.peek();
      if (next.type !== "operator" || (next.value !== "*" && next.value !== "/")) {
        break;
      }
      const operator = this.advance() as Extract<FormulaToken, { type: "operator" }>;
      expression = {
        type: "binary",
        operator: operator.value,
        left: expression,
        right: this.parseUnary()
      };
    }

    return expression;
  }

  private parseUnary(): FormulaExpression {
    const next = this.peek();
    if (next.type === "operator" && next.value === "-") {
      this.advance();
      return {
        type: "unary",
        operator: "-",
        expression: this.parseUnary()
      };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): FormulaExpression {
    const token = this.advance();

    if (token.type === "number") {
      return { type: "number", value: token.value, raw: token.raw };
    }

    if (token.type === "identifier") {
      const next = this.peek();
      if (next.type === "left_paren") {
        if (token.value === "min" || token.value === "max") {
          return this.parseCall(token.value);
        }
        throw new FormulaParseError(`Unknown function "${token.value}".`);
      }
      return { type: "reference", name: token.value };
    }

    if (token.type === "left_paren") {
      const expression = this.parseAdditive();
      if (this.peek().type !== "right_paren") {
        throw new FormulaParseError("Missing closing parenthesis.");
      }
      this.advance();
      return expression;
    }

    throw new FormulaParseError("Expected a number, reference, or parenthesized expression.");
  }

  private parseCall(name: "min" | "max"): FormulaExpression {
    const open = this.advance();
    if (open.type !== "left_paren") {
      throw new FormulaParseError("Expected '(' after function name.");
    }

    if (this.peek().type === "right_paren") {
      throw new FormulaParseError(`Function "${name}" requires at least one argument.`);
    }

    const args: FormulaExpression[] = [this.parseAdditive()];

    while (this.peek().type === "comma") {
      this.advance();
      if (this.peek().type === "right_paren") {
        throw new FormulaParseError("Trailing comma in function call.");
      }
      args.push(this.parseAdditive());
    }

    if (this.peek().type !== "right_paren") {
      throw new FormulaParseError("Missing closing parenthesis in function call.");
    }
    this.advance();

    return { type: "call", name, args };
  }

  private peek() {
    return this.tokens[this.cursor] ?? { type: "eof" as const };
  }

  private advance() {
    const token = this.peek();
    this.cursor += 1;
    return token;
  }
}

export function parseFormula(formula: string): FormulaExpression {
  if (!formula.trim()) {
    throw new FormulaParseError("Formula cannot be empty.");
  }

  return new FormulaParser(tokenizeFormula(formula)).parse();
}
