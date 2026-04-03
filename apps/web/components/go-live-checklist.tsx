import Link from "next/link";
import type { GoLiveChecklistItem } from "@/lib/server/onboarding";

export function GoLiveChecklist(props: { items: GoLiveChecklistItem[] }) {
  const readyCount = props.items.filter((item) => item.status === "ready").length;

  return (
    <div className="stack-form">
      <div className="subtle">
        {readyCount} of {props.items.length} launch steps are ready.
      </div>
      <div className="list">
        {props.items.map((item) => (
          <div className="item" key={item.id}>
            <div className="stats-row">
              <strong>{item.title}</strong>
              <span className={`badge badge-${item.status}`}>{item.status === "action" ? "Needs action" : item.status}</span>
            </div>
            <div className="subtle">{item.detail}</div>
            <div className="subtle" style={{ marginTop: 8 }}>
              <Link href={item.href}>Open {item.href.replace("/", "") || "setup"}</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
