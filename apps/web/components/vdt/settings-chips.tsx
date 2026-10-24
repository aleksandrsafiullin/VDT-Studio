"use client";

import styles from "./settings-modal.module.css";

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
    <div className={styles.chipGroup} data-testid={testIdPrefix ? `${testIdPrefix}-row` : undefined}>
      <p className={styles.fieldLabel}>{label}</p>
      <div className={styles.chipOptions} role="radiogroup" aria-label={label}>
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
              className={styles.chip}
              onClick={() => onChange(option.id)}
            >
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
