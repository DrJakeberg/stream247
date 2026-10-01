import Link from "next/link";
import type { GoLiveChecklistItem } from "@/lib/server/onboarding";
import { describeWorkspaceHref } from "@/lib/workspace-navigation";

/** The three readiness states, said rather than shown as the identifiers they are stored under. */
const STATUS_LABELS: Record<GoLiveChecklistItem["status"], string> = {
  ready: "Ready",
  action: "Needs action",
  optional: "Optional"
};

export function GoLiveChecklist(props: { items: GoLiveChecklistItem[] }) {
  const readyCount = props.items.filter((item) => item.status === "ready").length;

  return (
    <div className="stack-form">
      <div className="subtle">
        {readyCount} of {props.items.length} readiness steps are ready.
      </div>
      <div className="list">
        {props.items.map((item) => (
          <div className="item" key={item.id}>
            <div className="stats-row">
              <strong>{item.title}</strong>
              <span className={`badge badge-${item.status}`}>{STATUS_LABELS[item.status]}</span>
            </div>
            <div className="subtle">{item.detail}</div>
            {item.href ? (
              <div className="subtle" style={{ marginTop: 8 }}>
                <Link href={item.href}>Open {describeWorkspaceHref(item.href)}</Link>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
