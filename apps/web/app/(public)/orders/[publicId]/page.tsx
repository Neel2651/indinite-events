import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { normalisePublicId, passCode } from "@indinite/core";
import { linkSecret, verifyOrderLink } from "@indinite/core/links";
import { getOrderTickets } from "@/lib/queries";
import { formatDateRange, formatDayTime, price } from "@/lib/format";
import { SpamNote } from "@/components/spam-note";

export const dynamic = "force-dynamic";
// The URL carries a bearer token: keep it out of search engines and Referer headers.
export const metadata: Metadata = { title: "Your passes", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ publicId: string }>; searchParams: Promise<{ t?: string }> };

export default async function OrderTicketsPage({ params, searchParams }: Props) {
  const publicId = normalisePublicId(decodeURIComponent((await params).publicId));
  const token = (await searchParams).t ?? "";
  const link = verifyOrderLink(publicId, token, linkSecret());
  if (!link.ok) return <LinkProblem expired={link.reason === "expired"} />;

  const view = await getOrderTickets(publicId);
  if (!view || (view.status !== "paid" && view.status !== "partially_refunded")) return <LinkProblem expired={false} />;

  const qrs = await Promise.all(
    view.tickets.map((t) =>
      t.qrToken ? QRCode.toString(t.qrToken, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#0a0e1f", light: "#ffffff" } }) : null,
    ),
  );

  return (
    <>
      <section className="dark bg-background text-foreground">
        <div className="mx-auto max-w-3xl px-5 py-12">
          <span className="badge-pill">ORDER {view.publicId}</span>
          <h1 className="mt-5 text-3xl leading-tight sm:text-4xl">{view.event.title}</h1>
          <p className="mt-3 text-muted-foreground">
            {formatDateRange(view.event.startsAt, view.event.endsAt)} · {view.event.venue}
          </p>
        </div>
      </section>

      <section className="bg-brand-cream">
        <div className="mx-auto max-w-3xl space-y-8 px-5 py-10">
          {(view.status === "paid" || view.status === "partially_refunded") && <SpamNote />}
          <div className="card-brand space-y-5">
            <h2 className="text-xl">Booking details</h2>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-muted-foreground">Name</dt>
                <dd className="font-display font-semibold">{view.customerName}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Order reference</dt>
                <dd className="font-display font-semibold tracking-wider">{view.publicId}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Booked</dt>
                <dd className="font-display font-semibold">{view.paidAt ? formatDayTime(view.paidAt) : "—"}</dd>
              </div>
            </dl>
            <ul className="divide-y divide-border border-y border-border">
              {view.lines.map((l) => (
                <li key={l.label} className={`flex justify-between py-3 ${l.negative ? "text-muted-foreground" : ""}`}>
                  <span>{l.label}</span>
                  <span className="font-display font-semibold">
                    {l.negative ? "−" : ""}
                    {price(l.amountPence)}
                  </span>
                </li>
              ))}
              <li className="flex justify-between py-3 font-display text-lg font-bold">
                <span>Total</span>
                <span>{price(view.totalPence)}</span>
              </li>
            </ul>
            <p className="text-sm text-muted-foreground">
              {view.event.venue}
              {view.status === "partially_refunded" && " · Some passes on this order have been refunded."}
            </p>
          </div>

          {view.event.ended ? (
            <div className="card-brand">
              <h2 className="text-xl">This event has ended</h2>
              <p className="mt-2 text-muted-foreground">Thanks for coming. Passes for this event can no longer be shown.</p>
            </div>
          ) : (
            <>
              <div className="max-w-prose">
                <h2 className="text-xl">Your passes</h2>
                <p className="mt-2 text-muted-foreground">
                  Show one QR code per person at the gate, with your screen brightness turned up. For your security this page
                  closes at {formatDayTime(link.expiresAt)}. Use Find my tickets to open it again.
                </p>
              </div>
              {/* One PDF per night (and one for passes valid for several nights), plus everything in one file. */}
              <div className="mt-5 mb-8 flex flex-wrap gap-3">
                {view.nightGroups.length > 1 &&
                  view.nightGroups.map((g) => (
                    <a
                      key={g.key}
                      href={`/orders/${encodeURIComponent(view.publicId)}/pdf?t=${encodeURIComponent(token)}&night=${encodeURIComponent(g.key)}`}
                      download
                      className="rounded-full border border-border bg-card px-5 py-2.5 font-semibold"
                    >
                      {g.title} PDF · {g.count} {g.count === 1 ? "pass" : "passes"}
                    </a>
                  ))}
                <a href={`/orders/${encodeURIComponent(view.publicId)}/pdf?t=${encodeURIComponent(token)}`} download className="btn-cta">
                  {view.nightGroups.length > 1 ? "All passes (PDF)" : "Download passes (PDF)"}
                </a>
              </div>
              {view.nightGroups.map((g) => {
                const inGroup = view.tickets.map((t, i) => ({ t, i })).filter(({ t }) => t.nightKey === g.key);
                return (
                  <section key={g.key} className="mb-8" aria-labelledby={`night-${g.key}`}>
                    {view.nightGroups.length > 1 && (
                      <h3 id={`night-${g.key}`} className="mb-4 text-lg">
                        {g.title} · {g.count} {g.count === 1 ? "pass" : "passes"}
                      </h3>
                    )}
                    <ul className="grid gap-6 sm:grid-cols-2">
                      {inGroup.map(({ t, i }, n) => (
                        <li key={t.id} className="rounded-lg bg-brand-navy p-5 text-center text-white">
                          <p className="font-display text-lg font-semibold">{t.typeName}</p>
                          <p className={`text-sm ${t.nightDate ? "font-semibold text-brand-orange" : "text-on-dark-muted"}`}>
                            {t.nightDate || t.nights} · Pass {n + 1} of {inGroup.length}
                          </p>
                          <div
                            className="mx-auto mt-4 w-full max-w-[240px] rounded-md bg-white p-3 [&>svg]:h-auto [&>svg]:w-full"
                            role="img"
                            aria-label={`QR code for ${t.typeName}, pass ${n + 1}`}
                            // Generated by the qrcode library from our own signed token, not user input.
                            dangerouslySetInnerHTML={{ __html: qrs[i] ?? "" }}
                          />
                          {t.qrToken && (
                            <p className="mt-3 text-xs tracking-widest text-on-dark-muted">
                              {passCode(t.qrToken)}
                              {t.nightDate ? ` · ${t.nightDate}` : ""}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </>
          )}
        </div>
      </section>
    </>
  );
}

function LinkProblem({ expired }: { expired: boolean }) {
  return (
    <section className="bg-brand-cream">
      <div className="mx-auto max-w-xl px-5 py-16">
        <div className="card-brand space-y-4">
          <h1 className="text-2xl">{expired ? "This link has expired" : "We can't show this order"}</h1>
          <p className="text-muted-foreground">
            {expired
              ? "For your security, ticket pages only stay open for 30 minutes. Enter your details again to see your tickets."
              : "The link may be incomplete. Enter your email and order reference to find your tickets."}
          </p>
          <Link href="/orders/lookup" className="btn-cta inline-block">
            Find my tickets
          </Link>
        </div>
      </div>
    </section>
  );
}
