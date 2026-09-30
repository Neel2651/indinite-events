import type { Metadata } from "next";
import { cardFeeOf, merchantStatus, MERCHANT_STATUS_LABELS, resolvePaymentsMode } from "@indinite/core";
import { appUrl } from "@indinite/auth";
import { merchantSetupUrl, Organizer, refreshMerchantAccount, stripeConfigured, stripeConnectConfigured } from "@indinite/db";
import { PaymentsActions } from "@/components/staff/payments-actions";
import { PageHeader } from "@/components/staff/shell";
import { formatDayTime } from "@/lib/format";
import { asStaff, requireOrg, requireStaff } from "@/lib/staff";
import { connectMessage, connectOutcomeText } from "@/lib/stripe-connect";

export const metadata: Metadata = { title: "Payments" };

const EXPLAIN: Record<string, string> = {
  not_started: "Connect your business to Stripe, our payment provider, to take card payments online and through payment links. Ticket money is paid into your bank account by Stripe.",
  in_progress: "You've started setting up with Stripe but haven't finished. Continue where you left off.",
  pending_verification: "Stripe is checking your details. This usually takes a few minutes, occasionally a day or two. We'll email you when you can take card payments.",
  active: "You can take card payments. Stripe pays ticket money into your bank account.",
  restricted: "Stripe needs more information before you can keep taking card payments.",
  disconnected: "Your Stripe account was disconnected, so online bookings and payment links are off. Passes already sold still work. Set up payments again to start selling online.",
};

/** When the organiser's own Stripe account is connected. */
const OWN_EXPLAIN: Record<string, string> = {
  in_progress: "Your Stripe account is connected, but Stripe needs you to finish setting it up before you can take card payments. Finish it in your Stripe dashboard.",
  pending_verification: "Your Stripe account is connected. Stripe is checking your details; we'll email you when you can take card payments.",
  active: "Your own Stripe account is connected. Card payments go straight into it and show in your usual Stripe dashboard.",
  restricted: "Stripe needs more information on your Stripe account before you can keep taking card payments. Add it in your Stripe dashboard.",
};

const REQUIREMENT: Record<string, string> = {
  external_account: "Bank account for payouts",
  "tos_acceptance.date": "Accept Stripe's terms",
  "business_profile.url": "Business website",
  "business_profile.mcc": "Business category",
  "company.tax_id": "Company registration number",
};
const niceRequirement = (r: string) => REQUIREMENT[r] ?? (r.includes("verification.document") ? "Photo ID" : r.includes("address") ? "Address" : r.includes("dob") ? "Date of birth" : r.replace(/[._]/g, " "));

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ stripe?: string; setup?: string }> };

export default async function PaymentsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { stripe, setup } = await searchParams;
  // Signed-out owners opening a shared setup link come back here (not the dashboard) after signing in.
  await requireStaff(`/org/${slug}/payments${setup ? "?setup=1" : ""}`);
  const { user, organizer, can } = await requireOrg(slug);
  const configured = stripeConfigured();
  // Back from Stripe's form: check now rather than waiting for the webhook.
  if (stripe === "return" && configured) {
    await asStaff(user, () => refreshMerchantAccount(organizer.id, appUrl()), organizer.id).catch((e) => console.error("[payments] refresh failed", e instanceof Error ? e.message : e));
  }
  const org = (await Organizer.findById(organizer.id).lean())!;
  const status = merchantStatus(org);
  const demo = resolvePaymentsMode(process.env) === "demo";
  const fee = cardFeeOf(org);
  const feeRate = `${fee.bps / 100}%${fee.fixedPence ? ` + ${fee.fixedPence}p` : ""}`;
  const own = Boolean(org.stripeAccountId) && org.stripeAccountType === "standard";
  const outcome = connectOutcomeText(stripe, await connectMessage());

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
          {outcome && (
            <p
              role={outcome.tone === "error" ? "alert" : "status"}
              className={`rounded-md px-3 py-2 text-sm ${outcome.tone === "ok" ? "bg-success/10 text-success" : outcome.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted"}`}
            >
              {outcome.text}
            </p>
          )}
          <p className="text-muted-foreground">{(own ? OWN_EXPLAIN[status] : undefined) ?? EXPLAIN[status]}</p>
          <p className="text-sm text-muted-foreground">
            {own
              ? fee.payer === "customer"
                ? "Customers pay a card processing fee to cover Stripe's fee, which Stripe takes from your Stripe account at your usual rate. They also pay Indinite's platform fee on top of the ticket price."
                : "Stripe takes its card fee from your Stripe account at your usual Stripe rate. Customers pay Indinite's platform fee on top of the ticket price."
              : fee.payer === "organizer"
              ? `Stripe's card fee (${feeRate} per card payment) is deducted from your payout. Customers pay Indinite's platform fee on top of the ticket price.`
              : fee.payer === "customer"
                ? "Customers pay Stripe's card fee (as a \u201cCard processing fee\u201d) and Indinite's platform fee on top of the ticket price."
                : "Indinite pays Stripe's card fee. Customers pay Indinite's platform fee on top of the ticket price."}
          </p>
          {setup && status !== "active" && can("stripe.onboard") && (
            <p className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-sm">
              You&apos;ve been asked to set up payments for {organizer.name}. Use the button below to continue on Stripe&apos;s secure form. It takes about 10 minutes; have your bank details and photo ID ready.
            </p>
          )}
          {setup && !can("stripe.onboard") && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">Only the organiser&apos;s owner can set up payments. Ask them to open this link.</p>
          )}
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
            <PaymentsActions
              slug={slug}
              status={status}
              accountType={org.stripeAccountId ? (org.stripeAccountType ?? "express") : null}
              canManage={can("stripe.onboard")}
              setupUrl={merchantSetupUrl(appUrl(), slug)}
              connectAvailable={stripeConnectConfigured()}
            />
          )}
          <p className="text-xs text-muted-foreground">Bank details and ID are entered on Stripe&apos;s secure pages. Indinite never sees them.</p>
        </section>
        <aside className="h-fit space-y-2 rounded-lg border border-border bg-card p-6 text-sm">
          <h2 className="text-lg">Details</h2>
          {org.stripeAccountId && (
            <p>
              <span className="text-muted-foreground">Stripe account:</span> {own ? "your own, connected to Indinite" : "set up through Indinite"}
            </p>
          )}
          <p>
            <span className="text-muted-foreground">Card payments:</span> {org.chargesEnabled ? "On" : "Off"}
          </p>
          <p>
            <span className="text-muted-foreground">Payouts to your bank:</span> {org.payoutsEnabled ? "On" : "Off"}
          </p>
          <p>
            <span className="text-muted-foreground">Card fees paid by:</span> {fee.payer === "organizer" ? (own ? "you (taken by Stripe from your account)" : "you (deducted from payouts)") : fee.payer === "customer" ? "your customers (added to card bookings)" : "Indinite"}
          </p>
          {org.merchantSyncedAt && <p className="text-xs text-muted-foreground">Last checked with Stripe {formatDayTime(org.merchantSyncedAt)}</p>}
        </aside>
      </div>
    </>
  );
}
