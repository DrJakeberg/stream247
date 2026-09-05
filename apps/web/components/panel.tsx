import type { ReactNode } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

export function Panel({
  title,
  children,
  eyebrow,
  info
}: {
  title: string;
  children: ReactNode;
  eyebrow?: string;
  /** Short explanation of what this panel is for, shown behind an (i) beside the title. */
  info?: string;
}) {
  return (
    <section className="panel">
      {eyebrow ? <span className="label">{eyebrow}</span> : null}
      <h3 className={info ? "label-with-info" : undefined}>
        {title}
        {info ? <InfoTip text={info} /> : null}
      </h3>
      {children}
    </section>
  );
}

