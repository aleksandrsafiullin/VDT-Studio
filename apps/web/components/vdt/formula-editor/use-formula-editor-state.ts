"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VdtEdge, VdtNode } from "@vdt-studio/vdt-core";
import {
  caretAfterInsert,
  caretAfterRemove,
  caretAfterReorder,
  clampCaretIndex,
  createCommaToken,
  createEditorToken,
  createFunctionCallSkeleton,
  createNumberToken,
  createReferenceToken,
  defaultAppendIndex,
  editorTokensToFormula,
  getConnectedNodeIds,
  getPaletteNodes,
  getReferencedNodeIds,
  insertEditorTokenAt,
  insertEditorTokensAt,
  operatorToToken,
  parseFormulaToEditorTokens,
  removeEditorTokenById,
  reorderEditorTokens,
  resolveInsertIndexAtCaret,
  resolveReferenceInsertIndex,
  updateEditorNumberToken,
  validateFormulaString,
  type FormulaEditorOperator,
  type FormulaEditorFunctionName,
  type FormulaEditorToken
} from "./formula-editor-model";

export interface UseFormulaEditorStateResult {
  editorTokens: FormulaEditorToken[];
  caretIndex: number;
  setCaretIndex: (index: number) => void;
  paletteNodes: VdtNode[];
  paletteEmptyMessage: string;
  validation: ReturnType<typeof validateFormulaString>;
  formulaString: string;
  reorder: (fromIndex: number, toIndex: number) => void;
  insertReference: (nodeId: string, atIndex?: number) => void;
  insertOperator: (op: FormulaEditorOperator) => void;
  insertFunction: (name: FormulaEditorFunctionName) => void;
  insertComma: () => void;
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
  const initialTokens = parseFormulaToEditorTokens(formula);
  const [editorTokens, setEditorTokens] = useState<FormulaEditorToken[]>(initialTokens);
  const [caretIndex, setCaretIndexState] = useState(() => defaultAppendIndex(initialTokens));
  const editorTokensRef = useRef(editorTokens);
  editorTokensRef.current = editorTokens;
  const caretIndexRef = useRef(caretIndex);
  caretIndexRef.current = caretIndex;
  const lastEmittedFormulaRef = useRef(formula);

  const applyUpdate = useCallback(
    (
      updater: (
        tokens: FormulaEditorToken[],
        caret: number
      ) => { tokens: FormulaEditorToken[]; caretIndex: number }
    ) => {
      const { tokens: next, caretIndex: nextCaret } = updater(
        editorTokensRef.current,
        caretIndexRef.current
      );
      const nextFormula = editorTokensToFormula(next);
      editorTokensRef.current = next;
      caretIndexRef.current = nextCaret;
      lastEmittedFormulaRef.current = nextFormula;
      setEditorTokens(next);
      setCaretIndexState(nextCaret);
      onFormulaChange(nextFormula);
    },
    [onFormulaChange]
  );

  useEffect(() => {
    if (formula === lastEmittedFormulaRef.current) {
      return;
    }

    const previous = editorTokensRef.current;
    const currentFormula = editorTokensToFormula(previous);
    if (currentFormula === formula) {
      lastEmittedFormulaRef.current = formula;
      return;
    }

    const next = parseFormulaToEditorTokens(formula);
    if (next.length === 0 && formula.trim() !== "") {
      return;
    }

    const nextCaret = defaultAppendIndex(next);
    editorTokensRef.current = next;
    caretIndexRef.current = nextCaret;
    lastEmittedFormulaRef.current = formula;
    setEditorTokens(next);
    setCaretIndexState(nextCaret);
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

  const setCaretIndex = useCallback((index: number) => {
    const clamped = clampCaretIndex(index, editorTokensRef.current.length);
    caretIndexRef.current = clamped;
    setCaretIndexState(clamped);
  }, []);

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      applyUpdate((tokens, caret) => {
        const next = reorderEditorTokens(tokens, fromIndex, toIndex);
        if (next === tokens) {
          return { tokens, caretIndex: caret };
        }
        return {
          tokens: next,
          caretIndex: caretAfterReorder(caret, fromIndex, toIndex)
        };
      });
    },
    [applyUpdate]
  );

