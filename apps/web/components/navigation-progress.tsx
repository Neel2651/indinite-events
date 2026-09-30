"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Thin brand-orange bar at the top of the screen while the next page loads (1 Oct 2026). Pages load their data on
 * the server first, so without this a tap on a link looks like nothing happened. It starts on a click on a link
 * to another page of this site and finishes when the address changes. New tabs, downloads, external links and
 * same-page anchors don't start it.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const here = `${pathname}?${search.toString()}`;
  // The address when the click happened: still the same = loading; different = the new page has arrived.
  const [from, setFrom] = useState<string | null>(null);
  const safety = useRef<number | undefined>(undefined);
  const state: "idle" | "loading" | "done" = from === null ? "idle" : from === here ? "loading" : "done";

  // Arrived: let the bar fill, then hide it.
  useEffect(() => {
    if (state !== "done") return;
    const t = window.setTimeout(() => setFrom(null), 300);
    return () => window.clearTimeout(t);
  }, [state]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Same page (only the #anchor differs): no loading.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setFrom(`${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`);
      // Never leave it stuck (e.g. the navigation was cancelled).
      window.clearTimeout(safety.current);
      safety.current = window.setTimeout(() => setFrom(null), 15_000);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.clearTimeout(safety.current);
    };
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-[100] h-[3px] print:hidden"
        style={{ opacity: state === "idle" ? 0 : 1, transition: "opacity 200ms" }}
      >
        <div
          className="h-full bg-brand-orange shadow-[0_0_8px_var(--brand-orange)] motion-reduce:transition-none"
          style={{
            width: state === "done" ? "100%" : state === "loading" ? "85%" : "0%",
            transition: state === "loading" ? "width 8s cubic-bezier(0.1, 0.7, 0.2, 1)" : state === "done" ? "width 200ms ease-out" : "none",
          }}
        />
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {state === "loading" ? "Loading" : ""}
      </p>
    </>
  );
}
