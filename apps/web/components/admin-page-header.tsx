import type { ReactNode } from "react";

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  children,
  compact = false,
  className = ""
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <section className={[compact ? "hero hero-compact" : "hero", className].filter(Boolean).join(" ")}>
      <span className="badge">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </section>
  );
}
