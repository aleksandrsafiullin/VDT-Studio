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
      <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">{label}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2" role="radiogroup" aria-label={label}>
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
                "min-h-[38px] rounded-md border px-3 py-2 text-left text-xs font-semibold transition",
                selected
                  ? "border-ink bg-ink text-white shadow-sm"
                  : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white hover:text-ink",
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
