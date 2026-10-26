"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { List, MoreHorizontal, Plus } from "lucide-react";
import {
  INSTRUCTION_COUNT_LIMIT, normalizeInstructionPreferences, validInstructionPreferences, type UserInstruction
} from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { makeId } from "@/lib/id";
import { InstructionEditorDialog } from "./instruction-editor-dialog";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./personalisation-settings.module.css";

function InstructionMenu({ anchor, enabled, pending, onClose, onAction }: {
  anchor: HTMLButtonElement; enabled: boolean; pending: boolean;
  onClose: () => void; onAction: (action: "edit" | "toggle" | "delete") => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect(), element = menu.current;
    if (!element) return;
    setPosition({ left: Math.max(8, Math.min(rect.right - element.offsetWidth, window.innerWidth - element.offsetWidth - 8)),
      top: rect.bottom + element.offsetHeight + 6 <= window.innerHeight - 8
        ? rect.bottom + 6 : Math.max(8, rect.top - element.offsetHeight - 6) });
  }, [anchor]);
  useLayoutEffect(() => {
    if (position) menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [position]);
  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault(); event.stopPropagation(); onClose(); anchor.focus();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }
    function outside(event: PointerEvent) {
      if (!menu.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose();
    }
    document.addEventListener("keydown", keyDown, true);
    document.addEventListener("pointerdown", outside, true);
    const dismiss = () => onClose();
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("keydown", keyDown, true); document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [anchor, onClose]);
  return createPortal(<div ref={menu} role="menu" aria-label="Instruction actions" className={styles.menu}
    style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}>
    <button type="button" role="menuitem" onClick={() => onAction("edit")}>Edit</button>
    <button type="button" role="menuitem" disabled={pending} onClick={() => onAction("toggle")}>{enabled ? "Disable" : "Enable"}</button>
    <div role="separator" className={styles.separator} />
    <button type="button" role="menuitem" className={styles.deleteAction} disabled={pending} onClick={() => onAction("delete")}>Delete</button>
  </div>, document.body);
}

