import type { ClientSession, Types } from "mongoose";
import { commitHoldOp, releaseHoldOp, reserveOp, returnSoldOp, sellDirectOp } from "@indinite/core";
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

export const quota = {
  reserve: (id: Id, qty: number, s?: ClientSession) => apply(reserveOp(id, qty), id, soldOut(id), s),
  sellDirect: (id: Id, qty: number, s?: ClientSession) => apply(sellDirectOp(id, qty), id, soldOut(id), s),
  commitHold: (id: Id, qty: number, s?: ClientSession) =>
    apply(commitHoldOp(id, qty), id, invariant(id, "commitHold"), s),
  releaseHold: (id: Id, qty: number, s?: ClientSession) =>
    apply(releaseHoldOp(id, qty), id, invariant(id, "releaseHold"), s),
  returnSold: (id: Id, qty: number, s?: ClientSession) =>
    apply(returnSoldOp(id, qty), id, invariant(id, "returnSold"), s),
};
