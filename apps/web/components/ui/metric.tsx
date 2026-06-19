import { clsx } from "clsx";

export function Metric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-normal text-muted">{label}</div>
      <div
        className={clsx("mt-1 truncate text-base font-semibold", {
          "text-ink": tone === "neutral",
          "text-teal": tone === "positive",
          "text-red-600": tone === "negative"
        })}
      >
        {value}
      </div>
    </div>
  );
}
