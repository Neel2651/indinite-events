"use client";

import { useState, useTransition } from "react";
import { FormError, inputClass } from "./ui";

type Result = { ok?: string; error?: string };
type SetClosed = (sessionId: string | null, closed: boolean, reason: string) => Promise<Result | null>;

export interface NightBookingState {
  id: string;
  label: string;
  dayLabel: string;
  closed: boolean;
  reason?: string | null;
  /** "Sold out" / "Started" etc. (automatic), shown for information. */
  auto?: string | null;
}

/**
 * Close or reopen bookings (30 Sep 2026): the whole event or single nights. Stops online sales and new payment
 * links; box office can still issue passes. Owner or super admin; every change is audited with its reason.
 */
export function BookingsControl({ eventClosed, eventReason, nights, onSet }: { eventClosed: boolean; eventReason?: string | null; nights: NightBookingState[]; onSet: SetClosed }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Result | null>(null);
  const [reason, setReason] = useState("");
  const run = (sessionId: string | null, closed: boolean) => {
    if (closed && reason.trim().length < 3) return setMsg({ error: "Add a reason first (it's recorded in the audit log)." });
    start(async () => {
      const r = await onSet(sessionId, closed, reason);
      setMsg(r);
      if (r?.ok) setReason("");
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Closing stops online sales and new payment links. Box office can still issue passes. Nights also close to online sales automatically when they start or sell out.</p>
      <label className="block text-sm">
        Reason for closing (recorded in the audit log)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputClass} placeholder="e.g. Venue at capacity" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
        <span>
          <span className="font-semibold">Whole event</span>
          <span className="block text-xs text-muted-foreground">{eventClosed ? `Closed${eventReason ? `: “${eventReason}”` : ""}` : "Open"}</span>
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(null, !eventClosed)}
          className={eventClosed ? "btn-cta disabled:opacity-60" : "rounded-full border border-destructive px-4 py-2 text-sm font-semibold text-destructive disabled:opacity-60"}
        >
          {eventClosed ? "Reopen bookings" : "Close all bookings"}
        </button>
      </div>
      <ul className="divide-y divide-border rounded-md border border-border">
        {nights.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
            <span className="text-sm">
              <span className="font-semibold">{n.label}</span> <span className="text-muted-foreground">· {n.dayLabel}</span>
              <span className="block text-xs text-muted-foreground">{n.closed ? `Closed${n.reason ? `: “${n.reason}”` : ""}` : (n.auto ?? "Open")}</span>
            </span>
            <button type="button" disabled={pending} onClick={() => run(n.id, !n.closed)} className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold disabled:opacity-60">
              {n.closed ? "Reopen" : "Close"}
              <span className="sr-only"> {n.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <FormError message={msg?.error} />
      {msg?.ok && (
        <p role="status" className="text-sm text-success">
          {msg.ok}
        </p>
      )}
    </div>
  );
}
