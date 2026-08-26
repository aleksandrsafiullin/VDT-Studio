import {
  extractFormulaReferences,
  FormulaParseError,
  parseFormula,
  serializeFormulaTokens,
  tokenizeFormula,
  type FormulaToken,
  type VdtEdge,
  type VdtNode
} from "@vdt-studio/vdt-core";
import { makeId } from "@/lib/id";

const FORMULA_FUNCTION_NAMES = new Set(["min", "max"]);

export type FormulaEditorFunctionName = "min" | "max";

export type FormulaEditorToken = {
  id: string;
  token: FormulaToken;
};

export type FormulaEditorSegment =
  | { type: "number"; id: string; value: number; raw: string }
  | { type: "reference"; id: string; nodeId: string; displayName: string }
  | { type: "function"; id: string; name: FormulaEditorFunctionName }
  | { type: "operator"; id: string; value: "+" | "-" | "*" | "/" }
  | { type: "comma"; id: string }
  | { type: "left_paren"; id: string }
  | { type: "right_paren"; id: string };

export type FormulaEditorOperator = "+" | "-" | "*" | "/" | "(" | ")";

function isFunctionIdentifier(
  token: FormulaToken,
  nextToken: FormulaToken | undefined
): token is Extract<FormulaToken, { type: "identifier" }> & { value: FormulaEditorFunctionName } {
  return (
    token.type === "identifier" &&
    FORMULA_FUNCTION_NAMES.has(token.value) &&
    nextToken?.type === "left_paren"
  );
}

export function createEditorToken(token: FormulaToken, id = makeId("fet")): FormulaEditorToken {
  return { id, token };
}

/** Stable ids for parsed tokens so SSR and client hydration match. */
function stableEditorTokenId(token: FormulaToken, index: number, tokens: FormulaToken[]): string {
  switch (token.type) {
    case "identifier":
      if (isFunctionIdentifier(token, tokens[index + 1])) {
        return `fet_${index}_fn_${token.value}`;
      }
      return `fet_${index}_ref_${token.value}`;
    case "number":
      return `fet_${index}_num_${token.raw}`;
    case "operator":
      return `fet_${index}_op_${token.value}`;
    case "comma":
      return `fet_${index}_comma`;
    case "left_paren":
      return `fet_${index}_lp`;
    case "right_paren":
      return `fet_${index}_rp`;
    default:
      return `fet_${index}_tok`;
  }
}

export function parseFormulaToEditorTokens(formula: string): FormulaEditorToken[] {
  try {
    const tokens = tokenizeFormula(formula).filter((token) => token.type !== "eof");
    return tokens.map((token, index) =>
      createEditorToken(token, stableEditorTokenId(token, index, tokens))
    );
  } catch {
    return [];
  }
}

export function editorTokensToFormula(tokens: FormulaEditorToken[]): string {
  return serializeFormulaTokens(tokens.map(({ token }) => token));
}

export function editorTokensToSegments(
  tokens: FormulaEditorToken[],
  nodesById: Map<string, VdtNode>
): FormulaEditorSegment[] {
  return tokens.map(({ id, token }, index) => {
    const nextToken = tokens[index + 1]?.token;
    switch (token.type) {
      case "number":
        return { type: "number", id, value: token.value, raw: token.raw };
      case "identifier":
        if (isFunctionIdentifier(token, nextToken)) {
          return { type: "function", id, name: token.value };
        }
        return {
          type: "reference",
          id,
          nodeId: token.value,
          displayName: resolveDisplayName(token.value, nodesById)
        };
      case "operator":
        return { type: "operator", id, value: token.value };
      case "comma":
        return { type: "comma", id };
      case "left_paren":
        return { type: "left_paren", id };
      case "right_paren":
        return { type: "right_paren", id };
      default:
        return { type: "right_paren", id };
    }
  });
}

export function getReferencedNodeIds(formula: string): Set<string> {
  try {
    return new Set(extractFormulaReferences(formula));
  } catch {
    try {
      const referenced = new Set<string>();
      const tokens = tokenizeFormula(formula).filter((token) => token.type !== "eof");
      for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (!token) {
          continue;
        }
        if (token.type === "identifier" && !isFunctionIdentifier(token, tokens[index + 1])) {
          referenced.add(token.value);
        }
      }
      return referenced;
    } catch {
      return new Set();
    }
  }
}

/** Target node ids of edges where the current node is the source (canvas drivers). */
export function getConnectedNodeIds(currentNodeId: string, edges: VdtEdge[]): Set<string> {
  const connected = new Set<string>();
  for (const edge of edges) {
    if (edge.sourceNodeId === currentNodeId) {
      connected.add(edge.targetNodeId);
    }
  }
  return connected;
}

