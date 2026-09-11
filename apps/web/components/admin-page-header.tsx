import type { ReactNode } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  children,
  compact = false,
  className = "",
  info
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
  compact?: boolean;
  className?: string;
  /** Short explanation of what this page is for, shown behind an (i) beside the title. */
  info?: string;
}) {
  return (
    <section className={[compact ? "hero hero-compact" : "hero", className].filter(Boolean).join(" ")}>
      <span className="badge">{eyebrow}</span>
      <h2 className={info ? "label-with-info" : undefined}>
        {title}
        {info ? <InfoTip text={info} /> : null}
      </h2>
      <p>{description}</p>
      {children}
    </section>
  );
}
