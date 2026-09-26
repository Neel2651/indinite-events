import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/** Server-only. Who is doing what, set once per request/job and read by audited(). */
export type ActorType = "user" | "customer" | "system" | "stripe";

export interface Actor {
  type: ActorType;
  id?: string;
  email?: string;
  role?: string;
}

export interface RequestContext {
  requestId: string;
  actor: Actor;
  organizerId?: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(
  ctx: Omit<RequestContext, "requestId"> & { requestId?: string },
  fn: () => T,
): T {
  return storage.run({ requestId: ctx.requestId ?? randomUUID(), ...ctx }, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requireContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("No request context: wrap the handler/job in runWithContext()");
  return ctx;
}

export const systemActor: Actor = { type: "system", id: "system" };
export const stripeActor: Actor = { type: "stripe", id: "stripe" };
