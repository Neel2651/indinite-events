import { describe, expect, it } from "vitest";
import { renderInvitationEmail, renderPassesPdf, renderResetPasswordEmail, renderTicketsEmail, type TicketsEmailData } from "../src";

// 1×1 transparent PNG.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const data: TicketsEmailData = {
  publicId: "NAV-7K3F9Q",
  customerName: "Asha Patel",
  event: {
    title: "Navratri 2026 — London Garba Nights",
    startsAt: new Date(Date.UTC(2026, 9, 11, 18, 30)),
    endsAt: new Date(Date.UTC(2026, 9, 19, 22, 30)),
    venue: { name: "Demo Hall", address: "1 Example Road, London", postcode: "E1 1AA" },
  },
  lines: [
    { label: "2 × Season pass — adult", amountPence: 9000 },
    { label: "Platform fee (6%)", amountPence: 540 },
  ],
  totalPence: 9540,
  tickets: [
    { ticketId: "a".repeat(24), ticketTypeName: "Season pass — adult", nightsLabel: "All 9 nights", qrContentId: "qr-1", qrPng: png, shortCode: "AAAA-AAAA" },
    { ticketId: "b".repeat(24), ticketTypeName: "Season pass — adult", nightsLabel: "All 9 nights", qrContentId: "qr-2", qrPng: png, shortCode: "BBBB-BBBB" },
  ],
  viewUrl: "http://localhost:3001/orders/NAV-7K3F9Q?t=abc",
  demo: true,
  reason: "paid",
};

describe("ticket email", () => {
  it("renders the order, one inline QR per pass and the view link", async () => {
    const email = await renderTicketsEmail(data);
    expect(email.subject).toBe("You're going! Your passes for Navratri 2026 — London Garba Nights");
    expect(email.html).toContain("NAV-7K3F9Q");
    expect(email.html).toContain('src="cid:qr-1"');
    expect(email.html).toContain('src="cid:qr-2"');
    expect(email.html).toContain("11–19 October 2026");
    expect(email.html).toContain("£90.00");
    expect(email.html).toContain("Platform fee (6%)");
    expect(email.html).toContain("£95.40");
    expect(email.html).toContain("Demo booking: no payment was taken.");
    expect(email.html).toContain(data.viewUrl.replace("&", "&amp;"));
    expect(email.text).toContain("NAV-7K3F9Q");
  });

  it("uses a resend subject", async () => {
    expect((await renderTicketsEmail({ ...data, reason: "resend", demo: false })).subject).toBe(
      "Your passes for Navratri 2026 — London Garba Nights (NAV-7K3F9Q)",
    );
  });
});

describe("pass PDF", () => {
  it("renders a PDF", async () => {
    const pdf = await renderPassesPdf(data);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30_000);
});

describe("staff emails", () => {
  it("renders an invitation", async () => {
    const e = await renderInvitationEmail({ organizationName: "Demo Garba Ltd", role: "Box office", inviterName: "Olivia", url: "http://x/invite/abc" });
    expect(e.subject).toBe("You're invited to Demo Garba Ltd on Indinite Events");
    expect(e.html).toContain("http://x/invite/abc");
    expect(e.html).toContain("Box office");
  });
  it("renders a password reset", async () => {
    const e = await renderResetPasswordEmail({ name: "Olivia Owner", url: "http://x/reset?token=1" });
    expect(e.html).toContain("http://x/reset?token=1");
    expect(e.text).toContain("1 hour");
  });
});
