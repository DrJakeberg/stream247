"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { BroadcastSnapshot } from "@/lib/live-broadcast";
import { useLiveSnapshot } from "@/components/use-live-snapshot";
import { ADMIN_WORKSPACES } from "@/lib/admin-navigation";

export function AdminNavigation(props: { initialSnapshot: BroadcastSnapshot }) {
  const pathname = usePathname();
  const { snapshot } = useLiveSnapshot({
    initialSnapshot: props.initialSnapshot,
    stateUrl: "/api/broadcast/state",
    streamUrl: "/api/broadcast/stream"
  });

  return (
    <nav aria-label="Admin" className="nav">
      {ADMIN_WORKSPACES.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const showPresenceDot = item.href === "/live" && snapshot.presence.active;
        return (
          <Link
            aria-label={item.label}
            className={isActive ? "nav-link nav-link-active" : "nav-link"}
            href={item.href}
            key={item.href}
            title={item.label}
          >
            <span className="nav-link-title">{item.label}</span>
            {showPresenceDot ? <span aria-hidden="true" className="nav-link-dot" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
