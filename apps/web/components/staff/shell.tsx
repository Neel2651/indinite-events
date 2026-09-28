import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton, StaffNav } from "./nav";

interface Props {
  /** "Admin", or the organiser's name. */
  area: string;
  areaHref: string;
  nav: { href: string; label: string; exact?: boolean }[];
  user: { name: string; email: string; roleLabel: string };
  /** Extra links shown next to the user (e.g. switch organiser, admin). */
  links?: { href: string; label: string }[];
  children: ReactNode;
}

export function StaffShell({ area, areaHref, nav, user, links = [], children }: Props) {
  return (
    <div className="flex min-h-dvh flex-col bg-muted print:bg-white">
      <header className="dark bg-background text-foreground print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 pt-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-brand-orange" title="Public site">
              <img src="/brand/indinite-mark.png" alt="" width={32} height={28} className="h-7 w-auto" />
              INDINITE
            </Link>
            <span className="text-on-dark-muted" aria-hidden>
              /
            </span>
            <Link href={areaHref} className="font-display font-semibold text-white">
              {area}
            </Link>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="font-semibold text-on-dark-muted hover:text-white">
                {l.label}
              </Link>
            ))}
            <span className="hidden text-right sm:block">
              <span className="block font-semibold text-white">{user.name}</span>
              <span className="block text-xs text-on-dark-muted">{user.roleLabel}</span>
            </span>
            <SignOutButton />
          </div>
        </div>
        <div className="mx-auto mt-2 max-w-6xl px-5">
          <StaffNav items={nav} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
