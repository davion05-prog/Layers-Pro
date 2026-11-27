import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Layers Pro | Poultry Farm Management",
  description: "Track flocks, egg production, feed and finances in one farm workspace.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Layers Pro" },
};
export const viewport: Viewport = { themeColor: "#173b32", width: "device-width", initialScale: 1 };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
