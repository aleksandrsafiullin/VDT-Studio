"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  INSTRUCTION_COUNT_LIMIT, INSTRUCTION_TEXT_LIMIT, INSTRUCTION_TOTAL_LIMIT,
  instructionTextLength, validInstructionPreferences, type InstructionPreferences, type UserInstruction
} from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import styles from "./personalisation-settings.module.css";

export function InstructionEditorDialog({ instruction, isNew, preferences, pending, returnFocus, onCancel, onSave }: {
  instruction: UserInstruction; isNew: boolean; preferences: InstructionPreferences; pending: boolean;
  returnFocus: HTMLElement | null; onCancel: () => void; onSave: (instruction: UserInstruction) => string | undefined;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const titleId = useId(), textId = useId();
  const [text, setText] = useState(instruction.text);
  const [enabled, setEnabled] = useState(instruction.enabled);
  const [saveError, setSaveError] = useState<string>();
  const entry = { ...instruction, text: text.trim(), enabled };
  const exists = preferences.instructions.some(item => item.id === instruction.id);
  const items = exists ? preferences.instructions.map(item => item.id === entry.id ? entry : item)
    : [...preferences.instructions, entry];
  const missing = !isNew && !exists;
  const total = instructionTextLength(items);
  const issue = missing ? "This instruction was removed. Close the editor and try again."
    : items.length > INSTRUCTION_COUNT_LIMIT ? "You can save up to " + INSTRUCTION_COUNT_LIMIT + " instructions."
      : total > INSTRUCTION_TOTAL_LIMIT ? "Keep all instructions under " + INSTRUCTION_TOTAL_LIMIT.toLocaleString("en-US") + " characters in total." : undefined;
  const dirty = isNew || entry.text !== instruction.text || enabled !== instruction.enabled;
  const canSave = !pending && !issue && dirty && validInstructionPreferences({ instructions: items });

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    textarea.current?.focus();
    return () => {
      element.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [returnFocus]);

  return createPortal(
    <dialog ref={dialog} className={styles.editorDialog} aria-labelledby={titleId} aria-modal="true"
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); onCancel(); }}
      onClick={event => { if (event.target === event.currentTarget) onCancel(); }}
      data-testid="instruction-editor">
      <form className={styles.editorForm} onSubmit={event => {
        event.preventDefault();
        if (canSave) setSaveError(onSave(entry));
      }}>
        <header className={styles.editorHeader}>
          <div><h3 id={titleId}>{isNew ? "New instruction" : "Edit instruction"}</h3>
            <p>Guide how AI works across all your projects.</p></div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close instruction editor" onClick={onCancel}><X size={17} /></Button>
        </header>
        <div className={styles.editorBody}>
          <label htmlFor={textId}>Instruction</label>
          <TextArea ref={textarea} id={textId} rows={10} maxLength={INSTRUCTION_TEXT_LIMIT} value={text} readOnly={pending}
            placeholder="Describe the rule you want AI to follow."
            onChange={event => { setText(event.target.value); setSaveError(undefined); }} />
          <div className={styles.editorCounter}>{text.length.toLocaleString("en-US")} / {INSTRUCTION_TEXT_LIMIT.toLocaleString("en-US")}</div>
          {issue || saveError ? <p role="alert" className={styles.error}>{issue ?? saveError}</p> : null}
          {pending ? <p role="status" className={styles.help}>Finish or reconcile the pending KPI save before saving instructions.</p> : null}
        </div>
        <footer className={styles.editorFooter}>
          <label className={styles.toggle}><input type="checkbox" checked={enabled} disabled={pending}
            onChange={event => { setEnabled(event.target.checked); setSaveError(undefined); }} />Enabled</label>
          <div className={styles.actions}>
            <Button type="button" onClick={onCancel}>Cancel</Button>
            <Button type="submit" variant="primary" className={styles.saveButton} disabled={!canSave} data-testid="instruction-editor-save">Save</Button>
          </div>
        </footer>
      </form>
    </dialog>,
    document.body
  );
}
