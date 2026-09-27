import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Scanner",
  manifest: "/scan.webmanifest",
  robots: { index: false },
  appleWebApp: { capable: true, title: "Indinite scanner", statusBarStyle: "black-translucent" },
  icons: { apple: "/scanner-icon-192.png" },
};

export const viewport: Viewport = { themeColor: "#0a0e1f", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return children;
}
