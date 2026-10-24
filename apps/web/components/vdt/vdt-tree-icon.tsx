import { clsx } from "clsx";
import type { SVGProps } from "react";

type VdtTreeIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

export function VdtTreeIcon({ className, size = 24, strokeWidth = 1.5, ...props }: VdtTreeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx("shrink-0", className)}
      aria-hidden
      focusable="false"
      {...props}
    >
      <path d="M6.5 12h11M6.5 12c6 0 5-8 11-8M6.5 12c6 0 5 8 11 8" />
      <circle cx="4" cy="12" r="2.5" />
      <circle cx="20" cy="4" r="2.5" />
      <circle cx="20" cy="12" r="2.5" />
      <circle cx="20" cy="20" r="2.5" />
    </svg>
  );
}
