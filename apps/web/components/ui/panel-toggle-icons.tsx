import { clsx } from "clsx";

type IconProps = {
  className?: string | undefined;
};

/** SF Symbol: inset.filled.lefthalf.rectangle */
export function InsetFilledLeftHalfRectangle({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={clsx("shrink-0", className)} aria-hidden>
      <rect x="2" y="3.5" width="12" height="9" rx="1.75" fill="none" stroke="currentColor" strokeWidth="1.15" />
      <rect x="2.55" y="4.05" width="5.35" height="7.9" rx="1.15" fill="currentColor" />
    </svg>
  );
}

/** SF Symbol: inset.filled.rightthird.rectangle */
export function InsetFilledRightThirdRectangle({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={clsx("shrink-0", className)} aria-hidden>
      <rect x="2" y="3.5" width="12" height="9" rx="1.75" fill="none" stroke="currentColor" strokeWidth="1.15" />
      <rect x="9.45" y="4.05" width="3.5" height="7.9" rx="1.15" fill="currentColor" />
    </svg>
  );
}

/** SF Symbol: inset.filled.bottomthird.rectangle */
export function InsetFilledBottomThirdRectangle({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={clsx("shrink-0", className)} aria-hidden>
      <rect x="2" y="3.5" width="12" height="9" rx="1.75" fill="none" stroke="currentColor" strokeWidth="1.15" />
      <rect x="2.55" y="9.35" width="10.9" height="2.6" rx="1.15" fill="currentColor" />
    </svg>
  );
}

export type PanelToggleTarget = "left" | "right" | "bottom";

const ICON_BY_PANEL: Record<PanelToggleTarget, typeof InsetFilledLeftHalfRectangle> = {
  left: InsetFilledLeftHalfRectangle,
  right: InsetFilledRightThirdRectangle,
  bottom: InsetFilledBottomThirdRectangle
};

export function PanelToggleIcon({
  panel,
  className
}: {
  panel: PanelToggleTarget;
  className?: string | undefined;
}) {
  const Icon = ICON_BY_PANEL[panel];
  return <Icon className={className} />;
}
