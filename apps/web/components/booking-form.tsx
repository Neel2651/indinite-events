"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import {
  pixelAddToCart,
  pixelCheckout,
  pixelPaymentInfo,
  pixelRemoveFromCart,
  priceOrder,
  receiptLines,
  type CardFeeSettings,
  type Discount,
  type OrderCharge,
} from "@indinite/core";
import { price } from "@/lib/format";
import { track, trackCustom } from "./meta-pixel";

export interface BookableTicketType {
  id: string;
  name: string;
  pricePence: number;
  available: number;
  maxPerOrder: number;
  nightsLabel: string;
  validSessionIds: string[];
  /** Day pass member: shown under its night as the group's name. */
  dayPassName: string | null;
  /** "Sold out", "Bookings closed", … when it can't be booked right now. */
  blocked: string | null;
}

interface Props {
  eventId: string;
  sessions: { id: string; label: string; dayLabel: string; timeLabel: string }[];
  ticketTypes: BookableTicketType[];
  pricing: { commissionBps: number; taxBps: number; charges: OrderCharge[]; cardFee: CardFeeSettings };
  paymentsMode: "stripe" | "demo";
}

const inputClass =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Step = 1 | 2;

/**
 * Booking (30 Sep 2026): 1 choose passes (any mix of nights: day passes per night, plus season / weekend passes)
 * → 2 details, coupon and pay. One order can hold Night 1 ×2, Night 2 ×1, Night 4 ×2 and a season pass.
 */
