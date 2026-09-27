import { Types } from "mongoose";
import { normalisePassCode, passCode, verifyTicketToken, type ManifestTicket, type ScanResult } from "@indinite/core";
import { audited } from "../audit";
import { Event } from "../models/event";
import { Order } from "../models/order";
import { Scan } from "../models/scan";
import { Ticket } from "../models/ticket";
import { withTransaction } from "../transaction";

export interface ScanManifest {
  event: { id: string; organizerId: string; title: string; sessions: { id: string; label: string; startsAt: string; endsAt: string }[] };
  tickets: ManifestTicket[];
  admissions: Admission[];
  generatedAt: string;
}

export interface Admission {
  ticketId: string;
  sessionId: string;
  scannedAt: string;
  gate: string;
}

async function admissionsFor(eventId: Types.ObjectId, since?: Date): Promise<Admission[]> {
  const scans = await Scan.find(
    { eventId, result: { $in: ["admitted", "manual_admit"] }, ...(since ? { syncedAt: { $gt: since } } : {}) },
    { ticketId: 1, sessionId: 1, scannedAt: 1, gate: 1 },
  ).lean();
  return scans.map((s) => ({ ticketId: String(s.ticketId), sessionId: String(s.sessionId), scannedAt: s.scannedAt.toISOString(), gate: s.gate }));
}

/**
 * Everything a gate device needs to decide offline (SPEC §4.5). Deliberately minimal personal data:
 * pass type, order ref and attendee name only — no emails or phone numbers.
 */
