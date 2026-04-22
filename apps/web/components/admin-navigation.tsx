"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { BroadcastSnapshot } from "@/lib/live-broadcast";
import { useLiveSnapshot } from "@/components/use-live-snapshot";
import { ADMIN_NAV_SECTIONS } from "@/lib/admin-navigation";

export function AdminNavigation(props: { initialSnapshot: BroadcastSnapshot }) {
  const pathname = usePathname();
  const { snapshot } = useLiveSnapshot({
    initialSnapshot: props.initialSnapshot,
    stateUrl: "/api/broadcast/state",
    streamUrl: "/api/broadcast/stream"
  });

  return (
    <nav aria-label="Admin" className="nav">
      {ADMIN_NAV_SECTIONS.map((section) => (
        <section className="nav-section" key={section.id}>
          <div className="nav-section-header">
            <span className="label">{section.label}</span>
          </div>
          <div className="nav-section-body">
            {section.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const showPresenceDot = item.href === "/moderation" && snapshot.presence.active;
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
          </div>
        </section>
      ))}
    </nav>
  );
}
