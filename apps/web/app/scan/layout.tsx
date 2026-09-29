import type { Metadata, Viewport } from "next";
import { appMetadata, appViewport } from "@/lib/app-meta";

// Part of the installable staff app (lib/app-meta.ts); gate staff open it straight onto the scanner.
export const metadata: Metadata = { ...appMetadata, title: "Scanner" };

export const viewport: Viewport = { ...appViewport, maximumScale: 1, userScalable: false };

export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return children;
}
