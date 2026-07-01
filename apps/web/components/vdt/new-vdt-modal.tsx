"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(event: KeyboardEvent, container: HTMLElement) {
  if (event.key !== "Tab") {
    return;
  }

  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement
  );

  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement as HTMLElement | null;

  if (event.shiftKey) {
    if (active === first || !container.contains(active)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (active === last) {
    event.preventDefault();
    first.focus();
  }
}

export interface NewVdtModalValues {
  rootKpi: string;
  unit: string;
  timePeriod: string;
}

const DEFAULT_VALUES: NewVdtModalValues = {
  rootKpi: "",
  unit: "",
  timePeriod: "monthly"
};

interface NewVdtModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (values: NewVdtModalValues) => Promise<boolean>;
  isSubmitting?: boolean;
}

export function NewVdtModal({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting = false
}: NewVdtModalProps) {
  const [values, setValues] = useState<NewVdtModalValues>(DEFAULT_VALUES);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const canConfirm = values.rootKpi.trim().length > 0 && !isSubmitting;

  const closeModal = useCallback(() => {
    if (isSubmitting) {
      return;
    }
    onOpenChange(false);
  }, [isSubmitting, onOpenChange]);

  useEffect(() => {
    if (open) {
      setValues(DEFAULT_VALUES);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }

      if (dialogRef.current) {
        trapFocus(event, dialogRef.current);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, closeModal]);

  async function handleConfirm() {
    if (!canConfirm) {
      return;
    }

    const success = await onConfirm({
      rootKpi: values.rootKpi.trim(),
      unit: values.unit.trim(),
      timePeriod: values.timePeriod.trim() || "monthly"
    });

    if (success) {
      closeModal();
    }
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        aria-hidden="true"
        data-testid="new-vdt-modal-backdrop"
        onClick={closeModal}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="new-vdt-modal"
        className={clsx(
          "relative z-10 w-full max-w-md overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.26)]"
        )}
      >
        <header className="border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            New VDT
          </h2>
          <p className="mt-1 text-sm text-muted">Set the root KPI and measurement context for this VDT.</p>
        </header>

        <div className="space-y-3 px-5 py-4">
          <Field label="Root KPI">
            <TextInput
              className="py-2"
              placeholder="e.g. Production Volume"
              value={values.rootKpi}
              autoFocus
              onChange={(event) => setValues((current) => ({ ...current, rootKpi: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canConfirm) {
                  event.preventDefault();
                  void handleConfirm();
                }
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Unit">
              <TextInput
                className="py-2"
                placeholder="e.g. tonnes/month"
                value={values.unit}
                onChange={(event) => setValues((current) => ({ ...current, unit: event.target.value }))}
              />
            </Field>
            <Field label="Period">
              <TextInput
                className="py-2"
                placeholder="monthly"
                value={values.timePeriod}
                onChange={(event) => setValues((current) => ({ ...current, timePeriod: event.target.value }))}
              />
            </Field>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line bg-slate-50 px-5 py-4">
          <Button
            type="button"
            variant="secondary"
            data-testid="new-vdt-modal-cancel"
            disabled={isSubmitting}
            onClick={closeModal}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="new-vdt-modal-confirm"
            disabled={!canConfirm}
            onClick={() => void handleConfirm()}
          >
            OK
          </Button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
