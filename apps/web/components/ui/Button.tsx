import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonProps = {
  variant: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export function Button({
  variant,
  size = "md",
  loading = false,
  className = "",
  disabled,
  type = "button",
  children,
  ...buttonProps
}: ButtonProps) {
  const variantClassName =
    variant === "primary"
      ? ""
      : variant === "secondary"
        ? "button-secondary"
        : variant === "danger"
          ? "button-danger"
          : "button-ghost";

  return (
    <button
      {...buttonProps}
      className={["button", variantClassName, `button-size-${size}`, className].filter(Boolean).join(" ")}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? <span aria-hidden="true" className="button-spinner" /> : null}
      <span>{children}</span>
    </button>
  );
}
