import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { linkSecret, signOrderLink } from "@indinite/core/links";
import { getOrderHistory, quoteRefund, type TimelineEntry } from "@indinite/db";
import { CancelPanel } from "@/components/staff/cancel-panel";
import { RefundPanel } from "@/components/staff/refund-panel";
import { ResendButton } from "@/components/staff/order-actions";
import { PageHeader } from "@/components/staff/shell";
import { formatDay, formatTime, price } from "@/lib/format";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Order" };

const HOW: Record<string, string> = { online: "Online (card)", payment_link: "Payment link", cash: "Cash", bank_transfer: "Organiser's account", complimentary: "Complimentary" };
const TONE: Record<string, string> = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-muted-foreground" };

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
  return (
    <ol className="space-y-3 border-l border-border pl-4">
      {entries.map((e, i) => (
        <li key={i} className="relative">
          <span className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full ${TONE[e.tone ?? "neutral"]}`} aria-hidden />
          <p className="text-sm font-semibold">{e.title}</p>
          <p className="text-xs text-muted-foreground">
            {formatDay(e.at)}, {formatTime(e.at)}
            {e.by && ` · ${e.by}`}
            {e.detail && ` · ${e.detail}`}
          </p>
        </li>
      ))}
    </ol>
  );
}

export default async function OrderPage({ params }: { params: Promise<{ slug: string; publicId: string }> }) {
  const { slug, publicId } = await params;
  const { organizer, can } = await requireOrg(slug);
  if (!can("order.read")) notFound();
  const history = await getOrderHistory(organizer.id, decodeURIComponent(publicId));
  if (!history) notFound();
  const { order, event, orderEntries, tickets } = history;
  const paid = order.status === "paid" || order.status === "partially_refunded";
  const how = HOW[order.offline?.method ?? order.source] ?? order.source;
  const viewUrl = paid ? `/orders/${order.publicId}?t=${encodeURIComponent(signOrderLink(order.publicId, linkSecret()))}` : null;
  const nights = new Map((event?.sessions ?? []).map((s) => [String(s._id), formatDay(s.startsAt)]));
  const refund = can("order.refund") ? await quoteRefund(organizer.id, order.publicId) : null;
  const canCancel = (order.status === "pending" && can("order.cancelPending")) || (paid && order.source === "offline" && can("order.cancel"));

  return (
    <>
      <PageHeader
        title={`Order ${order.publicId}`}
        description={`${event?.title ?? ""} · ${how}`}
        actions={
          <div className="flex flex-wrap items-start gap-3">
            {viewUrl && (
              <a href={viewUrl} target="_blank" rel="noopener noreferrer" className="btn-cta text-sm">
                Show passes
              </a>
            )}
            {paid && can("order.resendTickets") && <ResendButton slug={slug} publicId={order.publicId} />}
          </div>
        }
      />
      {order.needsReview && (
        <p role="alert" className="mb-6 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <strong>Needs review:</strong> {order.reviewNote ?? "Something changed outside Indinite."}
        </p>
      )}
      {order.status === "cancelled" && (
        <p className="mb-6 rounded-md bg-muted px-4 py-3 text-sm">
          <strong>Cancelled</strong>
          {order.cancellation?.at ? ` on ${formatDay(order.cancellation.at)}` : ""}
          {order.cancellation?.reason ? `: “${order.cancellation.reason}”` : ""}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-lg">Passes</h2>
            <ul className="mt-4 space-y-6">
              {tickets.map((t) => (
                <li key={t.id} className="rounded-md border border-border p-4">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold">
                      Pass {t.position}: {t.ticketTypeName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.code} · {t.validSessionIds.length === nights.size && nights.size > 1 ? "All nights" : t.validSessionIds.map((s) => nights.get(s)).filter(Boolean).join(", ")}
                      {t.status !== "valid" && ` · ${t.status}`}
                    </p>
                  </div>
                  <Timeline entries={t.entries} />
                </li>
              ))}
              {tickets.length === 0 && <p className="text-sm text-muted-foreground">No passes issued yet.</p>}
            </ul>
          </section>
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-4 text-lg">Order history</h2>
            <Timeline entries={orderEntries} />
          </section>
        </div>

        {/* Phones: customer, payment and actions first; passes and history below. */}
        <aside className="order-first h-fit space-y-6 lg:order-none">
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-lg">Customer</h2>
            <p className="mt-2 font-semibold">{order.customer?.name}</p>
            <p className="text-sm text-muted-foreground">{order.customer?.email}</p>
            {order.customer?.phone && <p className="text-sm text-muted-foreground">{order.customer.phone}</p>}
          </section>
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-lg">Payment</h2>
            <dl className="mt-3 space-y-2 text-sm">
              {order.items.map((i) => (
                <div key={i.name} className="flex justify-between">
                  <dt>
                    {i.qty} × {i.name}
                  </dt>
                  <dd>{price(i.unitPricePence * i.qty)}</dd>
                </div>
              ))}
              {(order.discount?.amountPence ?? 0) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <dt>{order.discount?.reason ?? "Discount"}</dt>
                  <dd>−{price(order.discount!.amountPence!)}</dd>
                </div>
              )}
              {(order.platformFeePence ?? 0) > 0 && (
                <div className="flex justify-between">
                  <dt>Platform fee ({((order.commissionBps ?? 0) / 100).toFixed(2).replace(/\.?0+$/, "")}%)</dt>
                  <dd>{price(order.platformFeePence!)}</dd>
                </div>
              )}
              {(order.charges ?? []).map((c) => (
                <div key={c.name} className="flex justify-between">
                  <dt>{c.name}</dt>
                  <dd>{price(c.amountPence ?? 0)}</dd>
                </div>
              ))}
              {(order.taxPence ?? 0) > 0 && (
                <div className="flex justify-between">
                  <dt>Tax ({((order.taxBps ?? 0) / 100).toFixed(2).replace(/\.?0+$/, "")}%)</dt>
                  <dd>{price(order.taxPence!)}</dd>
                </div>
              )}
              {(order.cardFeePence ?? 0) > 0 && (
                <div className="flex justify-between">
                  <dt>Card processing fee</dt>
                  <dd>{price(order.cardFeePence!)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2 font-display text-base font-bold">
                <dt>Total</dt>
                <dd>{price(order.totalPence)}</dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>Indinite commission</dt>
                <dd>{price(order.applicationFeePence)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              {how}
              {order.offline?.note && ` · “${order.offline.note}”`}
            </p>
          </section>
          {refund && (
            <section className="rounded-lg border border-border bg-card p-6">
              <h2 className="mb-3 text-lg">Refund</h2>
              <RefundPanel
                slug={slug}
                publicId={order.publicId}
                eligible={refund.eligible}
                reason={refund.reason}
                method={refund.method}
                disconnectedCard={refund.method === "outside_indinite" && order.source !== "offline"}
                tickets={refund.tickets.map((t, i) => ({ id: t.id, label: `Pass ${i + 1}: ${t.ticketTypeName}`, refundablePence: t.refundablePence, status: t.status, scanned: t.scanned }))}
              />
            </section>
          )}
          {canCancel && (
            <section className="rounded-lg border border-destructive/40 bg-card p-6">
              <h2 className="mb-3 text-lg">Cancel booking</h2>
              <CancelPanel slug={slug} publicId={order.publicId} pending={order.status === "pending"} />
            </section>
          )}
          {(order.refunds ?? []).length > 0 && (
            <section className="rounded-lg border border-border bg-card p-6 text-sm">
              <h2 className="mb-2 text-lg">Refunds</h2>
              <ul className="space-y-2">
                {order.refunds!.map((r, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>
                      {r.ticketIds?.length ? `${r.ticketIds.length} pass${r.ticketIds.length === 1 ? "" : "es"}` : "Whole booking"} · {r.method === "stripe" ? "to card" : r.method === "stripe_dashboard" ? "to card, in the Stripe dashboard" : r.method === "outside_indinite" ? "repaid by organiser" : "cancelled"}
                      <span className="block text-xs text-muted-foreground">{r.reason}</span>
                    </span>
                    <span className="font-semibold">{price(r.amountPence)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Link href={`/org/${slug}/orders`} className="font-semibold text-brand-orange-strong hover:underline">
            Back to orders
          </Link>
        </aside>
      </div>
    </>
  );
}
