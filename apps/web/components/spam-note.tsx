import Link from "next/link";

/** After a booking (1 Oct 2026): passes emails sometimes land in spam. */
export function SpamNote() {
  return (
    <p className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm">
      <strong>Can&apos;t find the email?</strong> We&apos;ve sent your passes to the email address you booked with. If it isn&apos;t in your inbox after a few
      minutes, check your spam or junk folder. You can also get your passes any time from{" "}
      <Link href="/orders/lookup" className="font-semibold text-brand-orange-strong hover:underline">
        Find my tickets
      </Link>
      .
    </p>
  );
}
