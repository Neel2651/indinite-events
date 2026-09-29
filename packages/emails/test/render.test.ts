import { describe, expect, it } from "vitest";
import { buildPassesData, groupPassesByNight, renderInvitationEmail, renderPassesPdf, renderResetPasswordEmail, renderTicketsEmail, type TicketsEmailData } from "../src";

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
    { ticketId: "a".repeat(24), ticketTypeName: "Season pass — adult", nightsLabel: "All 9 nights", qrContentId: "qr-1", qrPng: png, shortCode: "AAAA-AAAA", nightKey: "multi", nightDate: "", nightSort: 0 },
    { ticketId: "b".repeat(24), ticketTypeName: "Season pass — adult", nightsLabel: "All 9 nights", qrContentId: "qr-2", qrPng: png, shortCode: "BBBB-BBBB", nightKey: "multi", nightDate: "", nightSort: 0 },
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

describe("passes split by night (30 Sep 2026)", () => {
  const n = (id: string, iso: string) => ({ _id: id, startsAt: new Date(iso) });
  const sessions = [n("n1", "2026-10-11T15:00:00Z"), n("n2", "2026-10-12T15:00:00Z"), n("n4", "2026-10-14T15:00:00Z")];
  const signed = (id: string) => `v1.${id}.${Buffer.alloc(64, id.charCodeAt(0)).toString("base64url")}`;
  const t = (id: string, name: string, nights: string[]) => ({ _id: id, ticketTypeName: name, validSessionIds: nights, qrToken: signed(id) });

  it("groups one-night passes by night in order, then season passes as All nights, with the date on each pass", async () => {
    const d = await buildPassesData({
      order: { publicId: "NAV-7K3F9Q", customer: { name: "Asha" }, items: [], totalPence: 0 },
      event: { title: "Garba", startsAt: sessions[0]!.startsAt, endsAt: sessions[2]!.startsAt, venue: { name: "Hall", address: "1 Road", postcode: "E1 1AA" }, sessions },
      tickets: [t("s", "Season", ["n1", "n2", "n4"]), t("d", "Day · Wed 14 Oct", ["n4"]), t("a", "Day · Sun 11 Oct", ["n1"]), t("b", "Day · Sun 11 Oct", ["n1"]), t("c", "Day · Mon 12 Oct", ["n2"])],
      viewUrl: "http://x",
      demo: false,
      reason: "paid",
    });
    const groups = groupPassesByNight(d.tickets);
    expect(groups.map((g) => [g.title, g.fileLabel, g.tickets.length])).toEqual([
      ["Sun 11 Oct", "Sun-11-Oct", 2],
      ["Mon 12 Oct", "Mon-12-Oct", 1],
      ["Wed 14 Oct", "Wed-14-Oct", 1],
      ["All nights", "All-nights", 1],
    ]);
    expect(groups[0]!.tickets[0]!.nightDate).toBe("SUN 11 OCT · 16:00");
    const html = (await renderTicketsEmail(d)).html.replace(/<!-- -->/g, "");
    expect(html).toContain("Sun 11 Oct · 2 passes");
    expect(html).toContain("SUN 11 OCT · 16:00 · Pass 1 of 2");
    const pdf = await renderPassesPdf({ ...d, tickets: groups[0]!.tickets }, groups[0]!.title);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);
});
