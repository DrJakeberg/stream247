"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/broadcast", label: "Broadcast" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/ops", label: "Ops" },
  { href: "/sources", label: "Sources" },
  { href: "/schedule", label: "Schedule" },
  { href: "/overlay-studio", label: "Overlay" },
  { href: "/settings", label: "Settings" },
  { href: "/moderation", label: "Moderation" },
  { href: "/team", label: "Team" }
];

export function AdminNavigation() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      {ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} className={isActive ? "nav-link-active" : ""} href={item.href}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
