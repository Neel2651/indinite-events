"use client";

import { useState, useTransition } from "react";
import { resendTicketsAction } from "@/app/org/[slug]/orders/[publicId]/actions";

export function ResendButton({ slug, publicId }: { slug: string; publicId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setMsg(await resendTicketsAction(slug, publicId)))}
        className="rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email passes again"}
      </button>
      {msg && <p className={`mt-2 text-sm ${msg.error ? "text-destructive" : "text-success"}`}>{msg.error ?? msg.ok}</p>}
    </div>
  );
}