export async function getScanManifest(eventId: string): Promise<ScanManifest | null> {
  if (!Types.ObjectId.isValid(eventId)) return null;
  const event = await Event.findOne({ _id: eventId, deletedAt: null }).lean();
  if (!event) return null;
  const tickets = await Ticket.find({ eventId: event._id }, { orderId: 1, status: 1, validSessionIds: 1, ticketTypeName: 1, attendeeName: 1, qrToken: 1 })
    .sort({ orderId: 1, _id: 1 })
    .lean();
  const orders = await Order.find({ _id: { $in: [...new Set(tickets.map((t) => String(t.orderId)))] } }, { publicId: 1 }).lean();
  const refById = new Map(orders.map((o) => [String(o._id), o.publicId]));
  const countByOrder = new Map<string, number>();
  for (const t of tickets) countByOrder.set(String(t.orderId), (countByOrder.get(String(t.orderId)) ?? 0) + 1);
  const seen = new Map<string, number>();

  return {
    event: {
      id: String(event._id),
      organizerId: String(event.organizerId),
      title: event.title,
      sessions: event.sessions.map((s) => ({ id: String(s._id), label: s.label, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
    },
    tickets: tickets.map((t) => {
      const order = String(t.orderId);
      const position = (seen.get(order) ?? 0) + 1;
      seen.set(order, position);
      return {
        id: String(t._id),
        // The code only, never the QR token itself.
        code: normalisePassCode(passCode(t.qrToken)),
        status: (t.status ?? "valid") as ManifestTicket["status"],
        validSessionIds: t.validSessionIds.map(String),
        ticketTypeName: t.ticketTypeName,
        attendeeName: t.attendeeName ?? null,
        orderRef: refById.get(order) ?? "",
        position,
        count: countByOrder.get(order) ?? 1,
      };
    }),
    admissions: await admissionsFor(event._id),
    generatedAt: new Date().toISOString(),
  };
}

export interface IncomingScan {
  clientScanId: string;
  ticketId?: string | null;
  sessionId: string;
  gate: string;
  deviceId: string;
  result: ScanResult;
  reason?: string;
  scannedAt: string;
}

export interface SyncedScan {
  clientScanId: string;
  /** Final result after conflict resolution (e.g. admitted → already_used if another gate won). */
  result: ScanResult;
  prior?: { scannedAt: string; gate: string };
}

const isDuplicateKey = (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === 11000;

/**
 * Store scans from a device (idempotent per clientScanId) and resolve conflicts server-side:
 * the first admission of a ticket per night wins; later ones are recorded as already_used.
 * Manual admits need a reason and are audited. Returns final results plus admissions from other devices.
 */
export async function syncScans(input: {
  eventId: string;
  scannerUserId: string;
  canManualAdmit: boolean;
  scans: IncomingScan[];
  since?: string;
}): Promise<{ results: SyncedScan[]; admissions: Admission[]; serverTime: string }> {
  const event = await Event.findById(input.eventId, { organizerId: 1, sessions: 1 }).lean();
  if (!event) throw new Error("Event not found");
  const sessionIds = new Set(event.sessions.map((s) => String(s._id)));
  const serverTime = new Date();
  const results: SyncedScan[] = [];

  for (const s of input.scans) {
    const existing = await Scan.findOne({ clientScanId: s.clientScanId }, { result: 1 }).lean();
    if (existing) {
      results.push({ clientScanId: s.clientScanId, result: existing.result as ScanResult });
      continue;
    }
    if (!sessionIds.has(s.sessionId)) continue; // not this event: drop
    const ticketId = s.ticketId && Types.ObjectId.isValid(s.ticketId) ? new Types.ObjectId(s.ticketId) : undefined;
    const ticket = ticketId ? await Ticket.findOne({ _id: ticketId, eventId: event._id }, { status: 1, validSessionIds: 1 }).lean() : null;

    let result: ScanResult = s.result;
    let reason = s.reason?.slice(0, 300);
    if (result === "manual_admit" && (!input.canManualAdmit || !reason || !ticket)) result = ticket ? "already_used" : "invalid";
    // The device decided offline; re-check against the server's copy of the ticket.
    if (result === "admitted") {
      if (!ticket) result = "invalid";
      else if (ticket.status !== "valid") result = "cancelled";
      else if (!ticket.validSessionIds.map(String).includes(s.sessionId)) result = "wrong_session";
      if (result !== "admitted") reason = `device admitted offline; server says ${result}`;
    }

    const doc = {
      clientScanId: s.clientScanId,
      ticketId: ticket?._id,
      eventId: event._id,
      sessionId: new Types.ObjectId(s.sessionId),
      gate: s.gate.slice(0, 60),
      deviceId: s.deviceId.slice(0, 80),
      scannerUserId: input.scannerUserId,
      result,
      reason,
      scannedAt: new Date(s.scannedAt),
      syncedAt: serverTime,
    };

    try {
      if (result === "manual_admit") {
        await withTransaction(async (session) => {
          const [scan] = await Scan.create([doc], { session });
          await audited(session, {
            action: "scan.manual_admit",
            entity: { type: "scan", id: scan!._id },
            after: { ticketId: String(ticket!._id), sessionId: s.sessionId, gate: doc.gate },
            reason,
            organizerId: event.organizerId,
          });
        });
      } else {
        await Scan.create(doc);
      }
      results.push({ clientScanId: s.clientScanId, result });
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      // Duplicate clientScanId from a concurrent retry, or another gate admitted this ticket tonight first.
      const again = await Scan.findOne({ clientScanId: s.clientScanId }, { result: 1 }).lean();
      if (again) {
        results.push({ clientScanId: s.clientScanId, result: again.result as ScanResult });
        continue;
      }
      const first = await Scan.findOne({ ticketId: ticket!._id, sessionId: doc.sessionId, result: { $in: ["admitted", "manual_admit"] } }).lean();
      await Scan.create({ ...doc, result: "already_used", reason: `already admitted at ${first?.gate ?? "another gate"}` });
      results.push({
        clientScanId: s.clientScanId,
        result: "already_used",
        prior: first ? { scannedAt: first.scannedAt.toISOString(), gate: first.gate } : undefined,
      });
    }
  }

  const since = input.since ? new Date(input.since) : undefined;
  return { results, admissions: await admissionsFor(event._id, since && !Number.isNaN(since.getTime()) ? since : undefined), serverTime: serverTime.toISOString() };
}

/** Live entry counts per night and gate, for the organiser's gate dashboard. */
export async function gateStats(eventId: string) {
  const event = await Event.findById(eventId, { sessions: 1 }).lean();
  if (!event) return null;
  const rows = await Scan.aggregate<{ _id: { sessionId: Types.ObjectId; gate: string; result: string }; n: number; last: Date }>([
    { $match: { eventId: event._id } },
    { $group: { _id: { sessionId: "$sessionId", gate: "$gate", result: "$result" }, n: { $sum: 1 }, last: { $max: "$scannedAt" } } },
  ]);
  const passesBySession = await Ticket.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { eventId: event._id, status: "valid" } },
    { $unwind: "$validSessionIds" },
    { $group: { _id: "$validSessionIds", n: { $sum: 1 } } },
  ]);
  const passes = new Map(passesBySession.map((p) => [String(p._id), p.n]));
  return event.sessions.map((s) => {
    const mine = rows.filter((r) => String(r._id.sessionId) === String(s._id));
    const gates = [...new Set(mine.map((r) => r._id.gate))].sort().map((gate) => {
      const g = mine.filter((r) => r._id.gate === gate);
      const count = (res: string[]) => g.filter((r) => res.includes(r._id.result)).reduce((n, r) => n + r.n, 0);
      return {
        gate,
        admitted: count(["admitted", "manual_admit"]),
        manual: count(["manual_admit"]),
        refused: count(["already_used", "invalid", "wrong_session", "cancelled"]),
        lastScanAt: g.reduce<Date | null>((m, r) => (!m || r.last > m ? r.last : m), null),
      };
    });
    return {
      sessionId: String(s._id),
      label: s.label,
      startsAt: s.startsAt,
      expected: passes.get(String(s._id)) ?? 0,
      admitted: gates.reduce((n, g) => n + g.admitted, 0),
      gates,
    };
  });
}

export interface ClaimInput {
  eventId: string;
  sessionId: string;
  gate: string;
  deviceId: string;
  scannerUserId: string;
  clientScanId: string;
  /** Raw QR text, or… */
  token?: string;
  /** …a code typed in by hand (normalised or not). */
  code?: string;
  publicKeyHex: string;
}

export interface ClaimResult {
  result: ScanResult;
  reason?: "unreadable" | "bad_signature" | "unknown_ticket";
  ticketId?: string;
  prior?: { scannedAt: string; gate: string };
}

/**
 * Online gate check (SPEC §4.5, strict once-only): the SERVER verifies the signature, the ticket, the night,
 * and atomically records the admission before the device shows green. Concurrent claims for the same pass
 * and night can only produce one "admitted" (unique partial index); the rest get "already_used".
 * Idempotent per clientScanId, so a device retrying after a timeout gets the same answer.
 */
export async function claimScan(input: ClaimInput): Promise<ClaimResult> {
  const previous = await Scan.findOne({ clientScanId: input.clientScanId }).lean();
  if (previous) return resultFromScan(previous);

  const event = await Event.findById(input.eventId, { sessions: 1 }).lean();
  if (!event || !event.sessions.some((s) => String(s._id) === input.sessionId)) return { result: "invalid", reason: "unknown_ticket" };
  const sessionId = new Types.ObjectId(input.sessionId);

  let ticketId: Types.ObjectId | undefined;
  let invalidReason: ClaimResult["reason"];
  if (input.token) {
    const v = verifyTicketToken(input.token, input.publicKeyHex);
    if (v.ok) ticketId = new Types.ObjectId(v.ticketId);
    else invalidReason = v.reason === "bad_signature" ? "bad_signature" : "unreadable";
  } else if (input.code) {
    const code = normalisePassCode(input.code);
    const found = code ? await Ticket.find({ eventId: event._id, passCode: code }, { _id: 1 }).limit(2).lean() : [];
    if (found.length === 1) ticketId = found[0]!._id;
    else invalidReason = "unknown_ticket";
  }

  const ticket = ticketId ? await Ticket.findOne({ _id: ticketId, eventId: event._id }, { status: 1, validSessionIds: 1 }).lean() : null;
  if (ticketId && !ticket) invalidReason = "unknown_ticket";

  let result: ScanResult;
  if (!ticket) result = "invalid";
  else if (ticket.status !== "valid") result = "cancelled";
  else if (!ticket.validSessionIds.some((s) => String(s) === input.sessionId)) result = "wrong_session";
  else result = "admitted";

  const doc = {
    clientScanId: input.clientScanId,
    ticketId: ticket?._id,
    eventId: event._id,
    sessionId,
    gate: input.gate.slice(0, 60),
    deviceId: input.deviceId.slice(0, 80),
    scannerUserId: input.scannerUserId,
    result,
    reason: invalidReason,
    scannedAt: new Date(),
    syncedAt: new Date(),
  };

  if (result !== "admitted") {
    await Scan.create(doc).catch(() => {});
    return { result, reason: invalidReason, ticketId: ticket ? String(ticket._id) : undefined };
  }
  try {
    await Scan.create(doc);
    return { result: "admitted", ticketId: String(ticket!._id) };
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    const again = await Scan.findOne({ clientScanId: input.clientScanId }).lean();
    if (again) return resultFromScan(again);
    const first = await Scan.findOne({ ticketId: ticket!._id, sessionId, result: { $in: ["admitted", "manual_admit"] } }).lean();
    await Scan.create({ ...doc, result: "already_used", reason: `already admitted at ${first?.gate ?? "another gate"}` }).catch(() => {});
    return {
      result: "already_used",
      ticketId: String(ticket!._id),
      prior: first ? { scannedAt: first.scannedAt.toISOString(), gate: first.gate } : undefined,
    };
  }
}

async function resultFromScan(scan: { result: string; ticketId?: Types.ObjectId | null; sessionId: Types.ObjectId; reason?: string | null }): Promise<ClaimResult> {
  const result = scan.result as ScanResult;
  if (result === "already_used" && scan.ticketId) {
    const first = await Scan.findOne({ ticketId: scan.ticketId, sessionId: scan.sessionId, result: { $in: ["admitted", "manual_admit"] } }).lean();
    return { result, ticketId: String(scan.ticketId), prior: first ? { scannedAt: first.scannedAt.toISOString(), gate: first.gate } : undefined };
  }
  return { result, ticketId: scan.ticketId ? String(scan.ticketId) : undefined, reason: (scan.reason as ClaimResult["reason"]) ?? undefined };
}
