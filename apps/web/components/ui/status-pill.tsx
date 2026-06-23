import { clsx } from "clsx";
import { getStatusIcon, VdtIcon } from "@/components/vdt/vdt-icons";

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
  const icon = getStatusIcon(status);

  return (
    <span
      role="img"
      aria-label={icon.label}
      title={icon.label}
      className={clsx(
        "inline-flex max-w-full items-center justify-center rounded-full border p-1 leading-none",
        toneByStatus[status] ?? "border-slate-200 bg-slate-50 text-slate-700",
        className
      )}
    >
      <VdtIcon display={icon} variant="status" />
    </span>
  );
}
