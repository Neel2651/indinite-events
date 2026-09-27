"use client";

import { useState, useTransition } from "react";
import { priceOrder } from "@indinite/core";
import { saveChargesAction, type ChargeInput } from "@/app/org/[slug]/pricing/actions";
import { price } from "@/lib/format";
import { FormError, inputClass } from "./ui";

interface Props {
  slug: string;
  eventId: string;
  initial: ChargeInput[];
  canEdit: boolean;
  commissionBps: number;
  taxBps: number;
  examplePricePence: number;
}

export function ChargesEditor({ slug, eventId, initial, canEdit, commissionBps, taxBps, examplePricePence }: Props) {
  const [rows, setRows] = useState<ChargeInput[]>(initial.length ? initial : []);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  const charges = rows
    .filter((r) => r.name.trim() && r.amount.trim() && Number.isFinite(Number(r.amount)))
    .map((r) => ({ name: r.name, kind: r.kind, value: Math.round(Number(r.amount) * 100) }));
  let example: ReturnType<typeof priceOrder> | null = null;
  try {
    example = priceOrder({ items: [{ ticketTypeId: "x", name: "Pass", unitPricePence: examplePricePence, qty: 1 }], commissionBps, taxBps, charges });
  } catch {
    example = null;
  }

  const update = (i: number, patch: Partial<ChargeInput>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-4">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No charges. Customers pay the ticket price, the platform fee and tax.</p>}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_130px_110px_auto] items-end gap-2">
          <label className="block text-sm">
            <span className={i ? "sr-only" : ""}>Charge name</span>
            <input value={r.name} disabled={!canEdit} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. Venue fee" maxLength={60} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className={i ? "sr-only" : ""}>Type</span>
            <select value={r.kind} disabled={!canEdit} onChange={(e) => update(i, { kind: e.target.value as ChargeInput["kind"] })} className={inputClass}>
              <option value="fixed">£ per ticket</option>
              <option value="percent">% of price</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className={i ? "sr-only" : ""}>Amount</span>
            <input value={r.amount} disabled={!canEdit} onChange={(e) => update(i, { amount: e.target.value })} inputMode="decimal" placeholder={r.kind === "fixed" ? "0.30" : "2.5"} className={inputClass} />
          </label>
          {canEdit && (
            <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="mb-1 rounded-full border border-border px-3 py-2 text-xs font-semibold">
              Remove
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <button type="button" onClick={() => setRows((r) => [...r, { name: "", kind: "fixed", amount: "" }])} className="text-sm font-semibold text-brand-orange-strong hover:underline">
          + Add a charge
        </button>
      )}

      {example && (
        <div className="rounded-md bg-muted p-4 text-sm">
          <p className="mb-2 font-semibold">What a customer pays for one {price(examplePricePence)} pass</p>
          <dl className="space-y-1">
            <div className="flex justify-between"><dt>Ticket</dt><dd>{price(example.ticketsPence)}</dd></div>
            <div className="flex justify-between"><dt>Platform fee ({commissionBps / 100}%)</dt><dd>{price(example.platformFeePence)}</dd></div>
            {example.charges.map((c) => (
              <div key={c.name} className="flex justify-between"><dt>{c.name}</dt><dd>{price(c.amountPence)}</dd></div>
            ))}
            {taxBps > 0 && <div className="flex justify-between"><dt>Tax ({taxBps / 100}%)</dt><dd>{price(example.taxPence)}</dd></div>}
            <div className="flex justify-between border-t border-border pt-1 font-bold"><dt>Total</dt><dd>{price(example.totalPence)}</dd></div>
          </dl>
        </div>
      )}

      {canEdit && (
        <>
          <FormError message={msg?.error} />
          {msg?.ok && <p className="text-sm text-success">{msg.ok}</p>}
          <button type="button" disabled={pending} onClick={() => start(async () => setMsg(await saveChargesAction(slug, eventId, rows)))} className="btn-cta disabled:opacity-60">
            {pending ? "Saving…" : "Save charges"}
          </button>
        </>
      )}
    </div>
  );
}
