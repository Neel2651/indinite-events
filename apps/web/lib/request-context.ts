import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { runWithContext, type Actor } from "@indinite/core/context";

/**
 * Wrap every server action / route handler that changes state:
 *   return withRequestContext({ type: "user", id, email, role }, () => service(...))
 * so audited() can record who, from where, and which request.
 */
export async function withRequestContext<T>(
  actor: Actor,
  fn: () => Promise<T>,
  organizerId?: string,
): Promise<T> {
  const h = await headers();
  return runWithContext(
    {
      requestId: h.get("x-request-id") ?? h.get("x-vercel-id") ?? randomUUID(),
      actor,
      organizerId,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: h.get("user-agent") ?? undefined,
    },
    fn,
  );
}
