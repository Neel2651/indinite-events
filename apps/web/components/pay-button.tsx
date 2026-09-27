"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PayButton({ publicId, token, label }: { publicId: string; token: string; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const res = await fetch("/api/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publicId, t: token }) });
          const data = (await res.json().catch(() => ({}))) as { redirectUrl?: string; error?: string };
          if (res.ok && data.redirectUrl) router.push(data.redirectUrl);
          else {
            setError(data.error ?? "Something went wrong. Please try again.");
            setPending(false);
          }
        }}
        className="btn-cta w-full py-4 text-lg disabled:opacity-60"
      >
        {pending ? "Processing…" : label}
      </button>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
