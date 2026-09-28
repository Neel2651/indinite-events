import mongoose, { Types } from "mongoose";
import { passCode } from "@indinite/core";
import { AuditLog } from "../models/audit-log";
import { Event } from "../models/event";
import { Order } from "../models/order";
import { Scan } from "../models/scan";
import { Ticket } from "../models/ticket";

export interface TimelineEntry {
  at: Date;
  kind: "created" | "payment_link" | "paid" | "issued_offline" | "ticket_issued" | "emailed" | "scan" | "refund" | "other";
  title: string;
  detail?: string;
  by?: string;
  ticketId?: string;
  tone?: "success" | "warning" | "danger" | "neutral";
}

const METHOD = { cash: "cash", bank_transfer: "the organiser's account", complimentary: "complimentary" } as Record<string, string>;
const SCAN_TITLE: Record<string, [string, TimelineEntry["tone"]]> = {
  admitted: ["Scanned in", "success"],
  manual_admit: ["Let in by override", "warning"],
  already_used: ["Refused: already scanned", "warning"],
  wrong_session: ["Refused: wrong night", "danger"],
  cancelled: ["Refused: cancelled", "danger"],
  invalid: ["Refused: invalid", "danger"],
};

/** Staff names for audit/scan actors (Better Auth "user" collection). */
async function userNames(ids: string[]): Promise<Map<string, string>> {
  const valid = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
  if (!valid.length) return new Map();
  const users = await mongoose.connection.db!.collection("user")
    .find({ _id: { $in: valid.map((id) => new Types.ObjectId(id)) } }, { projection: { name: 1 } })
    .toArray();
  return new Map(users.map((u) => [String(u._id), String(u.name)]));
}

/**
 * Order + per-ticket history for organisers/admins: how it was sold and by whom, when passes were
 * generated and emailed, and every scan (time, gate, who scanned). Scoped by organiserId.
 */
export async function getOrderHistory(organizerId: string, publicId: string) {
  const order = await Order.findOne({ publicId, organizerId }).lean();
  if (!order) return null;
  const [event, tickets] = await Promise.all([
    Event.findById(order.eventId, { title: 1, sessions: 1 }).lean(),
    Ticket.find({ orderId: order._id }).sort({ _id: 1 }).lean(),
  ]);
  const ticketIds = tickets.map((t) => String(t._id));
  const [orderAudits, ticketAudits, scans] = await Promise.all([
    AuditLog.find({ "entity.type": "order", "entity.id": String(order._id) }).sort({ createdAt: 1 }).lean(),
    AuditLog.find({ "entity.type": "ticket", "entity.id": { $in: ticketIds } }).sort({ createdAt: 1 }).lean(),
    Scan.find({ ticketId: { $in: tickets.map((t) => t._id) } }).sort({ scannedAt: 1 }).lean(),
  ]);
  const names = await userNames([
    ...orderAudits.map((a) => a.actor?.id ?? ""),
    ...ticketAudits.map((a) => a.actor?.id ?? ""),
    ...scans.map((s) => s.scannerUserId),
  ]);
  const sessionLabel = new Map((event?.sessions ?? []).map((s) => [String(s._id), s.label]));
  const actorName = (a: { actor?: { type?: string | null; id?: string | null } | null }) =>
    a.actor?.type === "customer" ? "Customer" : a.actor?.type === "system" ? "Indinite (automatic)" : a.actor?.type === "stripe" ? "Stripe" : (names.get(a.actor?.id ?? "") ?? "Staff");

  const orderEntries: TimelineEntry[] = orderAudits.map((a) => {
    const at = a.createdAt as Date;
    const by = actorName(a);
    switch (a.action) {
      case "order.created":
        return { at, kind: "created", title: "Booking started online", by, tone: "neutral" };
      case "order.payment_link_created":
        return { at, kind: "payment_link", title: "Payment link created", by, tone: "neutral" };
      case "order.paid":
        return { at, kind: "paid", title: a.reason === "demo_payment" ? "Paid (demo mode, no money taken)" : "Paid by card", by, tone: "success" };
      case "order.issued_offline": {
        const method = String((a.metadata as { method?: string } | undefined)?.method ?? "");
        return { at, kind: "issued_offline", title: `Issued by staff, paid by ${METHOD[method] ?? method}`, detail: a.reason ?? undefined, by, tone: "success" };
      }
      case "order.tickets_sent":
        return { at, kind: "emailed", title: a.reason === "resend" ? "Passes emailed again" : "Passes emailed to customer", by, tone: "neutral" };
      case "order.checkout_started":
        return { at, kind: "other", title: "Card checkout started", by, tone: "neutral" };
      case "order.refunded": {
        const m = (a.metadata ?? {}) as { amountPence?: number; tickets?: number; method?: string };
        const amount = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format((m.amountPence ?? 0) / 100);
        const how = m.method === "stripe" ? "to card" : m.method === "outside_indinite" ? "repaid by the organiser" : "passes cancelled";
        return { at, kind: "refund", title: `Refunded ${amount} (${m.tickets ?? 0} pass${m.tickets === 1 ? "" : "es"}, ${how})`, detail: a.reason ?? undefined, by, tone: "warning" };
      }
      case "order.late_payment_refunded":
        return { at, kind: "refund", title: "Refunded in full: passes sold out while the payment was completing", by, tone: "danger" };
      case "order.resend_requested":
        return { at, kind: "emailed", title: "Staff asked to email the passes again", by, tone: "neutral" };
      case "order.hold_released":
        return { at, kind: "other", title: "Booking expired unpaid; passes released", by, tone: "warning" };
      default:
        return { at, kind: "other", title: a.action, by, detail: a.reason ?? undefined, tone: "neutral" };
    }
  });

  const perTicket = tickets.map((t, i) => {
    const id = String(t._id);
    const entries: TimelineEntry[] = [
      ...ticketAudits
        .filter((a) => a.entity?.id === id)
        .map((a) => ({
          at: a.createdAt as Date,
          kind: (a.action === "ticket.refunded" ? "refund" : "ticket_issued") as TimelineEntry["kind"],
          title: a.action === "ticket.issued" ? "Pass generated" : a.action === "ticket.refunded" ? "Refunded (no longer valid at the gate)" : a.action,
          detail: a.action === "ticket.refunded" ? (a.reason ?? undefined) : undefined,
          by: actorName(a),
          ticketId: id,
          tone: (a.action === "ticket.refunded" ? "warning" : "neutral") as TimelineEntry["tone"],
        })),
      ...scans
        .filter((s) => String(s.ticketId) === id)
        .map((s) => {
          const [title, tone] = SCAN_TITLE[s.result] ?? [s.result, "neutral"];
          return {
            at: s.scannedAt,
            kind: "scan" as const,
            title,
            detail: [sessionLabel.get(String(s.sessionId)), s.gate, s.reason].filter(Boolean).join(" · "),
            by: names.get(s.scannerUserId) ?? "Scanner",
            ticketId: id,
            tone,
          };
        }),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    return { id, code: passCode(t.qrToken), position: i + 1, ticketTypeName: t.ticketTypeName, status: t.status ?? "valid", validSessionIds: t.validSessionIds.map(String), entries };
  });

  return { order, event, orderEntries, tickets: perTicket };
}
