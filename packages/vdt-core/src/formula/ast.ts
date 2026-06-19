export type FormulaExpression =
  | { type: "number"; value: number; raw: string }
  | { type: "reference"; name: string }
  | { type: "unary"; operator: "-"; expression: FormulaExpression }
  | { type: "binary"; operator: "+" | "-" | "*" | "/"; left: FormulaExpression; right: FormulaExpression };

export type FormulaToken =
  | { type: "number"; value: number; raw: string }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "left_paren" }
  | { type: "right_paren" }
  | { type: "eof" };

export class FormulaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaParseError";
  }
}

export class FormulaEvaluationError extends Error {
  constructor(
    readonly code: "unknown_reference" | "missing_value" | "division_by_zero",
    message: string,
    readonly reference?: string
  ) {
    super(message);
    this.name = "FormulaEvaluationError";
  }
}
