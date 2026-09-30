"use client";

import { useState, useTransition } from "react";
import { refundAction } from "@/app/org/[slug]/orders/[publicId]/actions";
import { price } from "@/lib/format";
import { FormError, inputClass } from "./ui";

interface Props {
  slug: string;
  publicId: string;
  eligible: boolean;
  reason?: string;
  method: "stripe" | "outside_indinite" | "none";
  tickets: { id: string; label: string; refundablePence: number; status: string; scanned: boolean }[];
  /** Paid by card into the organiser's own Stripe account, which has since been disconnected from Indinite. */
  disconnectedCard?: boolean;
}

export function RefundPanel({ slug, publicId, eligible, reason: blocked, method, tickets, disconnectedCard }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const refundable = tickets.filter((t) => t.status === "valid" && !t.scanned);
  const amount = tickets.filter((t) => selected.includes(t.id)).reduce((s, t) => s + t.refundablePence, 0);

  if (!eligible) return <p className="text-sm text-muted-foreground">{blocked}</p>;
  if (refundable.length === 0) return <p className="text-sm text-muted-foreground">There are no passes left to refund on this order.</p>;

  const label =
    method === "stripe" ? `Refund ${price(amount)} to their card` : method === "outside_indinite" ? `Record a refund of ${price(amount)}` : "Cancel these passes";

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {tickets.map((t) => {
          const disabled = t.status !== "valid" || t.scanned;
          return (
            <li key={t.id}>
              <label className={`flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm ${disabled ? "opacity-50" : ""}`}>
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={selected.includes(t.id)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))}
                    className="accent-[var(--brand-orange)]"
                  />
                  {t.label}
                  {t.status !== "valid" && <span className="text-xs text-muted-foreground">({t.status})</span>}
                  {t.scanned && t.status === "valid" && <span className="text-xs text-muted-foreground">(used at the gate)</span>}
                </span>
                <span className="font-semibold">{price(t.refundablePence)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <label className="block text-sm">
        Reason (the customer won&apos;t see this)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputClass} placeholder="e.g. Customer can't attend" />
      </label>
      <p className="text-xs text-muted-foreground">
        Only the ticket price is refunded. The platform fee, your charges and tax are not.{" "}
        {method === "stripe"
          ? "The amount goes back to the customer's card and is taken from your Stripe balance."
          : method === "outside_indinite"
            ? disconnectedCard
              ? "This card payment went into your own Stripe account, which is no longer connected to Indinite. Refund the customer in your Stripe dashboard, then record it here."
              : "This booking was paid to you directly, so you repay the customer yourself."
            : ""}{" "}
        Refunded passes stop working at the gate and go back on sale.
      </p>
      <FormError message={msg?.error} />
      {msg?.ok && <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">{msg.ok}</p>}
      <button
        type="button"
        disabled={pending || selected.length === 0 || reason.trim().length < 3}
        onClick={() => {
          if (!confirm(`${label}? This can't be undone.`)) return;
          start(async () => {
            const r = await refundAction(slug, publicId, selected, reason);
            setMsg(r);
            if (r.ok) setSelected([]);
          });
        }}
        className="rounded-full border border-destructive px-5 py-2.5 font-semibold text-destructive disabled:opacity-50"
      >
        {pending ? "Refunding…" : label}
      </button>
    </div>
  );
}
