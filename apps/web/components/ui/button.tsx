import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function Button({
  className,
  variant = "secondary",
  size = "md",
  icon,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-md border transition disabled:cursor-not-allowed disabled:opacity-45",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        {
          "border-accent bg-accent text-white shadow-sm hover:bg-blue-700": variant === "primary",
          "border-line bg-white text-graphite hover:bg-slate-50": variant === "secondary",
          "border-transparent bg-transparent text-graphite hover:bg-slate-100": variant === "ghost",
          "border-red-200 bg-red-50 text-red-700 hover:bg-red-100": variant === "danger",
          "h-8 px-2.5 text-xs font-medium": size === "sm",
          "h-9 px-3 text-sm font-medium": size === "md",
          "h-8 w-8 p-0": size === "icon"
        },
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
