"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { priceOrder, receiptLines, type CardFeeSettings, type Discount, type OrderCharge } from "@indinite/core";
import { price } from "@/lib/format";

export interface BookableTicketType {
  id: string;
  name: string;
  pricePence: number;
  available: number;
  maxPerOrder: number;
  nightsLabel: string;
  validSessionIds: string[];
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

type Step = 1 | 2 | 3;

/** Advance booking: 1 choose a day → 2 choose passes valid that day → 3 details, coupon and pay. */
export function BookingForm({ eventId, sessions, ticketTypes, pricing, paymentsMode }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; rule: Discount } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const session = sessions.find((s) => s.id === sessionId);
  const forDay = useMemo(() => ticketTypes.filter((t) => sessionId && t.validSessionIds.includes(sessionId)), [ticketTypes, sessionId]);
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

  const limit = (t: BookableTicketType) => Math.min(t.maxPerOrder, t.available);
  const setFor = (t: BookableTicketType, n: number) => setQty((q) => ({ ...q, [t.id]: Math.max(0, Math.min(limit(t), n)) }));

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

  const StepHeader = ({ n, title, done, onEdit }: { n: Step; title: string; done?: string; onEdit?: () => void }) => (
    <div className="flex items-center justify-between gap-3">
      <p className={`font-display font-semibold ${step === n ? "" : "text-muted-foreground"}`}>
        <span className={`mr-2 inline-flex size-6 items-center justify-center rounded-full text-xs ${step >= n ? "bg-brand-orange text-white" : "bg-muted"}`}>{n}</span>
        {title}
      </p>
      {done && step > n && (
        <button type="button" onClick={onEdit} className="text-right text-sm">
          <span className="text-muted-foreground">{done}</span> <span className="font-semibold text-brand-orange-strong">Change</span>
        </button>
      )}
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* 1. Day */}
      <section className="space-y-3">
        <StepHeader n={1} title="Choose a day" done={session ? `${session.label} · ${session.dayLabel}` : undefined} onEdit={() => setStep(1)} />
        {step === 1 && (
          <ul className="grid grid-cols-2 gap-2">
            {sessions.map((s) => {
              const any = ticketTypes.some((t) => t.validSessionIds.includes(s.id) && t.available > 0);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={!any}
                    onClick={() => {
                      setSessionId(s.id);
                      setQty((q) => Object.fromEntries(Object.entries(q).filter(([id]) => ticketTypes.find((t) => t.id === id)?.validSessionIds.includes(s.id))));
                      setStep(2);
                    }}
                    className={`w-full rounded-md border px-3 py-2.5 text-left disabled:opacity-40 ${sessionId === s.id ? "border-brand-orange bg-brand-cream" : "border-border hover:border-brand-orange"}`}
                  >
                    <span className="block font-display font-semibold">{s.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s.dayLabel} · {s.timeLabel}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 2. Passes */}
      <section className="space-y-3 border-t border-border pt-4">
        <StepHeader n={2} title="Choose passes" done={count ? `${count} ${count === 1 ? "pass" : "passes"}` : undefined} onEdit={() => setStep(2)} />
        {step === 2 && (
          <>
            <ul className="space-y-3">
              {forDay.map((t) => {
                const n = qty[t.id] ?? 0;
                const soldOut = t.available === 0;
                return (
                  <li key={t.id} className="flex items-start justify-between gap-4 border-b border-border pb-3">
                    <div>
                      <p className="font-display font-semibold">{t.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {t.nightsLabel} · {price(t.pricePence)}
                        {soldOut ? " · Sold out" : t.available <= 20 ? ` · ${t.available} left` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2" aria-label={`Number of ${t.name} passes`}>
                      <button type="button" onClick={() => setFor(t, n - 1)} disabled={n === 0} aria-label={`Remove one ${t.name}`} className="size-9 rounded-full border border-border font-bold disabled:opacity-40">
                        −
                      </button>
                      <span className="w-6 text-center font-display font-semibold tabular-nums" aria-live="polite">
                        {n}
                      </span>
                      <button type="button" onClick={() => setFor(t, n + 1)} disabled={soldOut || n >= limit(t)} aria-label={`Add one ${t.name}`} className="size-9 rounded-full border border-border font-bold disabled:opacity-40">
                        +
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <button type="button" disabled={count === 0} onClick={() => setStep(3)} className="btn-cta w-full disabled:opacity-60">
              Continue
            </button>
          </>
        )}
      </section>

      {/* 3. Details, coupon, pay */}
      <section className="space-y-4 border-t border-border pt-4">
        <StepHeader n={3} title="Your details and payment" />
        {step === 3 && (
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
                <button type="button" onClick={applyCoupon} disabled={!couponInput.trim() || checking} className="shrink-0 rounded-full border border-border px-4 text-sm font-semibold disabled:opacity-50">
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
          </>
        )}
      </section>
    </form>
  );
}
