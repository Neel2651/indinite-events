import type { Metadata } from "next";
import Link from "next/link";
import { Types } from "mongoose";
import { Event, Order, Organizer } from "@indinite/db";
import { PageHeader } from "@/components/staff/shell";
import { inputClass } from "@/components/staff/ui";
import { formatDay, formatTime, price } from "@/lib/format";

export const metadata: Metadata = { title: "All orders" };

const HOW: Record<string, string> = { online: "Online", payment_link: "Payment link", cash: "Cash", bank_transfer: "Organiser's account", complimentary: "Complimentary" };
const STATUS: Record<string, string> = { pending: "Awaiting payment", paid: "Paid", expired: "Expired", cancelled: "Cancelled", refunded: "Refunded", partially_refunded: "Part refunded" };
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PAGE = 100;

type Props = { searchParams: Promise<{ q?: string; org?: string; event?: string; status?: string; how?: string; review?: string; before?: string }> };

export default async function AdminOrdersPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { q = "", org = "", event = "", status = "", how = "", review = "", before = "" } = sp;
  const filter: Record<string, unknown> = {};
  const term = q.trim().slice(0, 80);
  if (term) {
    const rx = new RegExp(escapeRegex(term), "i");
    filter.$or = [{ publicId: rx }, { "customer.email": rx }, { "customer.name": rx }];
  }
  if (Types.ObjectId.isValid(org)) filter.organizerId = new Types.ObjectId(org);
  if (Types.ObjectId.isValid(event)) filter.eventId = new Types.ObjectId(event);
  if (STATUS[status]) filter.status = status;
  if (how === "online" || how === "payment_link") filter.source = how;
  else if (["cash", "bank_transfer", "complimentary"].includes(how)) filter["offline.method"] = how;
  if (review === "1") filter.needsReview = true;
  if (Types.ObjectId.isValid(before)) filter._id = { $lt: new Types.ObjectId(before) };

  const [rows, organisers, events] = await Promise.all([
    Order.find(filter).sort({ _id: -1 }).limit(PAGE + 1).lean(),
    Organizer.find({}, { name: 1, slug: 1 }).sort({ name: 1 }).lean(),
    Event.find({ deletedAt: null, ...(Types.ObjectId.isValid(org) ? { organizerId: new Types.ObjectId(org) } : {}) }, { title: 1 }).sort({ startsAt: -1 }).lean(),
  ]);
  const orders = rows.slice(0, PAGE);
  const next = rows.length > PAGE ? String(orders.at(-1)!._id) : null;
  const orgBy = new Map(organisers.map((o) => [String(o._id), o]));
  const eventBy = new Map(events.map((e) => [String(e._id), e.title]));
  const reviewCount = await Order.countDocuments({ needsReview: true });
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), ...extra }).toString();

  return (
    <>
      <PageHeader
        title="All orders"
        description="Every booking across all organisers, newest first."
        actions={
          <div className="flex flex-wrap gap-3 text-sm">
            <a href={`/admin/export/orders?${qs({})}`} className="font-semibold text-brand-orange-strong hover:underline">
              Download orders (CSV)
            </a>
          </div>
        }
      />
      {reviewCount > 0 && review !== "1" && (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          {reviewCount} {reviewCount === 1 ? "order needs" : "orders need"} review.{" "}
          <Link href="/admin/orders?review=1" className="font-semibold text-brand-orange-strong hover:underline">
            Show them
          </Link>
        </p>
      )}
      {/* One line on laptops and wider; a tidy two-column grid on smaller screens. */}
      <form className="mb-4 grid grid-cols-2 gap-3 lg:flex lg:items-center" role="search">
        <label className="sr-only" htmlFor="q">
          Search
        </label>
        <input id="q" name="q" defaultValue={q} placeholder="Order ref, name or email" className={`${inputClass} h-11 col-span-2 mt-0! min-w-0 lg:flex-1`} />
        <label className="sr-only" htmlFor="org">
          Organiser
        </label>
        <select id="org" name="org" defaultValue={org} className={`${inputClass} h-11 mt-0! min-w-0 lg:w-40! lg:shrink-0`}>
          <option value="">All organisers</option>
          {organisers.map((o) => (
            <option key={String(o._id)} value={String(o._id)}>
              {o.name}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="event">
          Event
        </label>
        <select id="event" name="event" defaultValue={event} className={`${inputClass} h-11 mt-0! min-w-0 lg:w-44! lg:shrink-0`}>
          <option value="">All events</option>
          {events.map((e) => (
            <option key={String(e._id)} value={String(e._id)}>
              {e.title}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue={status} className={`${inputClass} h-11 mt-0! min-w-0 lg:w-36! lg:shrink-0`}>
          <option value="">Any status</option>
          {Object.entries(STATUS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="how">
          How sold
        </label>
        <select id="how" name="how" defaultValue={how} className={`${inputClass} h-11 mt-0! min-w-0 lg:w-40! lg:shrink-0`}>
          <option value="">Any payment type</option>
          {Object.entries(HOW).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {review === "1" && <input type="hidden" name="review" value="1" />}
        <button type="submit" className="col-span-2 rounded-full border border-border bg-card h-11 px-5 font-semibold lg:shrink-0">
          Search
        </button>
      </form>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Organiser and event</th>
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Paid by</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.map((o) => {
              const organiser = orgBy.get(String(o.organizerId));
              return (
                <tr key={String(o._id)} className="hover:bg-muted/60">
                  <td className="px-4 py-3">
                    {organiser ? (
                      <Link href={`/org/${organiser.slug}/orders/${o.publicId}`} className="font-semibold text-brand-orange-strong hover:underline">
                        {o.publicId}
                      </Link>
                    ) : (
                      o.publicId
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {formatDay(o.createdAt as Date)}, {formatTime(o.createdAt as Date)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {organiser?.name ?? "—"}
                    <span className="block text-xs text-muted-foreground">{eventBy.get(String(o.eventId)) ?? ""}</span>
                  </td>
                  <td className="px-4 py-3">
                    {o.customer?.name}
                    <span className="block text-xs text-muted-foreground">{o.customer?.email}</span>
                  </td>
                  <td className="px-4 py-3">{HOW[o.offline?.method ?? o.source] ?? o.source}</td>
                  <td className="px-4 py-3">
                    {STATUS[o.status ?? "pending"]}
                    {o.needsReview && <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">Needs review</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{price(o.totalPence)}</td>
                </tr>
              );
            })}
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
      <div className="mt-4 flex gap-4 text-sm">
        {before && (
          <Link href={`/admin/orders?${qs({ before: "" })}`} className="font-semibold text-brand-orange-strong hover:underline">
            Newest
          </Link>
        )}
        {next && (
          <Link href={`/admin/orders?${qs({ before: next })}`} className="font-semibold text-brand-orange-strong hover:underline">
            Older orders
          </Link>
        )}
      </div>
    </>
  );
}
