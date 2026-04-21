import type { ReactNode } from "react";

export type BadgeProps = {
  variant?: "ready" | "warning" | "danger" | "neutral" | "live";
  children: ReactNode;
  className?: string;
};

export function resolveBadgeContent(children: ReactNode): ReactNode | null {
  if (children === null || children === undefined || typeof children === "boolean") {
    return null;
  }

  if (typeof children === "string") {
    const trimmed = children.trim();
    return trimmed && trimmed !== "[]" ? trimmed : null;
  }

  return children;
}

export function Badge({ variant = "neutral", children, className = "" }: BadgeProps) {
  const content = resolveBadgeContent(children);
  if (content === null) {
    return null;
  }

  const variantClassName =
    variant === "ready" || variant === "live"
      ? "badge-ready"
      : variant === "warning" || variant === "danger"
        ? "badge-action"
        : "badge-optional";

  return <span className={["badge", variantClassName, className].filter(Boolean).join(" ")}>{content}</span>;
}
