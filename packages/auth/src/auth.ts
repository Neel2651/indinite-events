import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { MongoClient } from "mongodb";
import { enqueueSendAuthEmail } from "@indinite/db";
import { ac, roles, ROLE_LABELS, isOrgRole } from "./roles";

const INVITE_TTL_S = 7 * 24 * 60 * 60;

const g = globalThis as unknown as { __authMongo?: MongoClient };

function mongo(): MongoClient {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  // Operations connect lazily; cached across Next.js hot reloads.
  g.__authMongo ??= new MongoClient(uri, { maxPoolSize: 10 });
  return g.__authMongo;
}

export function appUrl(): string {
  return (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

/**
 * Staff authentication (super admins and organiser users). Customers never sign in.
 * - Email + password; sign-up is invitation-only (see the before-hook).
 * - One Better Auth organisation per Organizer (Organizer.authOrgId), roles from SPEC §2.
 */
export function createAuth(extraPlugins: BetterAuthPlugin[] = []) {
  const client = mongo();
  return betterAuth({
    appName: "Indinite Events",
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: mongodbAdapter(client.db(), { client }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await enqueueSendAuthEmail({ kind: "reset-password", to: user.email, url, name: user.name });
      },
    },
    user: {
      additionalFields: {
        isSuperAdmin: { type: "boolean", defaultValue: false, input: false, required: false },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: {
        // No limit on sign-in attempts (decided 1 Oct 2026): `false` also turns off Better Auth's built-in sign-in limit.
        "/sign-in/email": false,
        "/request-password-reset": { window: 300, max: 3 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // No public sign-up: over HTTP, an account can only be created for an email with a pending invitation.
        if (ctx.path !== "/sign-up/email" || !ctx.request) return;
        const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "").trim().toLowerCase();
        const invitation = email
          ? await ctx.context.adapter.findOne<{ expiresAt: Date }>({
              model: "invitation",
              where: [
                { field: "email", value: email },
                { field: "status", value: "pending" },
              ],
            })
          : null;
        if (!invitation || new Date(invitation.expiresAt) <= new Date()) {
          throw new APIError("FORBIDDEN", { message: "Accounts are by invitation only." });
        }
      }),
    },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        invitationExpiresIn: INVITE_TTL_S,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async (data) => {
          await enqueueSendAuthEmail({
            kind: "invitation",
            to: data.email,
            url: `${appUrl()}/invite/${data.id}`,
            organizationName: data.organization.name,
            role: isOrgRole(data.role) ? ROLE_LABELS[data.role] : data.role,
            inviterName: data.inviter.user.name,
          });
        },
      }),
      ...extraPlugins,
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
