"use client";

import { clsx } from "clsx";

export interface SettingsChipOption<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

interface SettingsChipRowProps<T extends string> {
  label: string;
  options: readonly SettingsChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  testIdPrefix?: string;
}

export function SettingsChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
  testIdPrefix
}: SettingsChipRowProps<T>) {
  return (
    <div className="space-y-2" data-testid={testIdPrefix ? `${testIdPrefix}-row` : undefined}>
      <p className="text-xs font-semibold uppercase tracking-normal text-muted">{label}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((option) => {
          const selected = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={option.disabled}
              data-testid={testIdPrefix ? `${testIdPrefix}-${option.id}` : undefined}
              className={clsx(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                selected
                  ? "border-accent bg-blue-50 text-accent"
                  : "border-line bg-white text-ink hover:border-slate-300",
                option.disabled && "cursor-not-allowed opacity-50"
              )}
              onClick={() => onChange(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
