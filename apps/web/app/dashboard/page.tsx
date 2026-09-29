import { redirect } from "next/navigation";
import { appMetadata, appViewport } from "@/lib/app-meta";
import { homeFor, requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";
export const metadata = appMetadata;
export const viewport = appViewport;

/** App home-screen shortcuts ("New booking", "Orders") land here with ?go=; only these pages are allowed. */
const SHORTCUTS = new Set(["orders", "bookings/new", "checkins"]);

/** Post-sign-in landing (and the installed app's start page): send each user to their home. */
export default async function DashboardRedirect({ searchParams }: { searchParams: Promise<{ go?: string }> }) {
  const { go } = await searchParams;
  const user = await requireStaff(go && SHORTCUTS.has(go) ? `/dashboard?go=${encodeURIComponent(go)}` : "/dashboard");
  const home = homeFor(user);
  redirect(go && SHORTCUTS.has(go) && home.startsWith("/org/") ? `${home}/${go}` : home);
}
