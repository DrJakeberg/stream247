import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "Stream247",
  description: "Self-hosted 24/7 stream orchestration"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="shell">
          <aside className="sidebar">
            <div className="brand">
              <h1>Stream247</h1>
              <p>24/7 channel operations</p>
            </div>
            <nav className="nav">
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/sources">Sources</Link>
              <Link href="/schedule">Schedule</Link>
              <Link href="/moderation">Moderation</Link>
            </nav>
          </aside>
          <section className="content">{children}</section>
        </main>
      </body>
    </html>
  );
}

