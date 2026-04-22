import type { ReactNode } from "react";

export function EmptyState(props: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={["empty-state", props.className].filter(Boolean).join(" ")}>
      <strong>{props.title}</strong>
      <p className="subtle">{props.description}</p>
      {props.action ? <div className="empty-state-action">{props.action}</div> : null}
    </section>
  );
}
