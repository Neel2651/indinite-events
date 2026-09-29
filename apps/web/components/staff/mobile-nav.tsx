"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SignOutButton } from "./nav";

export type TabIcon = "home" | "orders" | "plus" | "checkins" | "scan" | "events" | "money" | "more";

export interface MobileTab {
  href: string;
  label: string;
  icon: TabIcon;
  exact?: boolean;
}

const PATHS: Record<TabIcon, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  orders: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  plus: "M12 5v14M5 12h14",
  checkins: "M4 12.5 9 17.5 20 6.5",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10",
  events: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
  money: "M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
  more: "M4 7h16M4 12h16M4 17h16",
};

function Icon({ name }: { name: TabIcon }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Phone-only bottom tabs (thumb reach) plus a "More" sheet for everything else. Hidden from `sm` up. */
export function MobileTabBar({ tabs, more, links, user }: { tabs: MobileTab[]; more: { href: string; label: string }[]; links: { href: string; label: string }[]; user: { name: string; roleLabel: string } }) {
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // Close the sheet when navigating.
  useEffect(() => {
    dialog.current?.close();
  }, [path]);
  const isActive = (t: { href: string; exact?: boolean }) => (t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`));
  const moreActive = more.some(isActive);

  return (
    <>
      <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-brand-navy pb-[env(safe-area-inset-bottom)] text-white sm:hidden print:hidden">
        <ul className="flex">
          {tabs.map((t) => {
            const active = isActive(t);
            return (
              <li key={t.href} className="flex-1">
                <Link href={t.href} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold ${active ? "text-brand-orange" : "text-on-dark-muted"}`}>
                  <Icon name={t.icon} />
                  {t.label}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => {
                dialog.current?.showModal();
                setOpen(true);
              }}
              aria-haspopup="dialog"
              aria-expanded={open}
              className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold ${moreActive ? "text-brand-orange" : "text-on-dark-muted"}`}
            >
              <Icon name="more" />
              More
            </button>
          </li>
        </ul>
      </nav>

      {/* Native modal dialog: traps focus; Escape or Close shut it. */}
      <dialog
        ref={dialog}
        aria-labelledby="more-title"
        onClose={() => setOpen(false)}
        className="m-0 mt-auto w-full max-w-none rounded-t-3xl bg-brand-navy p-0 text-white backdrop:bg-black/60 sm:hidden"
      >
        <div className="px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 id="more-title" className="font-display text-lg font-semibold text-white">
                More
              </h2>
              <p className="text-sm text-on-dark-muted">
                {user.name} · {user.roleLabel}
              </p>
            </div>
            <button type="button" onClick={() => dialog.current?.close()} className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold">
              Close
            </button>
          </div>
          <ul className="divide-y divide-white/10 rounded-2xl bg-white/5">
            {[...more, ...links].map((l) => (
              <li key={l.href}>
                <Link href={l.href} aria-current={isActive(l) ? "page" : undefined} className={`flex min-h-12 items-center px-4 font-semibold ${isActive(l) ? "text-brand-orange" : ""}`}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <SignOutButton />
          </div>
        </div>
      </dialog>
    </>
  );
}

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** Whether the browser thinks it has a connection (true on the server). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <p role="status" className="sticky top-0 z-50 bg-warning px-4 py-2 text-center text-sm font-semibold text-brand-navy print:hidden">
      You&apos;re offline. Bookings and orders need a connection;{" "}
      <Link href="/scan" className="underline">
        scanning still works
      </Link>
      .
    </p>
  );
}
