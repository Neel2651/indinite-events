import Link from "next/link";
import { isStaging } from "@indinite/core";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const staging = isStaging(process.env);
  return (
    <>
      {staging && (
        <p className="bg-brand-yellow px-4 py-2 text-center text-sm font-semibold text-brand-navy">
          Demo site: no real payments are taken and passes aren&apos;t valid for entry.
        </p>
      )}
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" data-pixel-button="home" className="flex items-center gap-2.5 font-display text-xl font-bold tracking-tight text-brand-orange" aria-label="Indinite events, home">
            <img src="/brand/indinite-mark.png" alt="" width={37} height={32} className="h-8 w-auto" />
            <span aria-hidden>
              INDINITE <span className="font-sans font-normal text-muted-foreground">events</span>
            </span>
          </Link>
          <Link href="/orders/lookup" data-pixel-button="find_my_tickets" className="text-sm font-semibold text-brand-orange-strong hover:underline">
            Find my tickets
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="dark bg-background text-muted-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-5 py-10 text-sm">
          <div>
            <p>Tickets sold by Indinite on behalf of event organisers. Payments processed securely by Stripe.</p>
            <p className="mt-2">© {new Date().getFullYear()} Indinite</p>
          </div>
          <nav aria-label="Policies and staff" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/booking-terms" data-pixel-button="booking_terms" className="hover:text-foreground hover:underline">
              Booking terms
            </Link>
            <Link href="/refund-policy" data-pixel-button="refund_policy" className="hover:text-foreground hover:underline">
              Refund policy
            </Link>
            <Link href="/privacy" data-pixel-button="privacy_policy" className="hover:text-foreground hover:underline">
              Privacy policy
            </Link>
            <Link href="/sign-in" data-pixel-button="organiser_login" className="hover:text-foreground hover:underline">
              Organiser login
            </Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
