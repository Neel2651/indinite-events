import { createAccessControl } from "better-auth/plugins/access";
import { ORG_ROLES, type OrgRole } from "@indinite/core";

/**
 * Better Auth only needs to know who may manage the organisation's membership (invite, change role,
 * remove). Everything else — orders, scanning, refunds — is decided by `can()` in @indinite/core,
 * which mirrors SPEC §2.
 */
const statements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statements);

const none = { organization: [], member: [], invitation: [], team: [], ac: [] } as const;

export const roles: Record<OrgRole, ReturnType<typeof ac.newRole>> = {
  // org.members.manage — owner only (super admins act through server-side services instead).
  owner: ac.newRole({ organization: ["update"], member: ["create", "update", "delete"], invitation: ["create", "cancel"], team: [], ac: ["read"] }),
  manager: ac.newRole(none),
  box_office: ac.newRole(none),
  scanner: ac.newRole(none),
  finance: ac.newRole(none),
};

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  manager: "Manager",
  box_office: "Box office",
  scanner: "Scanner",
  finance: "Finance",
};

export const isOrgRole = (r: unknown): r is OrgRole => typeof r === "string" && (ORG_ROLES as readonly string[]).includes(r);
