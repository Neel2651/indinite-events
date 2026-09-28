import { Types } from "mongoose";
import { formatLondonDateTime, passCode, penceToPounds, toCsv, type CsvCell } from "@indinite/core";
import { audited } from "../audit";
import { Event } from "../models/event";
import { Order } from "../models/order";
import { Organizer } from "../models/organizer";
import { Scan } from "../models/scan";
import { Ticket } from "../models/ticket";
import { withTransaction } from "../transaction";
import { userNames } from "./timeline";

/**
 * CSV exports and printed gate lists (M8/M9). Contain personal data, so every download or print is audited.
 * `organizerId` comes from the session (organiser panel) or is null for super admin exports across organisers.
 */
export type ExportKind = "orders" | "attendees" | "checkins";
export const EXPORT_KINDS: readonly ExportKind[] = ["orders", "attendees", "checkins"];

export interface ExportScope {
  organizerId: string | null;
  eventId?: string | null;
}

const HOW: Record<string, string> = { online: "Online (card)", payment_link: "Payment link", cash: "Cash", bank_transfer: "Organiser's account", complimentary: "Complimentary" };

async function scopedEvents(scope: ExportScope) {
  const filter: Record<string, unknown> = {};
  if (scope.organizerId) filter.organizerId = new Types.ObjectId(scope.organizerId);
  if (scope.eventId) {
    if (!Types.ObjectId.isValid(scope.eventId)) return [];
    filter._id = new Types.ObjectId(scope.eventId);
  }
  return Event.find(filter, { title: 1, organizerId: 1, sessions: 1 }).lean();
}

