import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowUpRight,
  Calculator,
  Check,
  CircleHelp,
  Database,
  GitBranch,
  Globe,
  HelpCircle,
  Link,
  MessageSquare,
  Pencil,
  Sparkles,
  Target,
  TextCursorInput,
  TrendingDown,
  X,
  Ruler
} from "lucide-react";
import { clsx } from "clsx";
import type { VdtEdgeRelation, VdtNodeStatus, VdtNodeType } from "@vdt-studio/vdt-core";

export type VdtIconDisplay =
  | { kind: "lucide"; Icon: LucideIcon; label: string }
  | { kind: "symbol"; symbol: string; label: string };

export type VdtIconVariant = "status" | "nodeType" | "edge";

function humanizeKey(key: string) {
  return key.replaceAll("_", " ");
}

const STATUS_ICONS: Record<VdtNodeStatus, VdtIconDisplay> = {
  ai_suggested: { kind: "lucide", Icon: Sparkles, label: "AI suggested" },
  accepted: { kind: "lucide", Icon: Check, label: "Accepted" },
  edited: { kind: "lucide", Icon: Pencil, label: "Edited" },
  rejected: { kind: "lucide", Icon: X, label: "Rejected" },
  needs_data: { kind: "lucide", Icon: Database, label: "Needs data" },
  formula_issue: { kind: "lucide", Icon: AlertTriangle, label: "Formula issue" },
  unit_issue: { kind: "lucide", Icon: Ruler, label: "Unit issue" },
  assumption: { kind: "lucide", Icon: HelpCircle, label: "Assumption" },
  external_factor: { kind: "lucide", Icon: Globe, label: "External factor" }
};

const NODE_TYPE_ICONS: Record<VdtNodeType, VdtIconDisplay> = {
  root_kpi: { kind: "lucide", Icon: Target, label: "Root KPI" },
  calculated: { kind: "lucide", Icon: Calculator, label: "Calculated" },
  input: { kind: "lucide", Icon: TextCursorInput, label: "Input" },
  assumption: { kind: "lucide", Icon: HelpCircle, label: "Assumption" },
  external_factor: { kind: "lucide", Icon: Globe, label: "External factor" },
  data_mapped: { kind: "lucide", Icon: Link, label: "Data mapped" }
};

const EDGE_RELATION_ICONS: Record<VdtEdgeRelation, VdtIconDisplay> = {
  multiplicative_driver: { kind: "symbol", symbol: "×", label: "Multiplicative driver" },
  additive_component: { kind: "symbol", symbol: "+", label: "Additive component" },
  subtractive_component: { kind: "symbol", symbol: "−", label: "Subtractive component" },
  negative_driver: { kind: "lucide", Icon: TrendingDown, label: "Negative driver" },
  divisive_driver: { kind: "symbol", symbol: "÷", label: "Divisive driver" },
  positive_driver: { kind: "lucide", Icon: ArrowUpRight, label: "Positive driver" },
  formula_dependency: { kind: "lucide", Icon: GitBranch, label: "Formula dependency" },
  contextual_influence: { kind: "lucide", Icon: MessageSquare, label: "Contextual influence" }
};

const FALLBACK_ICON: VdtIconDisplay = {
  kind: "lucide",
  Icon: CircleHelp,
  label: "Unknown"
};

export function getStatusIcon(status: string): VdtIconDisplay {
  return STATUS_ICONS[status as VdtNodeStatus] ?? { ...FALLBACK_ICON, label: humanizeKey(status) };
}

export function getNodeTypeIcon(type: string): VdtIconDisplay {
  return NODE_TYPE_ICONS[type as VdtNodeType] ?? { ...FALLBACK_ICON, label: humanizeKey(type) };
}

export function getEdgeRelationIcon(relation: string): VdtIconDisplay {
  return EDGE_RELATION_ICONS[relation as VdtEdgeRelation] ?? { ...FALLBACK_ICON, label: humanizeKey(relation) };
}

function variantSizeClass(variant: VdtIconVariant) {
  if (variant === "nodeType") {
    return "h-3 w-3";
  }
  return "h-3.5 w-3.5";
}

export function VdtIcon({
  display,
  variant = "status",
  className
}: {
  display: VdtIconDisplay;
  variant?: VdtIconVariant;
  className?: string;
}) {
  if (display.kind === "symbol") {
    return (
      <span
        className={clsx(
          "inline-flex items-center justify-center tabular-nums leading-none",
          variant === "edge" ? "text-xs font-semibold" : "text-[11px] font-semibold",
          className
        )}
        aria-hidden
      >
        {display.symbol}
      </span>
    );
  }

  const { Icon } = display;
  return <Icon className={clsx(variantSizeClass(variant), "shrink-0", className)} aria-hidden />;
}
