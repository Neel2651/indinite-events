/**
 * Read-only booking funnel for one event (SPEC §4.11, OM Events brief 5 Oct 2026): did people submit the details
 * form, did Stripe's page open, did they pay? Safe on the live server; prints no customer details.
 *
 *   pnpm funnel <event-slug>                    # since the event's first order
 *   pnpm funnel <event-slug> -- --since 2026-10-04
 */
import { connectDb, disconnectDb, Event, Order } from "../src";

const args = process.argv.slice(2);
const slug = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "--since");
const sinceArg = args.includes("--since") ? args[args.indexOf("--since") + 1] : undefined;
if (sinceArg && Number.isNaN(Date.parse(sinceArg))) {
  console.error("--since must be a date like 2026-10-04");
  process.exit(1);
}
if (!slug) {
  console.error("Usage: pnpm funnel <event-slug> [-- --since YYYY-MM-DD]");
  process.exit(1);
}

await connectDb();
const event = await Event.findOne({ slug }, { title: 1, metaPixelId: 1, metaCapiTokenHint: 1, metaTestEventCode: 1 }).lean();
if (!event) {
  console.error(`No event with web address /e/${slug}`);
  await disconnectDb();
  process.exit(1);
}
const since = sinceArg ? new Date(`${sinceArg}T00:00:00Z`) : new Date(0);
const orders = await Order.find(
  { eventId: event._id, createdAt: { $gte: since } },
  { source: 1, status: 1, createdAt: 1, paidAt: 1, totalPence: 1, "stripe.checkoutSessionId": 1, metaCapi: 1, couponCode: 1 },
).lean();

const count = (f: (o: (typeof orders)[number]) => boolean) => orders.filter(f).length;
const website = orders.filter((o) => o.source === "online" || o.source === "payment_link");
const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;

console.log(`${event.title} (/e/${slug})${sinceArg ? ` since ${sinceArg}` : ""}\n`);
console.log("Website bookings (details form submitted → order created):");
console.log(`  Orders created:          ${website.length}  (online ${count((o) => o.source === "online")}, payment links ${count((o) => o.source === "payment_link")})`);
console.log(`  Stripe payment page made: ${website.filter((o) => o.stripe?.checkoutSessionId).length}`);
console.log(`  Paid:                    ${website.filter((o) => o.status === "paid" || o.status === "partially_refunded").length}  (${gbp(website.filter((o) => o.paidAt).reduce((n, o) => n + o.totalPence, 0))})`);
console.log(`  Still waiting to pay:    ${website.filter((o) => o.status === "pending").length}`);
console.log(`  Expired without paying:  ${website.filter((o) => o.status === "expired").length}`);
console.log(`  With a coupon:           ${website.filter((o) => o.couponCode).length}`);
console.log(`Box office / offline:      ${count((o) => o.source === "offline")}\n`);

console.log("Meta:");
console.log(`  Pixel: ${event.metaPixelId ?? "none"} · server token: ${event.metaCapiTokenHint ? `saved (…${event.metaCapiTokenHint})` : "none"}${event.metaTestEventCode ? ` · TEST MODE (${event.metaTestEventCode})` : ""}`);
console.log(`  Server Purchase sent: ${website.filter((o) => o.metaCapi?.sentAt && !o.metaCapi.test).length} · test only: ${website.filter((o) => o.metaCapi?.test).length}\n`);

// By hour (London), to line up with Meta's InitiateCheckout / AddPaymentInfo counts.
const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", hour: "2-digit" });
const byHour = new Map<string, { created: number; paid: number; expired: number }>();
for (const o of website) {
  const k = hour.format(o.createdAt as Date);
  const row = byHour.get(k) ?? { created: 0, paid: 0, expired: 0 };
  row.created++;
  if (o.paidAt) row.paid++;
  if (o.status === "expired") row.expired++;
  byHour.set(k, row);
}
if (byHour.size) {
  console.log("By hour (London): created / paid / expired");
  for (const [k, r] of byHour) console.log(`  ${k}:00  ${r.created} / ${r.paid} / ${r.expired}`);
} else {
  console.log("No website orders: nobody has submitted the details form for this event. Check the booking form on a phone.");
}
console.log("\nWhy checkouts were refused shows in the web app's logs: pm2 logs | grep '\\[checkout\\] refused'");
await disconnectDb();
