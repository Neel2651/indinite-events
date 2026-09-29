import type { Metadata, Viewport } from "next";

/**
 * The installable staff app ("Indinite for organisers"): one manifest for the organiser panel, admin and the
 * gate scanner. Opening it goes to /dashboard, which sends each role to its home (lib/staff.ts homeFor).
 */
export const appMetadata: Metadata = {
  manifest: "/app.webmanifest",
  robots: { index: false },
  appleWebApp: { capable: true, title: "Indinite", statusBarStyle: "black-translucent" },
  icons: { apple: "/app-apple-icon.png" },
  formatDetection: { telephone: false },
};

export const appViewport: Viewport = { themeColor: "#0a0e1f", width: "device-width", initialScale: 1, viewportFit: "cover" };
