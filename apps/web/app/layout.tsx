import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Stream247",
  description: "Self-hosted 24/7 stream orchestration"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
