import type { StatusChipProps } from "@/components/ui/StatusChip";
import type { StreamDestinationRecord } from "@/lib/server/state";

export function resolveDestinationStatusChip(destination: StreamDestinationRecord): Pick<StatusChipProps, "label" | "status"> {
  if (!destination.enabled) {
    return {
      label: "Disabled",
      status: "offline"
    };
  }

  if (destination.status === "ready") {
    return {
      label: "Ready",
      status: "ok"
    };
  }

  if (destination.status === "recovering") {
    return {
      label: "Recovering",
      status: "degraded"
    };
  }

  if (destination.status === "missing-config") {
    return {
      label: "Missing config",
      status: "not-ready"
    };
  }

  return {
    label: "Error",
    status: "degraded"
  };
}
