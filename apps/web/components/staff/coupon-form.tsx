"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createCouponAction, endCouponAction } from "@/app/org/[slug]/coupons/actions";
import { FieldError, FormError, inputClass } from "./ui";
import { useFormAction } from "@/lib/use-form-action";

export interface CouponPassGroup {
  /** "Day 2 · Sat 10 Oct", or "Passes for more than one night". */
  title: string;
  passes: { id: string; name: string }[];
}

export function CouponForm({ slug, events }: { slug: string; events: { id: string; title: string; passGroups: CouponPassGroup[] }[] }) {
  const [state, action, pending] = useFormAction(createCouponAction.bind(null, slug), null);
  const ref = useRef<HTMLFormElement>(null);
  const [eventId, setEventId] = useState("");
  // A new result: after a successful create, clear the chosen event during render rather than in an effect.
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state?.ok) setEventId("");
  }
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  const groups = events.find((e) => e.id === eventId)?.passGroups ?? [];
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
        <select name="eventId" value={eventId} onChange={(e) => setEventId(e.target.value)} className={inputClass}>
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
      {groups.length > 0 && (
        <fieldset className="space-y-3 rounded-md border border-border p-4 sm:col-span-3" aria-describedby="passes-help">
          <legend className="px-1 text-sm font-semibold">Applies to (optional)</legend>
          <p id="passes-help" className="text-xs text-muted-foreground">
            Tick the passes this code discounts, e.g. one night&apos;s passes or the season pass. Other passes in the basket stay full price. Tick none for every pass.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <div key={g.title} className="text-sm">
                <p className="font-semibold">{g.title}</p>
                {g.passes.map((p) => (
                  <label key={p.id} className="mt-1 flex items-center gap-2">
                    <input type="checkbox" name="ticketTypeIds" value={p.id} className="accent-[var(--brand-orange)]" />
                    {p.name}
                  </label>
                ))}
              </div>
            ))}
          </div>
          <FieldError state={state} name="passes" />
        </fieldset>
      )}
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
