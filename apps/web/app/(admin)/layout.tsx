export const dynamic = "force-dynamic";

import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/server/auth";
import { getBroadcastSnapshot, readAppState } from "@/lib/server/state";
import { AdminNavigation } from "@/components/admin-navigation";
import { AdminStatusRail } from "@/components/admin-status-rail";
import { LogoutButton } from "@/components/logout-button";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const state = await readAppState();
  const snapshot = getBroadcastSnapshot(state);

  if (!state.initialized) {
    redirect("/setup");
  }

  const user = await requireAuthenticatedUser();

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Stream247</h1>
          <p>
            {user.displayName} · {user.role}
          </p>
        </div>
        <AdminNavigation />
        <div style={{ marginTop: 24 }}>
          <Link className="subtle-link" href="/channel" target="_blank">
            Open public page
          </Link>
        </div>
        <div style={{ marginTop: 24 }}>
          <LogoutButton />
        </div>
      </aside>
      <section className="content">
        <div className="content-stack">
          <AdminStatusRail initialSnapshot={snapshot} />
          {children}
        </div>
      </section>
    </main>
  );
}
