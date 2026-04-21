import type { ReactNode } from "react";

export type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, subtitle, actions, className = "" }: PageHeaderProps) {
  return (
    <section className={["hero", className].filter(Boolean).join(" ")}>
      <div className="page-header-row">
        <div className="page-header-copy">
          <h2 title={title}>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </div>
    </section>
  );
}
