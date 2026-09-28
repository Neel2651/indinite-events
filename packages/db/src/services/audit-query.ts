import { Types } from "mongoose";
import { AuditLog } from "../models/audit-log";
import { Organizer } from "../models/organizer";
import { userNames } from "./timeline";

/**
 * Audit log views (SPEC §2): global for super admins (`audit.readGlobal`), own organiser for owners
 * (`audit.read`, pass `organizerId` from the session). Newest first, 100 per page, cursor = last entry id.
 */
export interface AuditQuery {
  organizerId?: string;
  /** Exact action ("order.refunded") or a prefix ending in "." ("order."). */
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  before?: string;
  limit?: number;
}

export interface AuditEntry {
  id: string;
  at: Date;
  actor: { type: string; id: string | null; name: string };
  organizer: { id: string; name: string } | null;
  action: string;
  entity: { type: string; id: string };
  changes: { path: string; before: unknown; after: unknown }[];
  reason: string | null;
  metadata: Record<string, unknown> | null;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function listAuditLogs(q: AuditQuery): Promise<{ entries: AuditEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 200);
  const filter: Record<string, unknown> = {};
  if (q.organizerId) filter.organizerId = new Types.ObjectId(q.organizerId);
  if (q.action) filter.action = q.action.endsWith(".") ? { $regex: `^${escapeRegex(q.action)}` } : q.action;
  if (q.entityType) filter["entity.type"] = q.entityType;
  if (q.entityId) filter["entity.id"] = q.entityId;
  if (q.actorId) filter["actor.id"] = q.actorId;
  const created: Record<string, Date> = {};
  if (q.from) created.$gte = q.from;
  if (q.to) created.$lt = q.to;
  if (Object.keys(created).length) filter.createdAt = created;
  if (q.before && Types.ObjectId.isValid(q.before)) filter._id = { $lt: new Types.ObjectId(q.before) };

  const rows = await AuditLog.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const page = rows.slice(0, limit);
  const [names, orgs] = await Promise.all([
    userNames(page.map((r) => r.actor?.id ?? "").filter(Boolean)),
    Organizer.find({ _id: { $in: [...new Set(page.map((r) => String(r.organizerId ?? "")).filter((id) => Types.ObjectId.isValid(id)))] } }, { name: 1 }).lean(),
  ]);
  const orgName = new Map(orgs.map((o) => [String(o._id), o.name]));
  const actorName = (a: { type?: string | null; id?: string | null; email?: string | null } | null | undefined) =>
    a?.type === "customer" ? "Customer" : a?.type === "system" ? "Indinite (automatic)" : a?.type === "stripe" ? "Stripe" : (names.get(a?.id ?? "") ?? "Staff");

  return {
    entries: page.map((r) => ({
      id: String(r._id),
      at: r.createdAt as Date,
      actor: { type: r.actor?.type ?? "user", id: r.actor?.id ?? null, name: actorName(r.actor) },
      organizer: r.organizerId ? { id: String(r.organizerId), name: orgName.get(String(r.organizerId)) ?? "Unknown organiser" } : null,
      action: r.action,
      entity: { type: r.entity?.type ?? "", id: r.entity?.id ?? "" },
      changes: (r.changes ?? []).map((c) => ({ path: c.path ?? "", before: c.before, after: c.after })),
      reason: r.reason ?? null,
      metadata: (r.metadata as Record<string, unknown> | undefined) ?? null,
    })),
    nextCursor: rows.length > limit ? String(page.at(-1)!._id) : null,
  };
}

/** Distinct action names, for the filter dropdown. */
export async function auditActions(organizerId?: string): Promise<string[]> {
  const actions = await AuditLog.distinct("action", organizerId ? { organizerId: new Types.ObjectId(organizerId) } : {});
  return (actions as string[]).sort();
}
