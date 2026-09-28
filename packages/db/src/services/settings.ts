import { DEFAULT_FREE_COMPLIMENTARY_PASSES } from "@indinite/core";

import { z } from "zod";
import { audited } from "../audit";
import { CommissionLedger } from "../models/commission-ledger";
import { Discount } from "../models/discount";
import { Event } from "../models/event";
import { Organizer } from "../models/organizer";
import { withTransaction } from "../transaction";

/**
 * Pricing and finance settings (SPEC §4.7). Callers check permissions first:
 * finance.manage (super admin) for commission/tax/settlements, event.manageCharges / coupon.manage for organisers.
 * organizerId always comes from the signed-in user's organiser, never the form.
 */

export class SettingsError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

const bps = z.number().int().min(0).max(10000);

export async function setOrganizerCommission(organizerId: string, commissionBps: number) {
  const value = bps.parse(commissionBps);
  return withTransaction(async (session) => {
    const before = await Organizer.findById(organizerId, { commissionBps: 1 }, { session }).lean();
    if (!before) throw new SettingsError("Organiser not found.", 404);
    await Organizer.updateOne({ _id: organizerId }, { $set: { commissionBps: value } }, { session });
    await audited(session, { action: "organizer.commission_changed", entity: { type: "organizer", id: organizerId }, before: { commissionBps: before.commissionBps }, after: { commissionBps: value }, organizerId });
  });
}

/** Admin: event commission override (null = use the organiser's rate), tax rate and free complimentary passes. */
export async function setEventPricing(eventId: string, input: { commissionBps: number | null; taxBps: number; freeComplimentaryPasses?: number }) {
  const data = z.object({ commissionBps: bps.nullable(), taxBps: bps, freeComplimentaryPasses: z.number().int().min(0).max(10000).optional() }).parse(input);
  if (data.freeComplimentaryPasses === undefined) delete data.freeComplimentaryPasses;
  return withTransaction(async (session) => {
    const before = await Event.findById(eventId, { commissionBps: 1, taxBps: 1, freeComplimentaryPasses: 1, organizerId: 1 }, { session }).lean();
    if (!before) throw new SettingsError("Event not found.", 404);
    await Event.updateOne({ _id: eventId }, { $set: data }, { session });
    await audited(session, {
      action: "event.pricing_changed",
      entity: { type: "event", id: eventId },
      before: { commissionBps: before.commissionBps ?? null, taxBps: before.taxBps ?? 0, freeComplimentaryPasses: before.freeComplimentaryPasses ?? DEFAULT_FREE_COMPLIMENTARY_PASSES },
      after: data,
      organizerId: before.organizerId,
    });
  });
}

export const chargeSchema = z.object({
  name: z.string().trim().min(1, "Give the charge a name").max(60),
  kind: z.enum(["fixed", "percent"]),
  value: z.number().int().min(0).max(100_000),
});

/** Organiser: replace the per-ticket charges on one of their events. */
export async function setEventCharges(organizerId: string, eventId: string, charges: z.infer<typeof chargeSchema>[]) {
  const data = z.array(chargeSchema).max(10).parse(charges);
  for (const c of data) if (c.kind === "percent" && c.value > 10000) throw new SettingsError(`${c.name}: percentage can't be over 100%.`);
  return withTransaction(async (session) => {
    const before = await Event.findOne({ _id: eventId, organizerId }, { charges: 1 }, { session }).lean();
    if (!before) throw new SettingsError("Event not found.", 404);
    await Event.updateOne({ _id: eventId }, { $set: { charges: data } }, { session });
    await audited(session, { action: "event.charges_changed", entity: { type: "event", id: eventId }, before: { charges: before.charges ?? [] }, after: { charges: data }, organizerId });
  });
}

export const couponInputSchema = z.object({
  code: z.string().trim().min(3, "Codes need at least 3 characters").max(40).regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, - and _ only").transform((c) => c.toUpperCase()),
  eventId: z.string().regex(/^[a-f0-9]{24}$/).nullable(),
  kind: z.enum(["percent", "fixed"]),
  value: z.number().int().min(1),
  maxUses: z.number().int().min(1).nullable(),
  validFrom: z.coerce.date().nullable(),
  validTo: z.coerce.date().nullable(),
});

export async function createCoupon(organizerId: string, createdBy: string, input: z.input<typeof couponInputSchema>) {
  const data = couponInputSchema.parse(input);
  if (data.kind === "percent" && data.value > 10000) throw new SettingsError("A percentage can't be over 100%.");
  if (data.eventId && !(await Event.exists({ _id: data.eventId, organizerId }))) throw new SettingsError("Event not found.", 404);
  if (await Discount.exists({ organizerId, code: data.code })) throw new SettingsError(`${data.code} already exists.`, 409);
  return withTransaction(async (session) => {
    const [coupon] = await Discount.create([{ ...data, organizerId, createdBy }], { session });
    await audited(session, { action: "coupon.created", entity: { type: "discount", id: coupon!._id }, after: coupon!.toObject(), organizerId });
    return coupon!.toObject();
  });
}

/** Stop a coupon working now (keeps history; bookings already made keep their discount). */
export async function endCoupon(organizerId: string, couponId: string) {
  return withTransaction(async (session) => {
    const coupon = await Discount.findOne({ _id: couponId, organizerId }, null, { session }).lean();
    if (!coupon) throw new SettingsError("Coupon not found.", 404);
    const now = new Date();
    await Discount.updateOne({ _id: couponId }, { $set: { validTo: now } }, { session });
    await audited(session, { action: "coupon.ended", entity: { type: "discount", id: couponId }, before: { validTo: coupon.validTo ?? null }, after: { validTo: now }, organizerId });
  });
}

/** Admin: record commission received from an organiser for an event (any amount, e.g. part payment). */
export async function recordCommissionPayment(eventId: string, recordedBy: string, amountPence: number, note: string) {
  const amount = z.number().int().min(1, "Enter an amount").parse(amountPence);
  const cleanNote = z.string().trim().min(3, "Add a note (e.g. bank reference)").max(300).parse(note);
  return withTransaction(async (session) => {
    const event = await Event.findById(eventId, { organizerId: 1 }, { session }).lean();
    if (!event) throw new SettingsError("Event not found.", 404);
    const [entry] = await CommissionLedger.create(
      [{ organizerId: event.organizerId, eventId: event._id, amountPence: amount, kind: "settled", note: cleanNote, recordedBy }],
      { session },
    );
    await audited(session, {
      action: "commission.payment_recorded",
      entity: { type: "organizer", id: event.organizerId },
      after: { eventId: String(event._id), amountPence: amount },
      reason: cleanNote,
      organizerId: event.organizerId,
      metadata: { ledgerId: String(entry!._id) },
    });
  });
}

