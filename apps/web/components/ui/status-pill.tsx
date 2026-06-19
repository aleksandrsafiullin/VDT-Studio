import { clsx } from "clsx";

const toneByStatus: Record<string, string> = {
  ai_suggested: "border-blue-200 bg-blue-50 text-blue-700",
  accepted: "border-emerald-200 bg-emerald-50 text-emerald-700",
  edited: "border-amber-200 bg-amber-50 text-amber-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
  needs_data: "border-slate-200 bg-slate-50 text-slate-700",
  formula_issue: "border-orange-200 bg-orange-50 text-orange-700",
  unit_issue: "border-purple-200 bg-purple-50 text-purple-700",
  assumption: "border-teal-200 bg-teal-50 text-teal-700",
  external_factor: "border-slate-200 bg-slate-50 text-slate-700"
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs font-semibold leading-4",
        toneByStatus[status] ?? "border-slate-200 bg-slate-50 text-slate-700",
        className
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
