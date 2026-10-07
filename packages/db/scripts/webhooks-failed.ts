/**
 * Stripe webhook events that failed and were never processed (the worker's "[reconcile] … failed" warning).
 * Shows each one's error and what Stripe says it was about, then lets you retry it or mark it as not ours.
 * Prints no customer details or secrets.
 *
 *   pnpm webhooks:failed                         # list (read-only)
 *   pnpm webhooks:failed -- --retry evt_123      # fetch it from Stripe again and process it (safe: idempotent)
 *   pnpm webhooks:failed -- --ignore evt_123     # not for Indinite (e.g. another app on the same Stripe account)
 */
import mongoose from "mongoose";
import Stripe from "stripe";
import { connectDb, disconnectDb, handleStripeEvent, Order, Organizer, WebhookEvent } from "../src";
import { ask } from "./prompt";

const args = process.argv.slice(2);
const retryId = args.includes("--retry") ? args[args.indexOf("--retry") + 1] : undefined;
const ignoreId = args.includes("--ignore") ? args[args.indexOf("--ignore") + 1] : undefined;
const key = process.env.STRIPE_SECRET_KEY ?? "";
const stripe = /^(sk|rk)_(test|live)_/.test(key) ? new Stripe(key) : null;

await connectDb();

/** The event as Stripe has it (platform, or the connected account it came from). */
async function fetchEvent(id: string, account?: string | null): Promise<Stripe.Event | null> {
  if (!stripe) return null;
  try {
    return await stripe.events.retrieve(id, {}, account ? { stripeAccount: account } : undefined);
  } catch {
    return null;
  }
}

/** What the event was about, in our terms. */
async function describe(event: Stripe.Event): Promise<string[]> {
  const lines = [`Stripe: ${event.livemode ? "live" : "test"} mode, created ${new Date(event.created * 1000).toISOString()}${event.account ? `, account ${event.account}` : ", platform"}`];
  const obj = event.data.object as unknown as Record<string, unknown>;
  if (event.type.startsWith("checkout.session.")) {
    const meta = (obj.metadata ?? {}) as Record<string, string>;
    const ref = (obj.client_reference_id as string | null) ?? null;
    lines.push(`Checkout session ${String(obj.id)}: payment ${String(obj.payment_status)}, metadata publicId ${meta.publicId ?? "none"}, orderId ${meta.orderId ?? "none"}, client_reference_id ${ref ? "set" : "none"}`);
    const orderId = meta.orderId ?? ref;
    if (!meta.publicId && !meta.orderId) lines.push("→ Not created by Indinite (no order metadata): probably another app or site on the same Stripe account.");
    else if (orderId && mongoose.isValidObjectId(orderId)) {
      const order = await Order.findById(orderId, { publicId: 1, status: 1 }).lean();
      lines.push(order ? `→ Our order ${order.publicId}, now ${order.status}` : "→ No such order in this database (another server, e.g. staging, on the same Stripe account?)");
    } else lines.push("→ The order id isn't one of ours.");
  } else if (event.type.startsWith("account.")) {
    const accountId = (event.account ?? (obj.id as string)) || "";
    const org = await Organizer.findOne({ stripeAccountId: accountId }, { name: 1 }).lean();
    lines.push(org ? `→ Organiser ${org.name}` : "→ No organiser uses this account in this database");
  } else if (event.type === "charge.refunded") {
    lines.push(`Charge ${String(obj.id)}, payment ${String(obj.payment_intent ?? "none")}`);
  }
  return lines;
}

if (retryId || ignoreId) {
  const id = (retryId ?? ignoreId)!;
  const doc = await WebhookEvent.findOne({ stripeEventId: id }).lean();
  if (!doc) {
    console.error(`No webhook event ${id} in this database.`);
    await disconnectDb();
    process.exit(1);
  }
  if (doc.processedAt) {
    console.log(`${id} was already processed on ${doc.processedAt.toISOString()}. Nothing to do.`);
    await disconnectDb();
    process.exit(0);
  }
  if (retryId) {
    const event = await fetchEvent(id, doc.account);
    if (!event) {
      console.error(`Stripe doesn't return ${id}${stripe ? "" : " (STRIPE_SECRET_KEY isn't set)"}. If it came from a connected account, it may need that account.`);
      await disconnectDb();
      process.exit(1);
    }
    try {
      await handleStripeEvent(event);
      console.log(`✓ ${id} (${event.type}) processed.`);
    } catch (e) {
      console.error(`✗ ${id} still fails: ${e instanceof Error ? e.message : e}`);
    }
  } else {
    if ((await ask(`Mark ${id} (${doc.type}) as not for Indinite, so it stops being reported? (y/N) `)).toLowerCase() === "y") {
      await WebhookEvent.updateOne({ stripeEventId: id, processedAt: null }, { $set: { processedAt: new Date(), error: `ignored by hand: ${doc.error ?? ""}`.slice(0, 500) } });
      console.log(`✓ ${id} marked as ignored.`);
    } else console.log("Nothing changed.");
  }
  await disconnectDb();
  process.exit(0);
}

const failed = await WebhookEvent.find({ processedAt: null, error: { $ne: null } }).sort({ receivedAt: 1 }).lean();
if (!failed.length) console.log("✓ No failed Stripe webhook events.");
for (const w of failed) {
  console.log(`\n${w.type}  ${w.stripeEventId}${w.account ? `  (account ${w.account})` : ""}`);
  console.log(`  Received ${w.receivedAt?.toISOString()}`);
  console.log(`  Error: ${w.error}`);
  const event = await fetchEvent(w.stripeEventId, w.account);
  if (event) for (const line of await describe(event)) console.log(`  ${line}`);
  else console.log(`  (Couldn't fetch it from Stripe${stripe ? "" : ": STRIPE_SECRET_KEY isn't set"}.)`);
}
if (failed.length) console.log("\nRetry one: pnpm webhooks:failed -- --retry <evt_id>   ·   Not ours: pnpm webhooks:failed -- --ignore <evt_id>");
await disconnectDb();
process.exit(0);