export function PersonalisationSettings() {
  const preferences = useVdtStudioStore(state => state.personalisation);
  const save = useVdtStudioStore(state => state.savePersonalisation);
  const pending = useVdtStudioStore(state => !!state.smartKpiOperation);
  const newButton = useRef<HTMLButtonElement>(null);
  const editorReturnFocus = useRef<HTMLElement | null>(null);
  const [editor, setEditor] = useState<{ instruction: UserInstruction; isNew: boolean }>();
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLButtonElement }>();
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [removed, setRemoved] = useState<{ instruction: UserInstruction; index: number }>();

  function openEditor(instruction: UserInstruction | undefined, returnFocus: HTMLElement | null) {
    editorReturnFocus.current = returnFocus; setMenu(undefined);
    setEditor({ instruction: instruction ?? { id: makeId("instruction"), enabled: true, text: "" }, isNew: !instruction });
  }

  function persist(instructions: UserInstruction[], message: string): string | undefined {
    if (!validInstructionPreferences({ instructions })) return "Check the instruction text and total length before saving.";
    try {
      if (!save(normalizeInstructionPreferences({ instructions }))) {
        throw new Error("This change could not be saved in the browser. Keep a copy of your text and try again.");
      }
      setRemoved(undefined); setNotice({ text: message, error: false });
      return undefined;
    } catch (error) {
      const text = error instanceof Error ? error.message : "Instructions could not be saved.";
      setNotice({ text, error: true }); return text;
    }
  }

  function saveEntry(instruction: UserInstruction): string | undefined {
    const current = useVdtStudioStore.getState().personalisation.instructions;
    const exists = current.some(item => item.id === instruction.id);
    if (!editor?.isNew && !exists) return "This instruction was removed. Close the editor and try again.";
    const next = exists ? current.map(item => item.id === instruction.id ? instruction : item) : [...current, instruction];
    const error = persist(next, editor?.isNew ? "Instruction added." : "Instruction updated.");
    if (!error) setEditor(undefined);
    return error;
  }

  function menuAction(action: "edit" | "toggle" | "delete") {
    if (!menu) return;
    const current = useVdtStudioStore.getState().personalisation.instructions;
    const index = current.findIndex(item => item.id === menu.id), instruction = current[index];
    const anchor = menu.anchor;
    setMenu(undefined);
    if (!instruction) return;
    if (action === "edit") { openEditor(instruction, anchor); return; }
    if (action === "toggle") {
      persist(current.map(item => item.id === instruction.id ? { ...item, enabled: !item.enabled } : item),
        instruction.enabled ? "Instruction disabled." : "Instruction enabled.");
      requestAnimationFrame(() => { if (anchor.isConnected) anchor.focus(); });
    } else {
      persist(current.filter(item => item.id !== instruction.id), "Instruction deleted.");
      setRemoved({ instruction, index });
      requestAnimationFrame(() => newButton.current?.focus());
    }
  }

  function undoDelete() {
    if (!removed) return;
    const current = [...useVdtStudioStore.getState().personalisation.instructions];
    if (!current.some(item => item.id === removed.instruction.id)) current.splice(Math.min(removed.index, current.length), 0, removed.instruction);
    persist(current, "Instruction restored.");
    requestAnimationFrame(() => newButton.current?.focus());
  }

  const selected = menu ? preferences.instructions.find(item => item.id === menu.id) : undefined;
  return <section className={styles.settings} data-testid="personalisation-settings">
    <header className={styles.heading}>
      <h3>Your instructions <span className={styles.count}>{preferences.instructions.length}</span></h3>
      <Button ref={newButton} size="sm" icon={<Plus size={14} />} disabled={pending || preferences.instructions.length >= INSTRUCTION_COUNT_LIMIT}
        onClick={event => openEditor(undefined, event.currentTarget)} data-testid="add-instruction">New</Button>
    </header>

    {preferences.instructions.length ? <div className={styles.list} data-testid="user-instructions">
      {preferences.instructions.map((instruction, index) => <div key={instruction.id} className={styles.row} data-testid="instruction-item">
        <button type="button" className={styles.preview} aria-label={"Edit instruction " + (index + 1)}
          title={instruction.text} onClick={event => openEditor(instruction, event.currentTarget)}>
          <span className={styles.ruleIcon}><List size={15} aria-hidden /></span>
          <span className={styles.summary} data-disabled={!instruction.enabled}>
            <span className={styles.previewText}>{instruction.text.replace(/\s+/g, " ").trim()}</span>
            <span className={styles.ruleType}>{instruction.enabled ? "User Rule" : "User Rule · Disabled"}</span>
          </span>
        </button>
        <button type="button" className={styles.more} aria-label={"Actions for instruction " + (index + 1)}
          aria-haspopup="menu" aria-expanded={menu?.id === instruction.id}
          onClick={event => setMenu(menu?.id === instruction.id ? undefined : { id: instruction.id, anchor: event.currentTarget })}>
          <MoreHorizontal size={17} aria-hidden />
        </button>
      </div>)}
    </div> : <div className={styles.empty} data-testid="user-instructions">
      <p>No instructions yet</p>
      <span>Choose New to add a preferred language, response style or a rule.</span>
    </div>}

    {notice ? <div role={notice.error ? "alert" : "status"} className={notice.error ? styles.error : styles.notice}>
      <span>{notice.text}</span>
      {removed ? <button type="button" className={styles.undo} onClick={undoDelete}>Undo</button> : null}
    </div> : null}
    <p className={styles.help}>Used in chat, Suggested KPI and tree analysis across all your projects. Saved in this browser.</p>
    {pending ? <p role="status" className={styles.help}>Finish or reconcile the pending KPI save before changing instructions.</p> : null}
    {menu && selected ? <InstructionMenu anchor={menu.anchor} enabled={selected.enabled} pending={pending}
      onClose={() => setMenu(undefined)} onAction={menuAction} /> : null}
    {editor ? <InstructionEditorDialog key={editor.instruction.id} instruction={editor.instruction} isNew={editor.isNew}
      preferences={preferences} pending={pending} returnFocus={editorReturnFocus.current} onCancel={() => setEditor(undefined)} onSave={saveEntry} /> : null}
  </section>;
}
