"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  {
    id: "control-room",
    label: "Control room",
    description: "Readiness, on-air actions, and current runtime state.",
    items: [
      { href: "/broadcast", label: "Broadcast", meta: "On-air controls" },
      { href: "/dashboard", label: "Dashboard", meta: "Readiness and overview" },
      { href: "/ops", label: "Operations", meta: "Incidents and drift" }
    ]
  },
  {
    id: "programming",
    label: "Programming",
    description: "Shape upcoming output, media, and viewer scenes.",
    items: [
      { href: "/schedule", label: "Programming", meta: "Blocks, repeats, fill" },
      { href: "/sources", label: "Library", meta: "Sources, uploads, pools" },
      { href: "/overlay-studio", label: "Scene Studio", meta: "Publish viewer scenes" }
    ]
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Security, policy, and reusable channel setup.",
    items: [
      { href: "/settings", label: "Settings", meta: "Access, secrets, blueprints" },
      { href: "/output", label: "Output", meta: "Resolution and FPS" },
      { href: "/moderation", label: "Moderation", meta: "Presence policy" },
      { href: "/team", label: "Team", meta: "Access grants" }
    ]
  }
];

export function AdminNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="nav">
      {SECTIONS.map((section) => (
        <section className="nav-section" key={section.id}>
          <div className="nav-section-header">
            <span className="label">{section.label}</span>
            <p className="subtle">{section.description}</p>
          </div>
          <div className="nav-section-body">
            {section.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  aria-label={item.label}
                  className={isActive ? "nav-link nav-link-active" : "nav-link"}
                  href={item.href}
                >
                  <span className="nav-link-title">{item.label}</span>
                  <span className="nav-link-meta">{item.meta}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}
