"use client";

export function SpacingSlider({
  label,
  value,
  min,
  max,
  step,
  testId,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  testId: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-xs font-medium text-ink">
        <span>{label}</span>
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-semibold">
          {value}px
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value}px`}
        data-testid={testId}
        className="w-full accent-accent"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
