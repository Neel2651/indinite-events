import { describe, expect, it } from "vitest";
import { ORG_ROLES, PERMISSIONS, ROLE_PERMISSIONS, can, maxDiscountBps, type AuthUser } from "../src";

const ORG_A = { organizerId: "orgA" };
const ORG_B = { organizerId: "orgB" };
const user = (role: (typeof ORG_ROLES)[number]): AuthUser => ({
  id: "u1",
  isSuperAdmin: false,
  memberships: [{ organizerId: "orgA", role }],
});
const superAdmin: AuthUser = { id: "sa", isSuperAdmin: true, memberships: [] };

describe("can()", () => {
  it("never grants organizer permissions across organizations", () => {
    for (const role of ORG_ROLES) {
      for (const p of PERMISSIONS) expect(can(user(role), p, ORG_B)).toBe(false);
    }
  });

  it("requires a resource for organizer permissions", () => {
    expect(can(user("owner"), "order.read")).toBe(false);
  });

  it("keeps event and ticket management platform-only", () => {
    for (const role of ORG_ROLES) {
      for (const p of ["event.create", "event.update", "event.delete", "ticketType.manage", "organizer.manage", "audit.readGlobal"] as const) {
        expect(can(user(role), p, ORG_A)).toBe(false);
      }
    }
    expect(can(superAdmin, "event.create")).toBe(true);
  });

  it("matches the SPEC matrix for key actions", () => {
    expect(can(user("box_office"), "order.issueOffline", ORG_A)).toBe(true);
    expect(can(user("box_office"), "order.applyDiscount", ORG_A)).toBe(false);
    expect(can(user("box_office"), "order.refund", ORG_A)).toBe(false);
    expect(can(user("manager"), "order.refund", ORG_A)).toBe(false);
    expect(can(user("owner"), "order.refund", ORG_A)).toBe(true);
    expect(can(user("scanner"), "scan.perform", ORG_A)).toBe(true);
    expect(can(user("scanner"), "order.read", ORG_A)).toBe(false);
    expect(can(user("scanner"), "scan.manualAdmit", ORG_A)).toBe(false);
    expect(can(user("finance"), "reports.read", ORG_A)).toBe(true);
    expect(can(user("finance"), "order.createPaymentLink", ORG_A)).toBe(false);
    expect(can(user("owner"), "stripe.onboard", ORG_A)).toBe(true);
    expect(can(user("manager"), "stripe.onboard", ORG_A)).toBe(false);
  });

  it("super admin cannot onboard Stripe on an organizer's behalf", () => {
    expect(can(superAdmin, "stripe.onboard", ORG_A)).toBe(false);
  });

  it("every role grants only known permissions", () => {
    for (const role of ORG_ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });
});

describe("maxDiscountBps()", () => {
  const org = { organizerId: "orgA", maxDiscountBpsForManager: 5000 };
  it("limits by role", () => {
    expect(maxDiscountBps(user("owner"), org)).toBe(10000);
    expect(maxDiscountBps(user("manager"), org)).toBe(5000);
    expect(maxDiscountBps(user("box_office"), org)).toBe(0);
    expect(maxDiscountBps(superAdmin, org)).toBe(10000);
  });
});
