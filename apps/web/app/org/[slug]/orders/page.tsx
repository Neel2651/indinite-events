import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { Order } from "@indinite/db";
import { PageHeader } from "@/components/staff/shell";
import { inputClass } from "@/components/staff/ui";
import { formatDay, formatTime, price } from "@/lib/format";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Orders" };

const HOW: Record<string, string> = { online: "Online", payment_link: "Payment link", cash: "Cash", bank_transfer: "Organiser's account", complimentary: "Complimentary" };
const STATUS: Record<string, string> = { pending: "Awaiting payment", paid: "Paid", expired: "Expired", cancelled: "Cancelled", refunded: "Refunded", partially_refunded: "Part refunded" };
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; how?: string; coupon?: string }> };

export default async function OrdersPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { q = "", how = "", coupon = "" } = await searchParams;
  const { organizer, can } = await requireOrg(slug);
  if (!can("order.read")) notFound();

  const filter: Record<string, unknown> = { organizerId: new Types.ObjectId(organizer.id) };
  const term = q.trim().slice(0, 80);
  if (term) {
    const rx = new RegExp(escapeRegex(term), "i");
    filter.$or = [{ publicId: rx }, { "customer.email": rx }, { "customer.name": rx }];
  }
  const couponCode = coupon.trim().toUpperCase().slice(0, 40);
  if (couponCode) filter.couponCode = couponCode;
  if (how === "online" || how === "payment_link") filter.source = how;
  else if (["cash", "bank_transfer", "complimentary"].includes(how)) filter["offline.method"] = how;

  const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(200).lean();

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every booking for this organiser, newest first."
        actions={
          can("reports.read") ? (
            <a href={`/org/${slug}/export/orders`} className="font-semibold text-brand-orange-strong hover:underline">
              Download orders (CSV)
            </a>
          ) : undefined
        }
      />
      {couponCode && (
        <p className="mb-3 text-sm">
          Showing bookings that used <strong>{couponCode}</strong>.{" "}
          <Link href={`/org/${slug}/orders`} className="font-semibold text-brand-orange-strong hover:underline">
            Show all orders
          </Link>
        </p>
      )}
      <form className="mb-4 flex flex-wrap gap-3" role="search">
        {couponCode && <input type="hidden" name="coupon" value={couponCode} />}
        <label htmlFor="orders-q" className="sr-only">
          Search orders
        </label>
        <input id="orders-q" name="q" type="search" defaultValue={q} placeholder="Search by order ref, name or email" className={`${inputClass} mt-0 max-w-sm`} />
        <label htmlFor="orders-how" className="sr-only">
          Payment type
        </label>
        <select id="orders-how" name="how" defaultValue={how} className={`${inputClass} mt-0 w-auto`}>
          <option value="">All payment types</option>
          {Object.entries(HOW).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-full border border-border bg-card px-5 font-semibold">
          Search
        </button>
      </form>
      {/* Phones: one card per order. */}
      <ul className="space-y-3 sm:hidden">
        {orders.map((o) => (
          <li key={String(o._id)}>
            <Link href={`/org/${slug}/orders/${o.publicId}`} className="block rounded-lg border border-border bg-card p-4 active:bg-muted">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display font-semibold tracking-wider text-brand-orange-strong">{o.publicId}</span>
                <span className="font-display font-semibold">{price(o.totalPence)}</span>
              </div>
              <p className="mt-1 truncate font-semibold">{o.customer?.name}</p>
              <p className="truncate text-sm text-muted-foreground">{o.customer?.email}</p>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {o.items.reduce((n, i) => n + i.qty, 0)} {o.items.reduce((n, i) => n + i.qty, 0) === 1 ? "pass" : "passes"}
                </span>
                <span>{HOW[o.offline?.method ?? o.source] ?? o.source}</span>
                <span className="font-semibold text-foreground">{STATUS[o.status ?? "pending"]}</span>
                <span>
                  {formatDay(o.createdAt as Date)}, {formatTime(o.createdAt as Date)}
                </span>
              </p>
            </Link>
          </li>
        ))}
        {orders.length === 0 && <li className="rounded-lg border border-border bg-card px-4 py-6 text-muted-foreground">No orders found.</li>}
      </ul>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card sm:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Passes</th>
              <th className="px-4 py-3 font-semibold">Paid by</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.map((o) => (
              <tr key={String(o._id)} className="hover:bg-muted/60">
                <td className="px-4 py-3">
                  <Link href={`/org/${slug}/orders/${o.publicId}`} className="font-semibold text-brand-orange-strong hover:underline">
                    {o.publicId}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {formatDay(o.createdAt as Date)}, {formatTime(o.createdAt as Date)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {o.customer?.name}
                  <span className="block text-xs text-muted-foreground">{o.customer?.email}</span>
                </td>
                <td className="px-4 py-3">{o.items.reduce((n, i) => n + i.qty, 0)}</td>
                <td className="px-4 py-3">{HOW[o.offline?.method ?? o.source] ?? o.source}</td>
                <td className="px-4 py-3">{STATUS[o.status ?? "pending"]}</td>
                <td className="px-4 py-3 text-right font-semibold">{price(o.totalPence)}</td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-muted-foreground">
                  No orders found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
