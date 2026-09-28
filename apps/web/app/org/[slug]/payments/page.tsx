import type { Metadata } from "next";
import { merchantStatus, MERCHANT_STATUS_LABELS, resolvePaymentsMode } from "@indinite/core";
import { appUrl } from "@indinite/auth";
import { Organizer, refreshMerchantAccount, stripeConfigured } from "@indinite/db";
import { PaymentsActions } from "@/components/staff/payments-actions";
import { PageHeader } from "@/components/staff/shell";
import { formatDayTime } from "@/lib/format";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Payments" };

const EXPLAIN: Record<string, string> = {
  not_started: "Connect your business to Stripe, our payment provider, to take card payments online and through payment links. Ticket money is paid into your bank account by Stripe.",
  in_progress: "You've started setting up with Stripe but haven't finished. Continue where you left off.",
  pending_verification: "Stripe is checking your details. This usually takes a few minutes, occasionally a day or two. We'll email you when you can take card payments.",
  active: "You can take card payments. Stripe pays ticket money (minus Indinite's platform fee) into your bank account.",
  restricted: "Stripe needs more information before you can keep taking card payments.",
};

const REQUIREMENT: Record<string, string> = {
  external_account: "Bank account for payouts",
  "tos_acceptance.date": "Accept Stripe's terms",
  "business_profile.url": "Business website",
  "business_profile.mcc": "Business category",
  "company.tax_id": "Company registration number",
};
const niceRequirement = (r: string) => REQUIREMENT[r] ?? (r.includes("verification.document") ? "Photo ID" : r.includes("address") ? "Address" : r.includes("dob") ? "Date of birth" : r.replace(/[._]/g, " "));

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ stripe?: string }> };

export default async function PaymentsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { stripe } = await searchParams;
  const { organizer, can } = await requireOrg(slug);
  const configured = stripeConfigured();
  // Back from Stripe's form: check now rather than waiting for the webhook.
  if (stripe === "return" && configured) await refreshMerchantAccount(organizer.id, appUrl()).catch(() => null);
  const org = (await Organizer.findById(organizer.id).lean())!;
  const status = merchantStatus(org);
  const demo = resolvePaymentsMode(process.env) === "demo";

  return (
    <>
      <PageHeader title="Payments" description="How you receive money for online bookings." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="space-y-5 rounded-lg border border-border bg-card p-6">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold tracking-widest ${
                status === "active" ? "bg-success/15 text-success" : status === "restricted" ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"
              }`}
            >
              {MERCHANT_STATUS_LABELS[status].toUpperCase()}
            </span>
            {org.onlineSalesPaused && <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold tracking-widest text-warning">ONLINE SALES PAUSED BY INDINITE</span>}
          </div>
          <p className="text-muted-foreground">{EXPLAIN[status]}</p>
          {stripe === "refresh" && <p className="rounded-md bg-muted px-3 py-2 text-sm">That Stripe link expired. Use the button below to open a new one.</p>}
          {status === "restricted" && (org.stripeCurrentlyDue?.length ?? 0) > 0 && (
            <div>
              <p className="font-semibold">Stripe still needs:</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                {[...new Set(org.stripeCurrentlyDue!.map(niceRequirement))].map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {!configured ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">Stripe isn&apos;t set up on this server yet{demo ? " (demo mode: card payments are simulated)" : ""}.</p>
          ) : (
            <PaymentsActions slug={slug} status={status} canManage={can("stripe.onboard")} />
          )}
          <p className="text-xs text-muted-foreground">Bank details and ID are entered on Stripe&apos;s secure pages. Indinite never sees them.</p>
        </section>
        <aside className="h-fit space-y-2 rounded-lg border border-border bg-card p-6 text-sm">
          <h2 className="text-lg">Details</h2>
          <p>
            <span className="text-muted-foreground">Card payments:</span> {org.chargesEnabled ? "On" : "Off"}
          </p>
          <p>
            <span className="text-muted-foreground">Payouts to your bank:</span> {org.payoutsEnabled ? "On" : "Off"}
          </p>
          <p>
            <span className="text-muted-foreground">Card fees paid by:</span> {org.cardFee?.payer === "organizer" ? "you (deducted from payouts)" : "Indinite"}
          </p>
          {org.merchantSyncedAt && <p className="text-xs text-muted-foreground">Last checked with Stripe {formatDayTime(org.merchantSyncedAt)}</p>}
        </aside>
      </div>
    </>
  );
}
