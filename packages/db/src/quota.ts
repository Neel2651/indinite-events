import type { ClientSession, Types } from "mongoose";
import { commitHoldOp, releaseHoldOp, reserveOp, returnSoldOp, sellDirectOp, setQuotaOp } from "@indinite/core";
import { TicketType } from "./models/ticket-type";

export class SoldOutError extends Error {
  readonly status = 409;
  constructor(readonly ticketTypeId: string) {
    super("Not enough tickets left for this ticket type");
  }
}

type Id = string | Types.ObjectId;
type Op = { filter: Record<string, unknown>; update: Record<string, unknown> };

/** Held/sold counters would go negative: a bug or a double-processed event. Never swallow this. */
export class QuotaInvariantError extends Error {
  readonly status = 500;
  constructor(readonly ticketTypeId: string, op: string) {
    super(`Quota invariant violated during ${op} for ticket type ${ticketTypeId}`);
  }
}

async function apply(op: Op, id: Id, onFail: () => Error, session?: ClientSession): Promise<void> {
  const res = await TicketType.updateOne(op.filter, op.update, { session });
  if (res.modifiedCount !== 1) throw onFail();
}

const soldOut = (id: Id) => () => new SoldOutError(String(id));
const invariant = (id: Id, op: string) => () => new QuotaInvariantError(String(id), op);

/** The new quota is below what's already sold or held. */
export class QuotaTooLowError extends Error {
  readonly status = 409;
  constructor(readonly ticketTypeId: string) {
    super("The quota can't be lower than the passes already sold or held");
  }
}

export const quota = {
  /** Admin: set the quota, atomically refused if sold + held would exceed it. */
  set: async (id: Id, value: number, s?: ClientSession) => {
    const op = setQuotaOp(id, value);
    const res = await TicketType.updateOne(op.filter, op.update, { session: s });
    if (res.matchedCount !== 1) throw new QuotaTooLowError(String(id));
  },
  reserve: (id: Id, qty: number, s?: ClientSession) => apply(reserveOp(id, qty), id, soldOut(id), s),
  sellDirect: (id: Id, qty: number, s?: ClientSession) => apply(sellDirectOp(id, qty), id, soldOut(id), s),
  commitHold: (id: Id, qty: number, s?: ClientSession) =>
    apply(commitHoldOp(id, qty), id, invariant(id, "commitHold"), s),
  releaseHold: (id: Id, qty: number, s?: ClientSession) =>
    apply(releaseHoldOp(id, qty), id, invariant(id, "releaseHold"), s),
  returnSold: (id: Id, qty: number, s?: ClientSession) =>
    apply(returnSoldOp(id, qty), id, invariant(id, "returnSold"), s),
};
