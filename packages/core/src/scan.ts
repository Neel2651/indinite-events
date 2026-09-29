import { base64urlToBytes } from "./base64url";
import { verifyTicketToken } from "./qr";

/**
 * Gate decision, made on the scanning device (works offline, SPEC §4.5):
 * signature → manifest → ticket status → valid for tonight → already scanned tonight.
 */
export type ScanResult = "admitted" | "already_used" | "invalid" | "wrong_session" | "too_early" | "cancelled" | "manual_admit";

/**
 * Gates open 1 hour before a night starts (agreed 29 Sep 2026): a 4:00 pm night admits from 3:00 pm UK time.
 * Earlier scans are refused ("too_early"), with no override. Night times are stored in UTC, so BST/GMT is
 * handled by the Date itself.
 */
export const GATES_OPEN_BEFORE_MS = 60 * 60_000;

export function gatesOpenAt(nightStartsAt: Date | string): Date {
  return new Date(new Date(nightStartsAt).getTime() - GATES_OPEN_BEFORE_MS);
}

export function isTooEarly(nightStartsAt: Date | string, now: Date): boolean {
  return now.getTime() < gatesOpenAt(nightStartsAt).getTime();
}

export interface ManifestTicket {
  id: string;
  /** passCode() without the dash, for manual entry. */
  code: string;
  status: "valid" | "cancelled" | "refunded";
  validSessionIds: string[];
  ticketTypeName: string;
  attendeeName?: string | null;
  orderRef: string;
  /** "Pass 2 of 3" */
  position: number;
  count: number;
}

export interface PriorAdmission {
  scannedAt: string | Date;
  gate: string;
}

export type ScanDecision =
  | { result: "admitted"; ticket: ManifestTicket }
  | { result: "already_used"; ticket: ManifestTicket; prior: PriorAdmission }
  | { result: "wrong_session"; ticket: ManifestTicket }
  | { result: "too_early"; ticket: ManifestTicket; opensAt: Date }
  | { result: "cancelled"; ticket: ManifestTicket }
  | { result: "invalid"; reason: "unreadable" | "bad_signature" | "unknown_ticket"; ticketId?: string };

export interface ScanInput {
  /** Raw QR text. */
  token: string;
  publicKeyHex: string;
  sessionId: string;
  findTicket: (ticketId: string) => ManifestTicket | undefined;
  /** Earlier admission of this ticket tonight (this device or synced from others). */
  findAdmission: (ticketId: string, sessionId: string) => PriorAdmission | undefined;
  /** When tonight's night starts; with `now`, passes are refused until gates open (GATES_OPEN_BEFORE_MS before). */
  nightStartsAt?: Date | string;
  now?: Date;
}

export function decideScan(input: ScanInput): ScanDecision {
  const verified = verifyTicketToken(input.token, input.publicKeyHex);
  if (!verified.ok) return { result: "invalid", reason: verified.reason === "bad_signature" ? "bad_signature" : "unreadable" };
  return decideForTicket(verified.ticketId, input);
}

/** Same checks for a ticket found by hand (short code), skipping the signature. */
export function decideForTicket(ticketId: string, input: Omit<ScanInput, "token" | "publicKeyHex">): ScanDecision {
  const ticket = input.findTicket(ticketId);
  if (!ticket) return { result: "invalid", reason: "unknown_ticket", ticketId };
  if (ticket.status !== "valid") return { result: "cancelled", ticket };
  if (!ticket.validSessionIds.includes(input.sessionId)) return { result: "wrong_session", ticket };
  if (input.nightStartsAt && isTooEarly(input.nightStartsAt, input.now ?? new Date())) return { result: "too_early", ticket, opensAt: gatesOpenAt(input.nightStartsAt) };
  const prior = input.findAdmission(ticketId, input.sessionId);
  if (prior) return { result: "already_used", ticket, prior };
  return { result: "admitted", ticket };
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Code printed under each QR for typing in by hand ("XXXX-XXXX"). Derived from the first 40 bits of the
 * pass's Ed25519 signature, so it can't be guessed from another pass (ticket ids are sequential; signatures
 * aren't predictable without the private key). Returns "" for unreadable tokens.
 */
export function passCode(qrToken: string): string {
  const sig = qrToken.split(".")[2];
  if (!sig) return "";
  let bytes: Uint8Array;
  try {
    bytes = base64urlToBytes(sig);
  } catch {
    return "";
  }
  if (bytes.length < 5) return "";
  let bits = 0n;
  for (let i = 0; i < 5; i++) bits = (bits << 8n) | BigInt(bytes[i]!);
  let code = "";
  for (let i = 7; i >= 0; i--) code += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Accept what staff type: any case, spaces/dashes, and O/0, I/L/1 mix-ups. Returns 8 chars or "". */
export function normalisePassCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(cleaned) ? cleaned : "";
}

/**
 * Offline safety limit: a device may decide at most this many scans on its own (no signal, or the server
 * didn't answer). After that it refuses to scan until it's back online and those scans have synced.
 */
export const OFFLINE_SCAN_LIMIT = 5;

/** Offline scans still allowed, given how many offline scans are waiting to sync. */
export function offlineScansLeft(pendingOffline: number, limit = OFFLINE_SCAN_LIMIT): number {
  return Math.max(0, limit - pendingOffline);
}