export function getPaletteNodes(
  nodes: VdtNode[],
  currentNodeId: string,
  formula: string,
  edges: VdtEdge[] = []
): VdtNode[] {
  const referenced = getReferencedNodeIds(formula);
  const connected = getConnectedNodeIds(currentNodeId, edges);
  return nodes
    .filter(
      (node) =>
        node.id !== currentNodeId &&
        connected.has(node.id) &&
        !referenced.has(node.id)
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function validateFormulaString(formula: string): { ok: true } | { ok: false; message: string } {
  try {
    parseFormula(formula);
    return { ok: true };
  } catch (error) {
    if (error instanceof FormulaParseError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

export function resolveDisplayName(nodeId: string, nodesById: Map<string, VdtNode>): string {
  return nodesById.get(nodeId)?.name ?? nodeId;
}

export function operatorToToken(op: FormulaEditorOperator): FormulaToken {
  switch (op) {
    case "(":
      return { type: "left_paren" };
    case ")":
      return { type: "right_paren" };
    default:
      return { type: "operator", value: op };
  }
}

export function createNumberToken(raw = "0"): FormulaEditorToken {
  try {
    const tokens = tokenizeFormula(raw).filter((token) => token.type !== "eof");
    const first = tokens[0];
    if (first?.type === "number") {
      return createEditorToken(first);
    }
  } catch {
    // fall through to default
  }

  return createEditorToken({ type: "number", value: 0, raw: "0" });
}

export function updateEditorNumberToken(token: FormulaEditorToken, raw: string): FormulaEditorToken {
  if (token.token.type !== "number") {
    return token;
  }

  const trimmed = raw.trim();
  let value = Number(trimmed.endsWith("%") ? trimmed.slice(0, -1) : trimmed);
  if (trimmed.endsWith("%")) {
    value /= 100;
  }

  return {
    ...token,
    token: {
      type: "number",
      value: Number.isFinite(value) ? value : token.token.value,
      raw: trimmed
    }
  };
}

export function createReferenceToken(nodeId: string): FormulaEditorToken {
  return createEditorToken({ type: "identifier", value: nodeId });
}

export function createFunctionCallSkeleton(name: FormulaEditorFunctionName): FormulaEditorToken[] {
  return [
    createEditorToken({ type: "identifier", value: name }),
    createEditorToken({ type: "left_paren" }),
    createEditorToken({ type: "right_paren" })
  ];
}

export function createCommaToken(): FormulaEditorToken {
  return createEditorToken({ type: "comma" });
}

/** Default insert index for palette drops, commas, numbers, and refs without an explicit index. */
function findTrailingMinMaxCallRange(
  tokens: FormulaEditorToken[]
): { callStart: number; appendIndex: number } | null {
  if (tokens.length === 0) {
    return null;
  }

  const lastToken = tokens[tokens.length - 1]?.token;
  if (lastToken?.type !== "right_paren") {
    return null;
  }

  let depth = 1;
  let leftParenIndex = -1;
  for (let index = tokens.length - 2; index >= 0; index -= 1) {
    const token = tokens[index]?.token;
    if (!token) {
      continue;
    }
    if (token.type === "right_paren") {
      depth += 1;
    } else if (token.type === "left_paren") {
      depth -= 1;
      if (depth === 0) {
        leftParenIndex = index;
        break;
      }
    }
  }

  if (leftParenIndex <= 0) {
    return null;
  }

  const beforeLeftParen = tokens[leftParenIndex - 1]?.token;
  if (
    beforeLeftParen?.type !== "identifier" ||
    !FORMULA_FUNCTION_NAMES.has(beforeLeftParen.value)
  ) {
    return null;
  }

  return {
    callStart: leftParenIndex - 1,
    appendIndex: tokens.length - 1
  };
}

export function defaultAppendIndex(tokens: FormulaEditorToken[]): number {
  return findTrailingMinMaxCallRange(tokens)?.appendIndex ?? tokens.length;
}

export function resolveReferenceInsertIndex(tokens: FormulaEditorToken[], atIndex?: number): number {
  const range = findTrailingMinMaxCallRange(tokens);
  const appendIndex = range?.appendIndex ?? tokens.length;

  if (atIndex === undefined) {
    return appendIndex;
  }

  if (range && atIndex >= range.callStart && atIndex <= range.appendIndex) {
    return range.appendIndex;
  }

  return atIndex;
}

export function insertEditorTokenAt(
  tokens: FormulaEditorToken[],
  token: FormulaEditorToken,
  atIndex?: number
): FormulaEditorToken[] {
  const index = atIndex ?? tokens.length;
  const next = [...tokens];
  next.splice(index, 0, token);
  return next;
}

export function insertEditorTokensAt(
  tokens: FormulaEditorToken[],
  newTokens: FormulaEditorToken[],
  atIndex?: number
): FormulaEditorToken[] {
  const index = atIndex ?? tokens.length;
  const next = [...tokens];
  next.splice(index, 0, ...newTokens);
  return next;
}

export function removeEditorTokenById(tokens: FormulaEditorToken[], tokenId: string): FormulaEditorToken[] {
  return tokens.filter((entry) => entry.id !== tokenId);
}

export function reorderEditorTokens(tokens: FormulaEditorToken[], fromIndex: number, toIndex: number): FormulaEditorToken[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= tokens.length) {
    return tokens;
  }

  const next = [...tokens];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) {
    return tokens;
  }

  next.splice(toIndex, 0, moved);
  return next;
}
