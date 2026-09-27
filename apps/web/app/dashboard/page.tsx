import { redirect } from "next/navigation";
import { homeFor, requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** Post-sign-in landing: send each user to their home. */
export default async function DashboardRedirect() {
  redirect(homeFor(await requireStaff()));
}
