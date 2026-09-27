import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ROLE_LABELS } from "@indinite/auth";
import { Organizer } from "@indinite/db";
import { SignOutButton } from "@/components/staff/nav";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choose organiser", robots: { index: false } };

export default async function ChooseOrganiserPage() {
  const user = await requireStaff("/org");
  const orgs = user.isSuperAdmin
    ? (await Organizer.find({ status: "active" }).sort({ name: 1 }).lean()).map((o) => ({ slug: o.slug, name: o.name, label: "Super admin" }))
    : user.organizers.map((o) => ({ slug: o.slug, name: o.name, label: ROLE_LABELS[o.role] }));
  if (!user.isSuperAdmin && orgs.length === 1) redirect(`/org/${orgs[0]!.slug}`);

  return (
    <section className="min-h-dvh bg-brand-cream">
      <div className="mx-auto max-w-lg px-5 py-14">
        <div className="card-brand space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl">Choose an organiser</h1>
              <p className="mt-1 text-muted-foreground">Signed in as {user.email}</p>
            </div>
            <div className="dark rounded-full bg-background">
              <SignOutButton />
            </div>
          </div>
          {orgs.length === 0 ? (
            <p className="text-muted-foreground">
              You&apos;re not part of any organiser yet. Ask an organiser&apos;s owner to invite you.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {orgs.map((o) => (
                <li key={o.slug}>
                  <Link href={`/org/${o.slug}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted">
                    <span className="font-display font-semibold">{o.name}</span>
                    <span className="text-sm text-muted-foreground">{o.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {user.isSuperAdmin && (
            <Link href="/admin" className="font-semibold text-brand-orange-strong hover:underline">
              Back to admin
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
