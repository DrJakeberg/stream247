"use client";

import { usePathname } from "next/navigation";
import { ADMIN_NAV_SECTIONS } from "@/lib/admin-navigation";

export function AdminNavigation() {
  const pathname = usePathname();

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
              return (
                <a
                  aria-label={item.label}
                  className={isActive ? "nav-link nav-link-active" : "nav-link"}
                  href={item.href}
                  key={item.href}
                  title={item.label}
                >
                  <span className="nav-link-title">{item.label}</span>
                </a>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}
