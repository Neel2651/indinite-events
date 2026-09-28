"use client";

import { useState, useTransition, type FormEvent } from "react";
import { priceOrder, receiptLines, type CardFeeSettings, type Discount, type OrderCharge } from "@indinite/core";
import {
  checkCouponAction,
  createPaymentLinkAction,
  issueOfflineAction,
  type OfflineResult,
  type PaymentLinkResult,
} from "@/app/org/[slug]/bookings/new/actions";
import { price } from "@/lib/format";
import { FormError, inputClass } from "./ui";

export interface BookableEvent {
  id: string;
  title: string;
  commissionBps: number;
  taxBps: number;
  charges: OrderCharge[];
  /** Applies to payment links only (card payments). */
  cardFee: CardFeeSettings;
  /** Complimentary passes free of commission for this event, and how many are left. */
  freeComplimentaryPasses: number;
  freeComplimentaryLeft: number;
  ticketTypes: { id: string; name: string; pricePence: number; available: number; nightsLabel: string }[];
}

const METHODS = [
  { value: "cash", label: "Cash", help: "Customer paid you in cash" },
  { value: "bank_transfer", label: "Organiser's account", help: "Paid into your bank account" },
  { value: "complimentary", label: "Complimentary", help: "Free: guests, sponsors, volunteers" },
  { value: "payment_link", label: "Generate payment link", help: "Email the customer a link to pay by card" },
] as const;
type Method = (typeof METHODS)[number]["value"];

const SUBMIT: Record<Method, string> = {
  cash: "Issue passes · paid in cash",
  bank_transfer: "Issue passes · paid to our account",
  complimentary: "Issue free passes",
  payment_link: "Create and email payment link",
};