export async function buildExport(kind: ExportKind, scope: ExportScope): Promise<{ filename: string; csv: string; rows: number }> {
  const events = await scopedEvents(scope);
  const eventIds = events.map((e) => e._id);
  const eventBy = new Map(events.map((e) => [String(e._id), e]));
  const orgs = await Organizer.find({ _id: { $in: [...new Set(events.map((e) => String(e.organizerId)))] } }, { name: 1 }).lean();
  const orgName = new Map(orgs.map((o) => [String(o._id), o.name]));
  const nightLabel = (eventId: string, ids: unknown[]) => {
    const sessions = eventBy.get(eventId)?.sessions ?? [];
    if (ids.length === sessions.length && sessions.length > 1) return "All nights";
    return ids.map((id) => sessions.find((s) => String(s._id) === String(id))?.label ?? "").filter(Boolean).join("; ");
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = scope.eventId && events[0] ? `-${events[0].title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}` : "";
  let header: string[];
  let rows: CsvCell[][];

  if (kind === "orders") {
    const orders = await Order.find({ eventId: { $in: eventIds } }).sort({ createdAt: 1 }).lean();
    header = ["Order ref", "Created (UK)", "Paid (UK)", "Status", "Organiser", "Event", "How sold", "Customer name", "Customer email", "Customer phone", "Passes", "Tickets (£)", "Discount (£)", "Discount reason", "Platform fee (£)", "Organiser charges (£)", "Tax (£)", "Card processing fee (£)", "Total (£)", "Refunded (£)", "Indinite commission (£)", "Note"];
    rows = orders.map((o) => [
      o.publicId,
      formatLondonDateTime(o.createdAt as Date),
      o.paidAt ? formatLondonDateTime(o.paidAt) : "",
      o.status,
      orgName.get(String(o.organizerId)) ?? "",
      eventBy.get(String(o.eventId))?.title ?? "",
      HOW[o.offline?.method ?? o.source ?? ""] ?? o.source,
      o.customer?.name ?? "",
      o.customer?.email ?? "",
      o.customer?.phone ?? "",
      o.items.reduce((n, i) => n + i.qty, 0),
      penceToPounds(o.subtotalPence),
      penceToPounds(o.discount?.amountPence ?? 0),
      o.discount?.reason ?? "",
      penceToPounds(o.platformFeePence),
      penceToPounds(o.chargesPence),
      penceToPounds(o.taxPence),
      penceToPounds(o.cardFeePence),
      penceToPounds(o.totalPence),
      penceToPounds(o.refundedPence),
      penceToPounds(o.applicationFeePence),
      o.offline?.note ?? o.cancellation?.reason ?? "",
    ]);
  } else if (kind === "attendees") {
    const tickets = await Ticket.find({ eventId: { $in: eventIds } }).sort({ orderId: 1, _id: 1 }).lean();
    const orders = await Order.find({ _id: { $in: [...new Set(tickets.map((t) => String(t.orderId)))] } }, { publicId: 1, customer: 1 }).lean();
    const orderBy = new Map(orders.map((o) => [String(o._id), o]));
    header = ["Pass code", "Pass type", "Valid nights", "Status", "Attendee", "Customer name", "Customer email", "Order ref", "Event"];
    rows = tickets.map((t) => {
      const o = orderBy.get(String(t.orderId));
      return [passCode(t.qrToken), t.ticketTypeName, nightLabel(String(t.eventId), t.validSessionIds), t.status, t.attendeeName ?? "", o?.customer?.name ?? "", o?.customer?.email ?? "", o?.publicId ?? "", eventBy.get(String(t.eventId))?.title ?? ""];
    });
  } else {
    const scans = await Scan.find({ eventId: { $in: eventIds } }).sort({ scannedAt: 1 }).lean();
    const tickets = await Ticket.find({ _id: { $in: [...new Set(scans.map((s) => String(s.ticketId)))] } }, { qrToken: 1, ticketTypeName: 1, orderId: 1 }).lean();
    const ticketBy = new Map(tickets.map((t) => [String(t._id), t]));
    const orders = await Order.find({ _id: { $in: [...new Set(tickets.map((t) => String(t.orderId)))] } }, { publicId: 1 }).lean();
    const refBy = new Map(orders.map((o) => [String(o._id), o.publicId]));
    const names = await userNames(scans.map((s) => s.scannerUserId));
    header = ["Scanned (UK)", "Event", "Night", "Gate", "Result", "Pass code", "Pass type", "Order ref", "Scanned by", "Reason"];
    rows = scans.map((s) => {
      const t = ticketBy.get(String(s.ticketId));
      const ev = eventBy.get(String(s.eventId));
      return [
        formatLondonDateTime(s.scannedAt),
        ev?.title ?? "",
        ev?.sessions.find((x) => String(x._id) === String(s.sessionId))?.label ?? "",
        s.gate,
        s.result,
        t ? passCode(t.qrToken) : "",
        t?.ticketTypeName ?? "",
        t ? (refBy.get(String(t.orderId)) ?? "") : "",
        names.get(s.scannerUserId) ?? "Scanner",
        s.reason ?? "",
      ];
    });
  }
  return { filename: `indinite-${kind}${suffix}-${stamp}.csv`, csv: toCsv(header, rows), rows: rows.length };
}

/** Audit that personal data left the system (download or printed list). */
export async function recordExport(input: { kind: ExportKind | "print"; scope: ExportScope; rows: number; organizerId?: string | null; detail?: Record<string, unknown> }) {
  await withTransaction((session) =>
    audited(session, {
      action: input.kind === "print" ? "report.printed" : "export.downloaded",
      entity: { type: "report", id: input.scope.eventId || input.scope.organizerId || "all" },
      organizerId: input.organizerId ?? input.scope.organizerId ?? undefined,
      metadata: { kind: input.kind, eventId: input.scope.eventId ?? null, rows: input.rows, ...input.detail },
    }),
  );
}

export interface GateSheet {
  gate: number;
  from: string;
  to: string;
  rows: { code: string; name: string; type: string; orderRef: string }[];
}

/**
 * Printable fallback list for one night (M9): valid passes for that night, sorted by surname, split
 * alphabetically into `gates` sheets of roughly equal size (passes aren't assigned to gates).
 */
export async function gatePrintList(organizerId: string, eventId: string, sessionId: string, gates: number) {
  if (!Types.ObjectId.isValid(eventId) || !Types.ObjectId.isValid(sessionId)) return null;
  const event = await Event.findOne({ _id: eventId, organizerId: new Types.ObjectId(organizerId), deletedAt: null }, { title: 1, sessions: 1, venue: 1 }).lean();
  const night = event?.sessions.find((s) => String(s._id) === sessionId);
  if (!event || !night) return null;
  const tickets = await Ticket.find({ eventId: event._id, status: "valid", validSessionIds: night._id }, { qrToken: 1, ticketTypeName: 1, attendeeName: 1, orderId: 1 }).lean();
  const orders = await Order.find({ _id: { $in: [...new Set(tickets.map((t) => String(t.orderId)))] } }, { publicId: 1, customer: 1 }).lean();
  const orderBy = new Map(orders.map((o) => [String(o._id), o]));
  const surname = (n: string) => (n.trim().split(/\s+/).at(-1) ?? "").toLowerCase();
  const rows = tickets
    .map((t) => {
      const o = orderBy.get(String(t.orderId));
      return { code: passCode(t.qrToken), name: t.attendeeName || o?.customer?.name || "", type: t.ticketTypeName, orderRef: o?.publicId ?? "" };
    })
    .sort((a, b) => surname(a.name).localeCompare(surname(b.name), "en-GB") || a.name.localeCompare(b.name, "en-GB") || a.orderRef.localeCompare(b.orderRef));
  const n = Math.min(Math.max(Math.trunc(gates) || 1, 1), 12);
  const initial = (r?: { name: string }) => (surname(r?.name ?? "")[0] ?? "").toUpperCase();
  // Cut only where the surname's first letter changes, so each gate gets a clean letter range ("A–H") and
  // a family or group on one booking is never split across gates.
  const chunks: (typeof rows)[] = [];
  let start = 0;
  for (let g = 0; g < n && start < rows.length; g++) {
    const left = n - g;
    if (left === 1) {
      chunks.push(rows.slice(start));
      break;
    }
    const target = start + Math.ceil((rows.length - start) / left);
    let cut = target;
    while (cut < rows.length && initial(rows[cut]) === initial(rows[cut - 1])) cut++;
    chunks.push(rows.slice(start, cut));
    start = cut;
  }
  if (!chunks.length) chunks.push([]);
  const sheets: GateSheet[] = chunks.map((chunk, i) => ({ gate: i + 1, from: i === 0 ? "A" : initial(chunk[0]) || "A", to: i === chunks.length - 1 ? "Z" : initial(chunk.at(-1)) || "Z", rows: chunk }));
  return { event: { id: String(event._id), title: event.title, venue: event.venue.name }, night: { id: String(night._id), label: night.label, startsAt: night.startsAt }, total: rows.length, sheets };
}