  const insertReference = useCallback(
    (nodeId: string, atIndex?: number) => {
      if (getReferencedNodeIds(formulaString).has(nodeId)) {
        return;
      }
      if (!getConnectedNodeIds(currentNodeId, edges).has(nodeId)) {
        return;
      }
      applyUpdate((tokens, caret) => {
        const insertIndex =
          atIndex === undefined
            ? resolveReferenceInsertIndex(tokens)
            : clampCaretIndex(atIndex, tokens.length);
        const next = insertEditorTokenAt(tokens, createReferenceToken(nodeId), insertIndex);
        return {
          tokens: next,
          caretIndex: caretAfterInsert(insertIndex, 1)
        };
      });
    },
    [applyUpdate, currentNodeId, edges, formulaString]
  );

  const insertOperator = useCallback(
    (op: FormulaEditorOperator) => {
      applyUpdate((tokens, caret) => {
        const insertIndex = resolveInsertIndexAtCaret(tokens, caret, "operator");
        const next = insertEditorTokenAt(tokens, createEditorToken(operatorToToken(op)), insertIndex);
        return {
          tokens: next,
          caretIndex: caretAfterInsert(insertIndex, 1)
        };
      });
    },
    [applyUpdate]
  );

  const insertFunction = useCallback(
    (name: FormulaEditorFunctionName) => {
      applyUpdate((tokens, caret) => {
        const skeleton = createFunctionCallSkeleton(name);
        const insertIndex = resolveInsertIndexAtCaret(tokens, caret, "function");
        const next = insertEditorTokensAt(tokens, skeleton, insertIndex);
        return {
          tokens: next,
          caretIndex: defaultAppendIndex(next)
        };
      });
    },
    [applyUpdate]
  );

  const insertComma = useCallback(() => {
    applyUpdate((tokens, caret) => {
      const insertIndex = resolveInsertIndexAtCaret(tokens, caret, "comma");
      const next = insertEditorTokenAt(tokens, createCommaToken(), insertIndex);
      return {
        tokens: next,
        caretIndex: caretAfterInsert(insertIndex, 1)
      };
    });
  }, [applyUpdate]);

  const insertNumber = useCallback(
    (raw?: string) => {
      applyUpdate((tokens, caret) => {
        const insertIndex = resolveInsertIndexAtCaret(tokens, caret, "number");
        const next = insertEditorTokenAt(tokens, createNumberToken(raw), insertIndex);
        return {
          tokens: next,
          caretIndex: caretAfterInsert(insertIndex, 1)
        };
      });
    },
    [applyUpdate]
  );

  const updateNumber = useCallback(
    (tokenId: string, raw: string) => {
      applyUpdate((tokens, caret) => ({
        tokens: tokens.map((entry) =>
          entry.id === tokenId ? updateEditorNumberToken(entry, raw) : entry
        ),
        caretIndex: caret
      }));
    },
    [applyUpdate]
  );

  const removeToken = useCallback(
    (tokenId: string) => {
      applyUpdate((tokens, caret) => {
        const removedIndex = tokens.findIndex((entry) => entry.id === tokenId);
        if (removedIndex < 0) {
          return { tokens, caretIndex: caret };
        }
        const next = removeEditorTokenById(tokens, tokenId);
        return {
          tokens: next,
          caretIndex: caretAfterRemove(caret, removedIndex, next.length)
        };
      });
    },
    [applyUpdate]
  );

  const setFromFormulaString = useCallback(
    (raw: string) => {
      const nextTokens = parseFormulaToEditorTokens(raw);
      const nextFormula = editorTokensToFormula(nextTokens);
      const nextCaret = defaultAppendIndex(nextTokens);
      editorTokensRef.current = nextTokens;
      caretIndexRef.current = nextCaret;
      lastEmittedFormulaRef.current = nextFormula;
      setEditorTokens(nextTokens);
      setCaretIndexState(nextCaret);
      onFormulaChange(nextFormula);
    },
    [onFormulaChange]
  );

  return {
    editorTokens,
    caretIndex,
    setCaretIndex,
    paletteNodes,
    paletteEmptyMessage,
    validation,
    formulaString,
    reorder,
    insertReference,
    insertOperator,
    insertFunction,
    insertComma,
    insertNumber,
    updateNumber,
    removeToken,
    setFromFormulaString
  };
}
