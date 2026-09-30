import type { Metadata, Viewport } from "next";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/800.css";
import "@fontsource-variable/inter";
import "./globals.css";
import { Suspense } from "react";
import { NavigationProgress } from "@/components/navigation-progress";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3001"),
  title: { default: "Indinite Events", template: "%s | Indinite Events" },
  description: "Book passes for Navratri garba nights and other events across the UK.",
  ...(process.env.DEPLOY_ENV === "staging" ? { robots: { index: false, follow: false } } : {}),
};

export const viewport: Viewport = { themeColor: "#0a0e1f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh flex flex-col">
        {/* useSearchParams needs a Suspense boundary; the bar is purely visual, so no fallback. */}
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
