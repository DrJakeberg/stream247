export const dynamic = "force-dynamic";

import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/server/auth";
import { readAppState } from "@/lib/server/state";
import { LogoutButton } from "@/components/logout-button";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const state = await readAppState();

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
        <nav className="nav">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/sources">Sources</Link>
          <Link href="/schedule">Schedule</Link>
          <Link href="/overlay-studio">Overlay</Link>
          <Link href="/settings">Settings</Link>
          <Link href="/moderation">Moderation</Link>
          <Link href="/team">Team</Link>
          <Link href="/channel">Public page</Link>
        </nav>
        <div style={{ marginTop: 24 }}>
          <LogoutButton />
        </div>
      </aside>
      <section className="content">{children}</section>
    </main>
  );
}
