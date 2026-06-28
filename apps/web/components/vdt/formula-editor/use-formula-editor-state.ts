"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VdtEdge, VdtNode } from "@vdt-studio/vdt-core";
import {
  createEditorToken,
  createNumberToken,
  createReferenceToken,
  editorTokensToFormula,
  getConnectedNodeIds,
  getPaletteNodes,
  getReferencedNodeIds,
  insertEditorTokenAt,
  operatorToToken,
  parseFormulaToEditorTokens,
  removeEditorTokenById,
  reorderEditorTokens,
  updateEditorNumberToken,
  validateFormulaString,
  type FormulaEditorOperator,
  type FormulaEditorToken
} from "./formula-editor-model";

export interface UseFormulaEditorStateResult {
  editorTokens: FormulaEditorToken[];
  paletteNodes: VdtNode[];
  paletteEmptyMessage: string;
  validation: ReturnType<typeof validateFormulaString>;
  formulaString: string;
  reorder: (fromIndex: number, toIndex: number) => void;
  insertReference: (nodeId: string, atIndex?: number) => void;
  insertOperator: (op: FormulaEditorOperator) => void;
  insertNumber: (raw?: string) => void;
  updateNumber: (tokenId: string, raw: string) => void;
  removeToken: (tokenId: string) => void;
  setFromFormulaString: (raw: string) => void;
}

export function useFormulaEditorState(
  formula: string,
  nodes: VdtNode[],
  edges: VdtEdge[],
  currentNodeId: string,
  onFormulaChange: (formula: string) => void
): UseFormulaEditorStateResult {
  const [editorTokens, setEditorTokens] = useState<FormulaEditorToken[]>(() => parseFormulaToEditorTokens(formula));
  const editorTokensRef = useRef(editorTokens);
  editorTokensRef.current = editorTokens;
  const lastEmittedFormulaRef = useRef(formula);

  const applyTokenUpdate = useCallback(
    (updater: (tokens: FormulaEditorToken[]) => FormulaEditorToken[]) => {
      const next = updater(editorTokensRef.current);
      const nextFormula = editorTokensToFormula(next);
      editorTokensRef.current = next;
      lastEmittedFormulaRef.current = nextFormula;
      setEditorTokens(next);
      onFormulaChange(nextFormula);
    },
    [onFormulaChange]
  );

  useEffect(() => {
    if (formula === lastEmittedFormulaRef.current) {
      return;
    }

    setEditorTokens((previous) => {
      const currentFormula = editorTokensToFormula(previous);
      if (currentFormula === formula) {
        lastEmittedFormulaRef.current = formula;
        return previous;
      }

      const next = parseFormulaToEditorTokens(formula);
      if (next.length === 0 && formula.trim() !== "") {
        return previous;
      }

      editorTokensRef.current = next;
      lastEmittedFormulaRef.current = formula;
      return next;
    });
  }, [formula]);

  const formulaString = useMemo(() => editorTokensToFormula(editorTokens), [editorTokens]);
  const validation = useMemo(() => validateFormulaString(formulaString), [formulaString]);
  const paletteNodes = useMemo(
    () => getPaletteNodes(nodes, currentNodeId, formulaString, edges),
    [nodes, currentNodeId, formulaString, edges]
  );
  const paletteEmptyMessage = useMemo(() => {
    if (getConnectedNodeIds(currentNodeId, edges).size === 0) {
      return "Connect drivers on the canvas to add them here.";
    }
    return "All connected drivers are already in the formula.";
  }, [currentNodeId, edges]);

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      applyTokenUpdate((tokens) => reorderEditorTokens(tokens, fromIndex, toIndex));
    },
    [applyTokenUpdate]
  );

  const insertReference = useCallback(
    (nodeId: string, atIndex?: number) => {
      if (getReferencedNodeIds(formulaString).has(nodeId)) {
        return;
      }
      if (!getConnectedNodeIds(currentNodeId, edges).has(nodeId)) {
        return;
      }
      applyTokenUpdate((tokens) => insertEditorTokenAt(tokens, createReferenceToken(nodeId), atIndex));
    },
    [applyTokenUpdate, currentNodeId, edges, formulaString]
  );

  const insertOperator = useCallback(
    (op: FormulaEditorOperator) => {
      applyTokenUpdate((tokens) => insertEditorTokenAt(tokens, createEditorToken(operatorToToken(op))));
    },
    [applyTokenUpdate]
  );

  const insertNumber = useCallback(
    (raw?: string) => {
      applyTokenUpdate((tokens) => insertEditorTokenAt(tokens, createNumberToken(raw)));
    },
    [applyTokenUpdate]
  );

  const updateNumber = useCallback(
    (tokenId: string, raw: string) => {
      applyTokenUpdate((tokens) =>
        tokens.map((entry) => (entry.id === tokenId ? updateEditorNumberToken(entry, raw) : entry))
      );
    },
    [applyTokenUpdate]
  );

  const removeToken = useCallback(
    (tokenId: string) => {
      applyTokenUpdate((tokens) => removeEditorTokenById(tokens, tokenId));
    },
    [applyTokenUpdate]
  );

  const setFromFormulaString = useCallback(
    (raw: string) => {
      const nextTokens = parseFormulaToEditorTokens(raw);
      const nextFormula = editorTokensToFormula(nextTokens);
      editorTokensRef.current = nextTokens;
      lastEmittedFormulaRef.current = nextFormula;
      setEditorTokens(nextTokens);
      onFormulaChange(nextFormula);
    },
    [onFormulaChange]
  );

  return {
    editorTokens,
    paletteNodes,
    paletteEmptyMessage,
    validation,
    formulaString,
    reorder,
    insertReference,
    insertOperator,
    insertNumber,
    updateNumber,
    removeToken,
    setFromFormulaString
  };
}
