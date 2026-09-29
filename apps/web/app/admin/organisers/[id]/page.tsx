import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { appUrl } from "@indinite/auth";
import { merchantStatus, MERCHANT_STATUS_LABELS } from "@indinite/core";
import { merchantSetupUrl, Organizer, refreshMerchantAccount, stripeConfigured } from "@indinite/db";
import { AdminOnboardingActions, CardFeeForm, OrganizerDetailsForm, SalesPausedForm } from "@/components/staff/admin-merchant-forms";
import { PageHeader } from "@/components/staff/shell";
import { formatDayTime } from "@/lib/format";
import { asStaff, requireSuperAdmin } from "@/lib/staff";

export const metadata: Metadata = { title: "Organiser" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ stripe?: string }> };

export default async function AdminOrganiserPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { stripe } = await searchParams;
  if (!Types.ObjectId.isValid(id)) notFound();
  const configured = stripeConfigured();
  // Back from Stripe's form: check now rather than waiting for the webhook.
  if (stripe === "return" && configured) {
    const user = await requireSuperAdmin();
    await asStaff(user, () => refreshMerchantAccount(id, appUrl()), id).catch((e) => console.error("[admin payments] refresh failed", e instanceof Error ? e.message : e));
  }
  const org = await Organizer.findById(id).lean();
  if (!org) notFound();
  const status = merchantStatus(org);

  return (
    <>
      <PageHeader
        title={org.name}
        description={`${org.slug} · ${org.contactEmail}`}
        actions={
          <div className="flex gap-3 text-sm">
            <Link href={`/org/${org.slug}`} className="font-semibold text-brand-orange-strong hover:underline">Open panel</Link>
            <Link href={`/org/${org.slug}/payments`} className="font-semibold text-brand-orange-strong hover:underline">Payments page</Link>
            <Link href="/admin/organisers" className="font-semibold text-brand-orange-strong hover:underline">All organisers</Link>
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg">Payments (Stripe)</h2>
          <p>
            <span className="font-semibold">{MERCHANT_STATUS_LABELS[status]}</span>
            {org.onlineSalesPaused && <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">Online sales paused</span>}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Stripe account</dt>
            <dd>{org.stripeAccountId ?? "Not created yet"}</dd>
            <dt className="text-muted-foreground">Card payments</dt>
            <dd>{org.chargesEnabled ? "On" : "Off"}</dd>
            <dt className="text-muted-foreground">Payouts</dt>
            <dd>{org.payoutsEnabled ? "On" : "Off"}</dd>
            <dt className="text-muted-foreground">Prefilled as</dt>
            <dd>{org.merchantPrefill?.legalName ? `${org.merchantPrefill.legalName} (${org.merchantPrefill.businessType})` : "—"}</dd>
            {org.merchantSyncedAt && (
              <>
                <dt className="text-muted-foreground">Last Stripe update</dt>
                <dd>{formatDayTime(org.merchantSyncedAt)}</dd>
              </>
            )}
          </dl>
          {stripe === "refresh" && <p className="rounded-md bg-muted px-3 py-2 text-sm">That Stripe link expired. Use the button below to open a new one.</p>}
          {stripe === "return" && <p className="rounded-md bg-muted px-3 py-2 text-sm">Back from Stripe. The status above is up to date.</p>}
          <AdminOnboardingActions organizerId={id} status={status} stripeReady={configured} setupUrl={merchantSetupUrl(appUrl(), org.slug)} />
        </section>
        <section className="space-y-6 rounded-lg border border-border bg-card p-6">
          <div>
            <h2 className="mb-3 text-lg">{org.onlineSalesPaused ? "Resume online sales" : "Pause online sales"}</h2>
            <p className="mb-3 text-sm text-muted-foreground">Stops card checkout and payment links for this organiser. Cash, organiser&apos;s account and complimentary bookings still work.</p>
            <SalesPausedForm organizerId={id} paused={!!org.onlineSalesPaused} />
          </div>
          <div className="border-t border-border pt-6">
            <h2 className="mb-3 text-lg">Card fees</h2>
            <CardFeeForm organizerId={id} payer={org.cardFee?.payer ?? "platform"} percent={(org.cardFee?.bps ?? 150) / 100} fixed={(org.cardFee?.fixedPence ?? 20) / 100} />
          </div>
        </section>
      </div>
      <section className="mt-6 rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg">Organiser details</h2>
        <OrganizerDetailsForm
          organizerId={id}
          name={org.name}
          contactEmail={org.contactEmail}
          orderPrefix={org.orderPrefix ?? "NAV"}
          status={org.status ?? "active"}
          maxDiscountPercent={(org.maxDiscountBpsForManager ?? 5000) / 100}
        />
      </section>
    </>
  );
}
