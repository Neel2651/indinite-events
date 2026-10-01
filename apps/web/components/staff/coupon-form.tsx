"use client";

import { useEffect, useRef, useTransition } from "react";
import { createCouponAction, endCouponAction } from "@/app/org/[slug]/coupons/actions";
import { FieldError, FormError, inputClass } from "./ui";
import { useFormAction } from "@/lib/use-form-action";

export function CouponForm({ slug, events }: { slug: string; events: { id: string; title: string }[] }) {
  const [state, action, pending] = useFormAction(createCouponAction.bind(null, slug), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} onSubmit={action} className="grid gap-4 sm:grid-cols-3">
      <label className="block text-sm">
        Code
        <input name="code" required minLength={3} maxLength={40} placeholder="e.g. EARLYBIRD" className={`${inputClass} uppercase`} />
        <FieldError state={state} name="code" />
      </label>
      <label className="block text-sm">
        Discount
        <select name="kind" defaultValue="percent" className={inputClass}>
          <option value="percent">% off tickets</option>
          <option value="fixed">£ off the tickets</option>
        </select>
      </label>
      <label className="block text-sm">
        Amount
        <input name="amount" required inputMode="decimal" placeholder="10" className={inputClass} />
        <FieldError state={state} name="amount" />
      </label>
      <label className="block text-sm">
        Event
        <select name="eventId" defaultValue="" className={inputClass}>
          <option value="">All events</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Maximum uses (optional)
        <input name="maxUses" type="number" min={1} className={inputClass} />
        <FieldError state={state} name="maxUses" />
      </label>
      <label className="block text-sm">
        Max discount £ (optional, % codes)
        <input name="maxDiscount" inputMode="decimal" placeholder="e.g. 10.00" className={inputClass} />
        <FieldError state={state} name="maxDiscount" />
      </label>
      <label className="block text-sm">
        Minimum ticket spend £ (optional)
        <input name="minSpend" inputMode="decimal" placeholder="e.g. 30.00" className={inputClass} />
        <FieldError state={state} name="minSpend" />
      </label>
      <div className="grid grid-cols-2 gap-2 sm:col-span-2">
        <label className="block text-sm">
          From (start of day, UK)
          <input name="validFrom" type="date" className={inputClass} />
        </label>
        <label className="block text-sm">
          Until (end of day, UK)
          <input name="validTo" type="date" className={inputClass} />
        </label>
      </div>
      <div className="space-y-3 sm:col-span-3">
        <FormError message={state?.error} />
        {state?.ok && <p className="text-sm text-success">{state.ok}</p>}
        <button type="submit" disabled={pending} className="btn-cta disabled:opacity-60">
          {pending ? "Creating…" : "Create coupon"}
        </button>
      </div>
    </form>
  );
}

export function EndCouponButton({ slug, couponId }: { slug: string; couponId: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(() => endCouponAction(slug, couponId))} className="rounded-full border border-border px-3 py-1 text-xs font-semibold disabled:opacity-60">
      {pending ? "Ending…" : "End now"}
    </button>
  );
}
