import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL } from "@/lib/legal";

/** Shared layout for the policy pages. */
export function LegalPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <>
      <section className="dark bg-background text-foreground">
        <div className="mx-auto max-w-3xl px-5 py-12">
          <span className="badge-pill">POLICIES</span>
          <h1 className="mt-5 text-3xl leading-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 text-muted-foreground">{intro}</p>
          <p className="mt-2 text-sm text-on-dark-muted">Last updated {LEGAL.lastUpdated}</p>
        </div>
      </section>
      <section className="bg-brand-cream">
        <div className="mx-auto max-w-3xl px-5 py-10">
          <article className="card-brand legal space-y-6 text-[15px] leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_h2:first-child]:mt-0 [&_li]:mt-1 [&_p]:text-muted-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ul]:text-muted-foreground [&_a]:font-semibold [&_a]:text-brand-orange-strong [&_a:hover]:underline">
            {children}
          </article>
          <nav aria-label="Policies" className="mt-6 flex flex-wrap gap-4 text-sm font-semibold">
            <Link href="/booking-terms" className="text-brand-orange-strong hover:underline">Booking terms</Link>
            <Link href="/refund-policy" className="text-brand-orange-strong hover:underline">Refund policy</Link>
            <Link href="/privacy" className="text-brand-orange-strong hover:underline">Privacy policy</Link>
          </nav>
        </div>
      </section>
    </>
  );
}
