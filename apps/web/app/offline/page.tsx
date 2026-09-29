import type { Metadata } from "next";
import { appMetadata, appViewport } from "@/lib/app-meta";

export const dynamic = "force-static";
export const metadata: Metadata = { ...appMetadata, title: "You're offline" };
export const viewport = appViewport;

/** Shown by the service worker when an organiser screen is opened with no connection. */
export default function OfflinePage() {
  return (
    <main className="dark flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center text-foreground">
      <img src="/brand/indinite-mark.png" alt="" width={56} height={48} className="h-12 w-auto" />
      <h1 className="mt-6 text-3xl">You&apos;re offline</h1>
      <p className="mt-3 max-w-sm text-muted-foreground">Bookings, orders and check-ins need a connection. The gate scanner still works without signal.</p>
      <div className="mt-8 flex flex-col gap-3">
        <a href="/scan" className="btn-cta">
          Open scanner
        </a>
        <a href="/dashboard" className="rounded-full border border-white/20 px-6 py-3 font-semibold">
          Try again
        </a>
      </div>
    </main>
  );
}
