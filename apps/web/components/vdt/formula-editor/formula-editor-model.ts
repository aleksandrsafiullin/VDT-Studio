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

export type FormulaEditorToken = {
  id: string;
  token: FormulaToken;
};

export type FormulaEditorSegment =
  | { type: "number"; id: string; value: number; raw: string }
  | { type: "reference"; id: string; nodeId: string; displayName: string }
  | { type: "operator"; id: string; value: "+" | "-" | "*" | "/" }
  | { type: "left_paren"; id: string }
  | { type: "right_paren"; id: string };

export type FormulaEditorOperator = "+" | "-" | "*" | "/" | "(" | ")";

export function createEditorToken(token: FormulaToken, id = makeId("fet")): FormulaEditorToken {
  return { id, token };
}

/** Stable ids for parsed tokens so SSR and client hydration match. */
function stableEditorTokenId(token: FormulaToken, index: number): string {
  switch (token.type) {
    case "identifier":
      return `fet_${index}_ref_${token.value}`;
    case "number":
      return `fet_${index}_num_${token.raw}`;
    case "operator":
      return `fet_${index}_op_${token.value}`;
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
    return tokenizeFormula(formula)
      .filter((token) => token.type !== "eof")
      .map((token, index) => createEditorToken(token, stableEditorTokenId(token, index)));
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
  return tokens.map(({ id, token }) => {
    switch (token.type) {
      case "number":
        return { type: "number", id, value: token.value, raw: token.raw };
      case "identifier":
        return {
          type: "reference",
          id,
          nodeId: token.value,
          displayName: resolveDisplayName(token.value, nodesById)
        };
      case "operator":
        return { type: "operator", id, value: token.value };
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
      for (const token of tokenizeFormula(formula)) {
        if (token.type === "identifier") {
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
