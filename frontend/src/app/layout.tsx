import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MonShield Tracker",
  description: "Trading admin center for the Nautilus Trader engine",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
