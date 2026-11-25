import { Badge } from "@/components/ui/Badge";
import { ROW_STATE_LABELS, type RowState } from "@/lib/row-state";

const ROW_STATE_VARIANTS = {
  ready: "ready",
  "needs-setup": "warning",
  failing: "danger"
} as const satisfies Record<RowState, "ready" | "warning" | "danger">;

/** The badge a row starts with (M129): the state is in the words, the tone only repeats it. */
export function RowStateBadge({ state }: { state: RowState }) {
  return <Badge variant={ROW_STATE_VARIANTS[state]}>{ROW_STATE_LABELS[state]}</Badge>;
}
