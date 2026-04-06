import type { ReactNode } from "react";

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  children,
  compact = false
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "hero hero-compact" : "hero"}>
      <span className="badge">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </section>
  );
}
