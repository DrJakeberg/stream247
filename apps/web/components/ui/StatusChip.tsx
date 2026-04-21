export type StatusChipProps = {
  status: "ok" | "degraded" | "not-ready" | "unknown" | "live" | "offline";
  label: string;
  className?: string;
};

export function StatusChip({ status, label, className = "" }: StatusChipProps) {
  return (
    <span className={["status-chip", `status-chip-${status}`, className].filter(Boolean).join(" ")}>
      <span aria-hidden="true" className="status-chip-dot" />
      <span>{label}</span>
    </span>
  );
}