export function BookingForm({ eventId, sessions, ticketTypes, pricing, paymentsMode }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; rule: Discount } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One-night passes are listed under their night; passes for several nights once, below.
  const byNight = useMemo(
    () => sessions.map((s) => ({ night: s, types: ticketTypes.filter((t) => t.validSessionIds.length === 1 && t.validSessionIds[0] === s.id) })).filter((n) => n.types.length > 0),
    [sessions, ticketTypes],
  );
  const multiNight = useMemo(() => ticketTypes.filter((t) => t.validSessionIds.length > 1), [ticketTypes]);
  const chosen = ticketTypes.filter((t) => (qty[t.id] ?? 0) > 0);
  const count = chosen.reduce((n, t) => n + qty[t.id]!, 0);

  const breakdown = useMemo(() => {
    if (!count) return null;
    const items = chosen.map((t) => ({ ticketTypeId: t.id, name: t.name, unitPricePence: t.pricePence, qty: qty[t.id]! }));
    const p = priceOrder({ items, ...pricing, discount: coupon?.rule });
    return {
      total: p.totalPence,
      couponProblem: p.discountIneligible,
      lines: receiptLines({
        items: items.map((i) => ({ name: i.name, qty: i.qty, unitPricePence: i.unitPricePence })),
        discountPence: p.discountPence,
        discountLabel: coupon ? `Code ${coupon.code}` : undefined,
        platformFeePence: p.platformFeePence,
        commissionBps: pricing.commissionBps,
        charges: p.charges,
        taxPence: p.taxPence,
        taxBps: pricing.taxBps,
        cardFeePence: p.cardFeePence,
      }),
    };
  }, [chosen, qty, pricing, coupon, count]);


  async function applyCoupon() {
    setChecking(true);
    setCouponMsg(null);
    const res = await fetch("/api/coupons/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId, code: couponInput }) });
    const data = (await res.json().catch(() => ({}))) as { code?: string; rule?: Discount; error?: string };
    setChecking(false);
    if (res.ok && data.code && data.rule) setCoupon({ code: data.code, rule: data.rule });
    else {
      setCoupon(null);
      setCouponMsg(data.error ?? "That code isn't valid.");
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const phone = String(form.get("phone") ?? "").trim();
    track("AddPaymentInfo", pixelPaymentInfo(breakdown?.total ?? 0));
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          items: chosen.map((t) => ({ ticketTypeId: t.id, qty: qty[t.id]! })),
          couponCode: coupon?.code,
          customer: { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), ...(phone ? { phone } : {}) },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { redirectUrl?: string; error?: string };
      if (!res.ok || !data.redirectUrl) throw new Error(data.error ?? "Something went wrong. Please try again.");
      router.push(data.redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }


  const limit = (t: BookableTicketType) => (t.blocked ? 0 : Math.min(t.maxPerOrder, t.available));
  const setFor = (t: BookableTicketType, n: number) => setQty((q) => ({ ...q, [t.id]: Math.max(0, Math.min(limit(t), n)) }));

  // Meta pixel (SPEC §4.11): every "+" and "−" press, with the night and the pass's price. No-ops without a pixel.
  const add = (t: BookableTicketType, n: number, pixelName: string) => {
    setFor(t, n + 1);
    track("AddToCart", pixelAddToCart({ ticketTypeId: t.id, name: pixelName, unitPricePence: t.pricePence }));
  };
  const remove = (t: BookableTicketType, n: number) => {
    setFor(t, n - 1);
    trackCustom("RemoveFromCart", pixelRemoveFromCart({ ticketTypeId: t.id, unitPricePence: t.pricePence }));
  };
  const toDetails = () => {
    setStep(2);
    track("InitiateCheckout", pixelCheckout(chosen.map((t) => ({ ticketTypeId: t.id, qty: qty[t.id]! })), breakdown?.total ?? 0));
  };

  const row = (t: BookableTicketType, label: string, sub: string, pixelName: string) => {
    const n = qty[t.id] ?? 0;
    return (
      <li key={t.id} className="flex items-start justify-between gap-4 py-3">
        <div>
          <p className="font-display font-semibold">{label}</p>
          <p className="text-sm text-muted-foreground">
            {sub}
            {sub ? " · " : ""}
            {price(t.pricePence)}
            {t.blocked ? <span className="font-semibold text-foreground"> · {t.blocked}</span> : t.available <= 20 ? ` · ${t.available} left` : ""}
          </p>
        </div>
        {!t.blocked && (
          <div className="flex shrink-0 items-center gap-2" role="group" aria-label={`Number of ${t.name} passes`}>
            <button type="button" onClick={() => remove(t, n)} disabled={n === 0} aria-label={`Remove one ${t.name}`} className="size-10 rounded-full border border-border font-bold disabled:opacity-40">
              −
            </button>
            <span className="w-6 text-center font-display font-semibold tabular-nums" aria-live="polite">
              {n}
            </span>
            <button type="button" onClick={() => add(t, n, pixelName)} disabled={n >= limit(t)} aria-label={`Add one ${t.name}`} className="size-10 rounded-full border border-border font-bold disabled:opacity-40">
              +
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* 1. Passes */}
      <section className="space-y-3">
        <StepHeader step={step} n={1} title="Choose passes" done={count ? `${count} ${count === 1 ? "pass" : "passes"}` : undefined} onEdit={() => setStep(1)} />
        {step === 1 && (
          <>
            {byNight.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Pick as many nights as you like. Each pass is for the night shown.</p>
                {byNight.map(({ night, types }) => {
                  const closed = types.every((t) => t.blocked);
                  const picked = types.reduce((n, t) => n + (qty[t.id] ?? 0), 0);
                  return (
                    <div key={night.id} className={`rounded-md border px-3 ${picked ? "border-brand-orange" : "border-border"}`}>
                      <div className="flex items-baseline justify-between gap-3 pt-3">
                        <p>
                          <span className="font-display font-semibold">{night.label}</span>
                          <span className="ml-2 text-sm text-muted-foreground">
                            {night.dayLabel} · {night.timeLabel}
                          </span>
                        </p>
                        {closed && <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">{types[0]!.blocked}</span>}
                      </div>
                      {!closed && <ul className="divide-y divide-border">{types.map((t) => row(t, t.dayPassName ?? t.name, "", types.length > 1 ? `${night.label} – ${night.dayLabel} · ${t.dayPassName ?? t.name}` : `${night.label} – ${night.dayLabel}`))}</ul>}
                      {closed && <div className="pb-3" />}
                    </div>
                  );
                })}
              </div>
            )}
            {multiNight.length > 0 && (
              <div className="space-y-1 pt-2">
                {byNight.length > 0 && <p className="font-display font-semibold">Passes for more than one night</p>}
                <ul className="divide-y divide-border">{multiNight.map((t) => row(t, t.name, t.nightsLabel, t.name))}</ul>
              </div>
            )}
            <button type="button" disabled={count === 0} onClick={toDetails} className="btn-cta w-full disabled:opacity-60">
              {count ? `Continue with ${count} ${count === 1 ? "pass" : "passes"}` : "Choose at least one pass"}
            </button>
          </>
        )}
      </section>

      {/* 2. Details, coupon, pay */}
      <section className="space-y-4 border-t border-border pt-4">
        <StepHeader step={step} n={2} title="Your details and payment" />
        {step === 2 && (
          <>
            <label className="block text-sm">
              Full name
              <input name="name" required maxLength={120} autoComplete="name" className={inputClass} />
            </label>
            <label className="block text-sm">
              Email
              <input name="email" type="email" required autoComplete="email" className={inputClass} />
              <span className="mt-1 block text-xs text-muted-foreground">We&apos;ll send your passes here.</span>
            </label>
            <label className="block text-sm">
              Phone (optional)
              <input name="phone" type="tel" maxLength={30} autoComplete="tel" className={inputClass} />
            </label>

            <div>
              <label className="block text-sm" htmlFor="coupon">
                Coupon code
              </label>
              <div className="mt-1 flex gap-2">
                <input id="coupon" value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} autoCapitalize="characters" className={`${inputClass} mt-0 uppercase`} />
                <button type="button" onClick={applyCoupon} data-pixel-button="apply_coupon" disabled={!couponInput.trim() || checking} className="shrink-0 rounded-full border border-border px-4 text-sm font-semibold disabled:opacity-50">
                  {checking ? "Checking…" : "Apply"}
                </button>
              </div>
              {coupon && breakdown?.couponProblem && (
                <p className="mt-1 text-xs text-destructive">
                  {breakdown.couponProblem}{" "}
                  <button type="button" onClick={() => setCoupon(null)} className="underline">
                    Remove code
                  </button>
                </p>
              )}
              {coupon && !breakdown?.couponProblem && (
                <p className="mt-1 text-xs text-success">
                  {coupon.code} applied{" "}
                  <button type="button" onClick={() => setCoupon(null)} className="underline">
                    Remove
                  </button>
                </p>
              )}
              {couponMsg && <p className="mt-1 text-xs text-destructive">{couponMsg}</p>}
            </div>

            {breakdown && (
              <dl className="space-y-1 rounded-md bg-muted p-4 text-sm">
                {breakdown.lines.map((l) => (
                  <div key={l.label} className={`flex justify-between ${l.negative ? "text-success" : ""}`}>
                    <dt>{l.label}</dt>
                    <dd>
                      {l.negative ? "−" : ""}
                      {price(l.amountPence)}
                    </dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-2 font-display text-lg font-bold">
                  <dt>Total</dt>
                  <dd>{price(breakdown.total)}</dd>
                </div>
              </dl>
            )}

            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting || !count || Boolean(breakdown?.couponProblem)} className="btn-cta w-full disabled:opacity-60">
              {submitting ? "Booking…" : paymentsMode === "demo" ? `Confirm booking · ${price(breakdown?.total ?? 0)}` : `Pay ${price(breakdown?.total ?? 0)}`}
            </button>
            {paymentsMode === "demo" && <p className="text-center text-xs text-muted-foreground">Demo mode: no payment is taken and your booking is approved straight away.</p>}
            <p className="text-center text-xs text-muted-foreground">
              By booking you agree to our{" "}
              <a href="/booking-terms" target="_blank" data-pixel-button="booking_terms" className="font-semibold underline">
                booking terms
              </a>
              . See how we use your data in our{" "}
              <a href="/privacy" target="_blank" data-pixel-button="privacy_policy" className="font-semibold underline">
                privacy policy
              </a>
              .
            </p>
          </>
        )}
      </section>
    </form>
  );
}

/** Heading for each booking step, with a "Change" link once it's done. */
function StepHeader({ step, n, title, done, onEdit }: { step: Step; n: Step; title: string; done?: string; onEdit?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className={`font-display font-semibold ${step === n ? "" : "text-muted-foreground"}`}>
        <span className={`mr-2 inline-flex size-6 items-center justify-center rounded-full text-xs ${step >= n ? "bg-brand-orange text-white" : "bg-muted"}`}>{n}</span>
        {title}
      </p>
      {done && step > n && (
        <button type="button" onClick={onEdit} data-pixel-button="change_passes" className="text-right text-sm">
          <span className="text-muted-foreground">{done}</span> <span className="font-semibold text-brand-orange-strong">Change</span>
        </button>
      )}
    </div>
  );
}
