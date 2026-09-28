"use client";

import { useState, useTransition } from "react";
import { cancelOrderAction } from "@/app/org/[slug]/orders/[publicId]/actions";
import { FormError, inputClass } from "./ui";

export function CancelPanel({ slug, publicId, pending: unpaid }: { slug: string; publicId: string; pending: boolean }) {
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [busy, start] = useTransition();
  if (msg?.ok) return <p role="status" className="text-sm text-success">{msg.ok}</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {unpaid
          ? "The payment link stops working and the passes go back on sale."
          : "Every pass stops working at the gate, the passes go back on sale and the commission owed is reversed. The customer is emailed. Any repayment is up to you."}
      </p>
      <label className="block text-sm">
        Reason (recorded in the order history)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputClass} placeholder={unpaid ? "e.g. Customer changed their mind" : "e.g. Entered twice by mistake"} />
      </label>
      <FormError message={msg?.error} />
      <button
        type="button"
        disabled={busy || reason.trim().length < 3}
        onClick={() => confirm("Cancel this booking? This can't be undone.") && start(async () => setMsg(await cancelOrderAction(slug, publicId, reason)))}
        className="rounded-full border border-destructive px-5 py-2.5 font-semibold text-destructive disabled:opacity-50"
      >
        {busy ? "Cancelling…" : "Cancel booking"}
      </button>
    </div>
  );
}
