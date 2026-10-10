import type { Metadata } from "next";
import "./globals.css";
import "./mobile.css";

export const metadata: Metadata = { title: "Världens toner — Musikquiz", description: "Geografiskt musikquiz för AW" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="sv"><body>{children}</body></html>; }