export function OfflineBookingForm({
  slug,
  events,
  canPaymentLink,
  canOffline,
  discountLimitBps = 0,
}: {
  slug: string;
  events: BookableEvent[];
  canPaymentLink: boolean;
  canOffline: boolean;
  /** Most this user may discount a payment link (bps of the ticket subtotal); 0 = not allowed. */
  discountLimitBps?: number;
}) {
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [qty, setQty] = useState<Record<string, number>>({});
  const methods = METHODS.filter((m) => (m.value === "payment_link" ? canPaymentLink : canOffline));
  const [method, setMethod] = useState<Method>(methods[0]?.value ?? "cash");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; rule: Discount } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const [staffKind, setStaffKind] = useState<"percent" | "fixed">("percent");
  const [staffAmount, setStaffAmount] = useState("");
  const [staffReason, setStaffReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Extract<OfflineResult, { ok: true }> | null>(null);
  const [link, setLink] = useState<Extract<PaymentLinkResult, { ok: true }> | null>(null);
  const [pending, start] = useTransition();

  const event = events.find((e) => e.id === eventId);
  const items = (event?.ticketTypes ?? []).filter((t) => (qty[t.id] ?? 0) > 0);
  const count = items.reduce((n, t) => n + (qty[t.id] ?? 0), 0);
  const complimentary = method === "complimentary";
  const canStaffDiscount = method === "payment_link" && discountLimitBps > 0 && !coupon;
  const staffValue = Math.round(Number(staffAmount.replace(/[£%,\s]/g, "")) * 100);
  const staffDiscount: Discount | undefined = canStaffDiscount && staffAmount.trim() && Number.isFinite(staffValue) && staffValue > 0 ? { kind: staffKind, value: staffValue } : undefined;
  const preview =
    event && count > 0
      ? priceOrder({
          items: items.map((t) => ({ ticketTypeId: t.id, name: t.name, unitPricePence: t.pricePence, qty: qty[t.id]! })),
          commissionBps: event.commissionBps,
          taxBps: event.taxBps,
          charges: event.charges,
          discount: complimentary ? undefined : (coupon?.rule ?? staffDiscount),
          complimentary,
          complimentaryFreeLeft: complimentary ? event.freeComplimentaryLeft : undefined,
          cardFee: method === "payment_link" ? event.cardFee : undefined,
        })
      : null;
  const lines = preview
    ? receiptLines({
        items: items.map((t) => ({ name: t.name, qty: qty[t.id]!, unitPricePence: t.pricePence })),
        discountPence: preview.discountPence,
        discountLabel: coupon ? `Code ${coupon.code}` : staffDiscount ? staffReason.trim() || "Discount" : undefined,
        complimentary,
        platformFeePence: preview.platformFeePence,
        commissionBps: event!.commissionBps,
        charges: preview.charges,
        taxPence: preview.taxPence,
        taxBps: event!.taxBps,
        cardFeePence: preview.cardFeePence,
      })
    : [];

  const setFor = (id: string, n: number, max: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(max, 50, n)) }));
  const reset = () => {
    setIssued(null);
    setLink(null);
    setQty({});
    setCoupon(null);
    setCouponInput("");
  };

  function applyCoupon() {
    setCouponMsg(null);
    start(async () => {
      const res = await checkCouponAction(slug, eventId, couponInput);
      if (res.ok) setCoupon({ code: res.code, rule: res.rule });
      else {
        setCoupon(null);
        setCouponMsg(res.error);
      }
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (count === 0) return setError("Choose at least one pass.");
    const form = new FormData(e.currentTarget);
    const phone = String(form.get("phone") ?? "").trim();
    const customer = { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), ...(phone ? { phone } : {}) };
    const payloadItems = items.map((t) => ({ ticketTypeId: t.id, qty: qty[t.id]! }));
    setError(null);
    start(async () => {
      if (method === "payment_link") {
        const discount = staffDiscount ? { ...staffDiscount, ...(staffReason.trim() ? { reason: staffReason.trim() } : {}) } : undefined;
        const res = await createPaymentLinkAction(slug, { eventId, customer, items: payloadItems, couponCode: coupon?.code, discount, validForHours: hours });
        if (res.ok) setLink(res);
        else setError(res.error);
        return;
      }
      const res = await issueOfflineAction(slug, { eventId, customer, items: payloadItems, method, note: String(form.get("note") ?? ""), couponCode: complimentary ? undefined : coupon?.code });
      if (res.ok) setIssued(res);
      else setError(res.error);
    });
  }

  if (issued || link) {
    return (
      <div className="space-y-5" role="status">
        <div className="rounded-lg border border-success/30 bg-success/10 p-5">
          <p className="font-display text-xl font-semibold">{issued ? "Booking issued" : "Payment link sent"}</p>
          {issued ? (
            <>
              <p className="mt-1 text-muted-foreground">
                {issued.passes} {issued.passes === 1 ? "pass" : "passes"} · {price(issued.totalPence)} · order <strong className="text-foreground">{issued.publicId}</strong>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">We&apos;re emailing the passes to {issued.email}.</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-muted-foreground">
                {price(link!.totalPence)} · order <strong className="text-foreground">{link!.publicId}</strong> · emailed to {link!.email}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Passes are held until {new Date(link!.expiresAt).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. You can also copy the link:</p>
              <div className="mt-2 flex gap-2">
                <input readOnly value={link!.url} className={`${inputClass} mt-0 text-xs`} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" onClick={() => navigator.clipboard?.writeText(link!.url)} className="shrink-0 rounded-full border border-border px-4 text-sm font-semibold">
                  Copy link
                </button>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          {issued && (
            <a href={issued.viewUrl} target="_blank" rel="noopener noreferrer" className="btn-cta">
              Show passes now
            </a>
          )}
          <button type="button" onClick={reset} className="rounded-full border border-border px-6 py-3 font-display font-bold">
            New booking
          </button>
        </div>
      </div>
    );
  }

  if (!events.length) return <p className="text-muted-foreground">There are no published events to book yet.</p>;

  return (
    <form onSubmit={onSubmit} className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <label className="block text-sm">
          Event
          <select
            value={eventId}
            onChange={(e) => {
              setEventId(e.target.value);
              setQty({});
              setCoupon(null);
            }}
            className={inputClass}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="font-display font-semibold">Passes</legend>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {event?.ticketTypes.map((t) => {
              const n = qty[t.id] ?? 0;
              return (
                <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.nightsLabel} · {price(t.pricePence)} · {t.available} left
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label={`Remove one ${t.name}`} disabled={n === 0} onClick={() => setFor(t.id, n - 1, t.available)} className="size-9 rounded-full border border-border font-bold disabled:opacity-40">
                      −
                    </button>
                    <span className="w-6 text-center font-display font-semibold tabular-nums">{n}</span>
                    <button type="button" aria-label={`Add one ${t.name}`} disabled={n >= t.available} onClick={() => setFor(t.id, n + 1, t.available)} className="size-9 rounded-full border border-border font-bold disabled:opacity-40">
                      +
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 font-display font-semibold">Customer</legend>
          <label className="block text-sm">
            Full name
            <input name="name" required maxLength={120} className={inputClass} />
          </label>
          <label className="block text-sm">
            Email
            <input name="email" type="email" required className={inputClass} />
          </label>
          <label className="block text-sm">
            Phone (optional)
            <input name="phone" type="tel" maxLength={30} className={inputClass} />
          </label>
        </fieldset>
      </div>

      <aside className="h-fit space-y-5 rounded-lg border border-border bg-muted/50 p-5">
        <fieldset>
          <legend className="font-display font-semibold">Payment</legend>
          <div className="mt-2 space-y-2">
            {methods.map((m) => (
              <label key={m.value} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${method === m.value ? "border-brand-orange bg-background" : "border-border"}`}>
                <input type="radio" name="method" value={m.value} checked={method === m.value} onChange={() => setMethod(m.value)} className="mt-1 accent-[var(--brand-orange)]" />
                <span>
                  <span className="block font-semibold">{m.label}</span>
                  <span className="block text-xs text-muted-foreground">{m.help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {!complimentary && (
          <div>
            <label className="block text-sm" htmlFor="coupon">
              Coupon code (optional)
            </label>
            <div className="mt-1 flex gap-2">
              <input id="coupon" value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} className={`${inputClass} mt-0 uppercase`} />
              <button type="button" disabled={!couponInput.trim() || pending} onClick={applyCoupon} className="shrink-0 rounded-full border border-border bg-background px-4 text-sm font-semibold disabled:opacity-50">
                Apply
              </button>
            </div>
            {coupon && preview?.discountIneligible && <p className="mt-1 text-xs text-destructive">{preview.discountIneligible}</p>}
            {coupon && !preview?.discountIneligible && <p className="mt-1 text-xs text-success">{coupon.code} applied</p>}
            {couponMsg && <p className="mt-1 text-xs text-destructive">{couponMsg}</p>}
          </div>
        )}

        {canStaffDiscount && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Discount (optional)</legend>
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="staff-discount-kind">
                Discount type
              </label>
              <select id="staff-discount-kind" value={staffKind} onChange={(e) => setStaffKind(e.target.value as "percent" | "fixed")} className={`${inputClass} mt-0 w-28`}>
                <option value="percent">% off</option>
                <option value="fixed">£ off</option>
              </select>
              <label className="sr-only" htmlFor="staff-discount-amount">
                Discount amount
              </label>
              <input id="staff-discount-amount" value={staffAmount} onChange={(e) => setStaffAmount(e.target.value)} inputMode="decimal" placeholder={staffKind === "percent" ? "10" : "5.00"} className={`${inputClass} mt-0`} />
            </div>
            <label className="block text-sm">
              Reason
              <input value={staffReason} onChange={(e) => setStaffReason(e.target.value)} maxLength={200} className={inputClass} placeholder="e.g. Group of 10" />
            </label>
            <p className="text-xs text-muted-foreground">
              Comes off the ticket price. {discountLimitBps >= 10000 ? "No limit for your role." : `You can give up to ${(discountLimitBps / 100).toFixed(2).replace(/\.?0+$/, "")}% off.`}
            </p>
          </fieldset>
        )}

        {complimentary && event && (
          <p className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
            {event.freeComplimentaryLeft} of {event.freeComplimentaryPasses} free complimentary passes left for this event. Extra passes owe Indinite the platform fee on their normal price.
          </p>
        )}

        {method === "payment_link" ? (
          <label className="block text-sm">
            Link valid for
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={inputClass}>
              {[1, 2, 6, 12, 24].map((h) => (
                <option key={h} value={h}>
                  {h} {h === 1 ? "hour" : "hours"}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block text-sm">
            Note (required)
            <textarea name="note" required minLength={3} maxLength={500} rows={2} className={inputClass} placeholder={complimentary ? "e.g. Sponsor guest list" : "e.g. Paid at the door, receipt 0142"} />
          </label>
        )}

        <dl className="space-y-1 border-t border-border pt-4 text-sm">
          {lines.map((l) => (
            <div key={l.label} className={`flex justify-between ${l.negative ? "text-muted-foreground" : ""}`}>
              <dt>{l.label}</dt>
              <dd>
                {l.negative ? "−" : ""}
                {price(l.amountPence)}
              </dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between pt-1">
            <dt className="text-muted-foreground">
              {count} {count === 1 ? "pass" : "passes"}
            </dt>
            <dd className="font-display text-2xl font-bold">{price(preview?.totalPence ?? 0)}</dd>
          </div>
          {preview && method !== "payment_link" && preview.commissionPence > 0 && (
            <p className="text-xs text-muted-foreground">You&apos;ll owe Indinite {price(preview.commissionPence)} commission on this booking.</p>
          )}
        </dl>

        <FormError message={error} />
        <button type="submit" disabled={pending || count === 0} className="btn-cta w-full disabled:opacity-60">
          {pending ? "Working…" : SUBMIT[method]}
        </button>
      </aside>
    </form>
  );
}
