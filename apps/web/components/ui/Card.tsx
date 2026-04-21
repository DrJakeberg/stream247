import type { ReactNode } from "react";

export type CardProps = {
  padding?: "sm" | "md" | "lg";
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Card({ padding = "md", header, footer, children, className = "" }: CardProps) {
  const paddingClassName = padding === "sm" ? "panel-compact" : padding === "lg" ? "card-lg" : "";

  return (
    <section className={["panel", paddingClassName, className].filter(Boolean).join(" ")}>
      {header ? <div className="card-section-header">{header}</div> : null}
      <div className="card-section-body">{children}</div>
      {footer ? <div className="card-section-footer">{footer}</div> : null}
    </section>
  );
}
