"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FolderPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import type { ProjectCardMetadata } from "@/lib/project-metadata";
import styles from "./projects-home-page.module.css";

export function CreateProjectDialog({ isMutating, error, onCreate, onClose }: {
  isMutating: boolean;
  error?: string | undefined;
  onCreate: (name: string, details: ProjectCardMetadata) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [year, setYear] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    nameInput.current?.focus();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isMutating || !name.trim()) return;
    await onCreate(name.trim(), { clientName, siteName, year });
  }

  return (
    <dialog
      ref={dialog}
      id="create-project-dialog"
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-testid="create-project-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:enabled, input:enabled");
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!isMutating) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !isMutating) onClose();
      }}
    >
      <form data-testid="create-project-form" onSubmit={(event) => void handleSubmit(event)}>
        <header className="flex items-start justify-between gap-4 border-b border-black/5 p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-accent">
              <FolderPlus className="h-5 w-5" />
            </span>
            <div>
              <h2 id={titleId} className="text-xl font-semibold tracking-tight">Create project</h2>
              <p id={descriptionId} className="mt-1 text-sm text-muted">Give your project a name and add its details.</p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label="Close create project" disabled={isMutating} onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <fieldset disabled={isMutating} className="grid gap-5 p-6">
          <Field label="Project name" hint="Required">
            <TextInput ref={nameInput} data-testid="create-project-name-input" value={name} required placeholder="Project name" className="rounded-xl" onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Client name">
            <TextInput value={clientName} placeholder="Client" className="rounded-xl" onChange={(event) => setClientName(event.target.value)} />
          </Field>
          <Field label="Site">
            <TextInput value={siteName} placeholder="Site, plant, or operation" className="rounded-xl" onChange={(event) => setSiteName(event.target.value)} />
          </Field>
          <Field label="Year">
            <TextInput value={year} inputMode="numeric" placeholder={String(new Date().getFullYear())} className="rounded-xl" onChange={(event) => setYear(event.target.value)} />
          </Field>
        </fieldset>
        {error ? <p role="alert" className="mx-6 mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p> : null}
        <footer className="flex justify-end gap-3 border-t border-black/5 bg-slate-50/60 px-6 py-4">
          <Button type="button" className="rounded-full px-5" disabled={isMutating} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" className="rounded-full px-5" data-testid="create-project-submit" disabled={isMutating || !name.trim()}>
            {isMutating ? "Creating…" : "Create project"}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
