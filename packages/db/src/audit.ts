import type { ClientSession, Types } from "mongoose";
import { diffForAudit } from "@indinite/core";
import { requireContext } from "@indinite/core/context";
import { AuditLog } from "./models/audit-log";

export type AuditEntityType =
  | "event"
  | "ticketType"
  | "organizer"
  | "order"
  | "ticket"
  | "discount"
  | "member"
  | "scan"
  | "refund";

export interface AuditInput {
  action: string; // e.g. "order.issued_offline", "event.updated"
  entity: { type: AuditEntityType; id: string | Types.ObjectId };
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string;
  organizerId?: string | Types.ObjectId;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit entry, written in the SAME transaction as the change it describes.
 * Actor, IP and requestId come from the request context, never from callers.
 */
export async function audited(session: ClientSession, input: AuditInput): Promise<void> {
  const ctx = requireContext();
  await AuditLog.create(
    [
      {
        actor: ctx.actor,
        organizerId: input.organizerId ?? ctx.organizerId,
        action: input.action,
        entity: { type: input.entity.type, id: String(input.entity.id) },
        changes: diffForAudit(input.before ?? null, input.after ?? null),
        reason: input.reason,
        metadata: input.metadata,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      },
    ],
    { session },
  );
}
