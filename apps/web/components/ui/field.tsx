import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { clsx } from "clsx";

const controlClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-ink shadow-sm outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-blue-100";

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-4 text-muted">{hint}</span> : null}
    </label>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...props },
  ref
) {
  return <input ref={ref} className={clsx(controlClass, className)} {...props} />;
});
TextInput.displayName = "TextInput";

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(controlClass, "min-h-20 resize-none", className)} {...props} />;
}

export function SelectInput({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx(controlClass, "appearance-auto", className)} {...props} />;
}
