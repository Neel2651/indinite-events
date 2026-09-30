"use client";

import { useActionState, useState, useTransition } from "react";
import { deleteEventAction, setEventStatusAction, type ActionState } from "@/app/admin/events/actions";
import { FormError, inputClass } from "./ui";

export function EventStatusActions({ eventId, status }: { eventId: string; status: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>(null);
  const go = (s: "draft" | "published" | "archived") => start(async () => setMsg(await setEventStatusAction(eventId, s)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {status !== "published" && (
          <button type="button" disabled={pending} onClick={() => go("published")} className="btn-cta disabled:opacity-60">
            {pending ? "Saving…" : "Publish event"}
          </button>
        )}
        {status === "published" && (
          <button type="button" disabled={pending} onClick={() => confirm("Hide this event from the public site? Existing passes keep working.") && go("draft")} className="rounded-full border border-border px-5 py-2.5 font-semibold disabled:opacity-60">
            Unpublish
          </button>
        )}
        {status !== "archived" && (
          <button type="button" disabled={pending} onClick={() => confirm("Archive this event? It's hidden from the public site and booking screens.") && go("archived")} className="rounded-full border border-border px-5 py-2.5 font-semibold disabled:opacity-60">
            Archive
          </button>
        )}
      </div>
      <FormError message={msg?.error} />
      {msg?.ok && <p role="status" className="text-sm text-success">{msg.ok}</p>}
    </div>
  );
}

/** `returnTo`: the events list to go back to afterwards (admin or this organiser's panel). */
export function DeleteEventForm({ eventId, hasOrders, returnTo = "/admin/events" }: { eventId: string; hasOrders: boolean; returnTo?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(deleteEventAction.bind(null, eventId), null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="returnTo" value={returnTo} />
      <p className="text-sm text-muted-foreground">
        {hasOrders
          ? "This event has bookings, so it will be hidden and kept for finance and audit records (soft delete). Passes already sold stop being bookable but orders stay."
          : "This event has no bookings, so it and its pass types will be permanently deleted."}
      </p>
      <label className="block text-sm">
        Reason (recorded in the audit log)
        <input name="reason" required minLength={3} maxLength={300} className={inputClass} />
      </label>
      <label className="block text-sm">
        Type DELETE to confirm
        <input name="confirm" required autoComplete="off" className={inputClass} />
      </label>
      <FormError message={state?.error} />
      <button type="submit" disabled={pending} className="rounded-full border border-destructive px-5 py-2.5 font-semibold text-destructive disabled:opacity-60">
        {pending ? "Deleting…" : "Delete event"}
      </button>
    </form>
  );
}
