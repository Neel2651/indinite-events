/** Everything a ticket email or pass needs. Built by the worker from the order; no DB access here. */
export interface TicketsEmailData {
  publicId: string;
  customerName: string;
  event: {
    title: string;
    startsAt: Date;
    endsAt: Date;
    venue: { name: string; address: string; postcode: string };
  };
  /** Receipt lines (tickets, discount, platform fee, charges, tax); discount lines are negative. */
  lines: { label: string; amountPence: number; negative?: boolean }[];
  totalPence: number;
  tickets: PassData[];
  /** Signed "View tickets" link (valid 30 minutes). */
  viewUrl: string;
  /** Demo payments mode: say so in the email. */
  demo: boolean;
  reason: "paid" | "offline_issued" | "resend";
}

export interface PassData {
  ticketId: string;
  ticketTypeName: string;
  /** "All 9 nights", "Fri 16 Oct", … */
  nightsLabel: string;
  /** Inline email image reference (cid:…). */
  qrContentId: string;
  /** PNG of the QR code, for the PDF pass. */
  qrPng: Buffer;
  /** Short human-readable code for manual lookup at the gate. */
  shortCode: string;
}
