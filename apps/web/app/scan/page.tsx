import { redirect } from "next/navigation";
import { can } from "@indinite/core";
import { ScannerApp } from "@/components/scanner/scanner-app";
import { RegisterScannerSW } from "@/components/scanner/register-sw";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** SPEC §4.5 gate scanner (installable PWA, works offline once passes are downloaded). */
export default async function ScanPage() {
  const user = await requireStaff("/scan");
  const allowed = user.isSuperAdmin || user.memberships.some((m) => can(user, "scan.perform", { organizerId: m.organizerId }));
  if (!allowed) redirect("/dashboard");
  return (
    <>
      <RegisterScannerSW />
      <ScannerApp />
    </>
  );
}
