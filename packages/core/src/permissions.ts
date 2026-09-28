export const ORG_ROLES = ["owner", "manager", "box_office", "scanner", "finance"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PERMISSIONS = [
  "event.create",
  "event.delete",
  "event.update",
  "event.read",
  "event.manageCharges",
  "coupon.manage",
  "ticketType.manage",
  "organizer.manage",
  "finance.manage",
  "org.members.manage",
  "stripe.onboard",
  "order.read",
  "order.createPaymentLink",
  "order.applyDiscount",
  "order.issueOffline",
  "order.resendTickets",
  "order.refund",
  "order.cancel",
  "scan.perform",
  "scan.manualAdmit",
  "reports.read",
  "audit.read",
  "audit.readGlobal",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissions only the platform (Indinite) super admin holds. */
const PLATFORM_ONLY: ReadonlySet<Permission> = new Set([
  "event.create",
  "event.delete",
  "event.update",
  "ticketType.manage",
  "organizer.manage",
  "finance.manage",
  "audit.readGlobal",
]);

/**
 * Super admin can do everything except refund: refunds are the organiser owner's decision (SPEC §4.6).
 * Super admins may start/resend Stripe onboarding (SPEC §4.8, agreed 28 Sep 2026).
 */
const SUPER_ADMIN_EXCLUDED: ReadonlySet<Permission> = new Set(["order.refund"]);

export const ROLE_PERMISSIONS: Record<OrgRole, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    "event.read",
    "event.manageCharges",
    "coupon.manage",
    "org.members.manage",
    "stripe.onboard",
    "order.read",
    "order.createPaymentLink",
    "order.applyDiscount",
    "order.issueOffline",
    "order.resendTickets",
    "order.refund",
    "order.cancel",
    "scan.perform",
    "scan.manualAdmit",
    "reports.read",
    "audit.read",
  ]),
  manager: new Set<Permission>([
    "event.read",
    "coupon.manage",
    "order.read",
    "order.createPaymentLink",
    "order.applyDiscount",
    "order.issueOffline",
    "order.resendTickets",
    "scan.perform",
    "scan.manualAdmit",
    "reports.read",
  ]),
  box_office: new Set<Permission>([
    "event.read",
    "order.read",
    "order.createPaymentLink",
    "order.issueOffline",
    "order.resendTickets",
  ]),
  scanner: new Set<Permission>(["event.read", "scan.perform"]),
  finance: new Set<Permission>(["event.read", "order.read", "reports.read"]),
};

export interface Membership {
  organizerId: string;
  role: OrgRole;
}

export interface AuthUser {
  id: string;
  isSuperAdmin: boolean;
  memberships: Membership[];
}

export interface OrgResource {
  organizerId: string;
}

/**
 * Central permission check. Organizer permissions always require a resource so the check is
 * scoped to that organizer; the organizerId must come from the loaded record, never the request body.
 */
export function can(user: AuthUser, permission: Permission, resource?: OrgResource): boolean {
  if (user.isSuperAdmin) return !SUPER_ADMIN_EXCLUDED.has(permission);
  if (PLATFORM_ONLY.has(permission)) return false;
  if (!resource) return false;

  const membership = user.memberships.find((m) => m.organizerId === resource.organizerId);
  if (!membership) return false;
  return ROLE_PERMISSIONS[membership.role].has(permission);
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(permission: Permission) {
    super(`Forbidden: missing permission ${permission}`);
  }
}

export function assertCan(user: AuthUser, permission: Permission, resource?: OrgResource): void {
  if (!can(user, permission, resource)) throw new ForbiddenError(permission);
}

/** Max discount (bps) a user may apply for an organizer. 10000 for owner/super admin. */
export function maxDiscountBps(user: AuthUser, organizer: OrgResource & { maxDiscountBpsForManager: number }): number {
  if (user.isSuperAdmin) return 10000;
  const role = user.memberships.find((m) => m.organizerId === organizer.organizerId)?.role;
  if (role === "owner") return 10000;
  if (role === "manager") return organizer.maxDiscountBpsForManager;
  return 0;
}
