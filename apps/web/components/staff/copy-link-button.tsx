"use client";

import { useState } from "react";

/** Copies a link and says so; falls back to showing the link if the browser blocks the clipboard. */
export function CopyLinkButton({ url, label = "Copy setup link", className }: { url: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setState("copied");
            setTimeout(() => setState("idle"), 3000);
          } catch {
            setState("failed");
          }
        }}
        className={className ?? "rounded-full border border-border bg-card px-5 py-3 font-semibold"}
      >
        {state === "copied" ? "Link copied" : label}
      </button>
      <span role="status" className="sr-only">
        {state === "copied" ? "Setup link copied to the clipboard" : ""}
      </span>
      {state === "failed" && (
        <input readOnly value={url} aria-label="Setup link" onFocus={(e) => e.currentTarget.select()} className="mt-1 w-72 rounded-md border border-border px-2 py-1 text-xs" />
      )}
    </span>
  );
}
