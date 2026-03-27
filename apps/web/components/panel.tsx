import type { ReactNode } from "react";

export function Panel({
  title,
  children,
  eyebrow
}: {
  title: string;
  children: ReactNode;
  eyebrow?: string;
}) {
  return (
    <section className="panel">
      {eyebrow ? <span className="label">{eyebrow}</span> : null}
      <h3>{title}</h3>
      {children}
    </section>
  );
}

