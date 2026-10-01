/**
 * Real-MongoDB tests for staff auth: invitation-only sign-up, memberships → can(), member management rules.
 * Run: pnpm --filter @indinite/auth test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { can, ForbiddenError } from "@indinite/core";
import { runWithContext } from "@indinite/core/context";
import { Job } from "@indinite/db";

let replSet: MongoMemoryReplSet;
let auth: Awaited<typeof import("../src")>["createAuth"] extends (...a: never[]) => infer R ? R : never;
let lib: typeof import("../src");

const BASE = "http://localhost:3001";
const PASSWORD = "correct-horse-battery";

async function call(path: string, body: unknown, cookie?: string) {
  const res = await auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
  const setCookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null, cookie: setCookie };
}

const headersFor = (cookie: string) => new Headers({ cookie });
const asUser = <T>(id: string, fn: () => Promise<T>) => runWithContext({ actor: { type: "user", id } }, fn);

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  process.env.MONGODB_URI = replSet.getUri("auth-test");
  process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
  process.env.BETTER_AUTH_URL = BASE;
  process.env.APP_URL = BASE;
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
  lib = await import("../src");
  auth = lib.createAuth();
  await lib.ensureAuthIndexes(mongoose.connection.db as never);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

describe("staff auth", () => {
  let superAdminCookie = "";
  let organizerId = "";

  it("refuses public sign-up without an invitation", async () => {
    const res = await call("/sign-up/email", { email: "stranger@example.com", password: PASSWORD, name: "Stranger" });
    expect(res.status).toBe(403);
    expect(res.json?.message).toMatch(/invitation only/);
  });

  it("lets a server-side script create the super admin, who can then sign in", async () => {
    const created = await auth.api.signUpEmail({ body: { email: "admin@example.com", password: PASSWORD, name: "Admin" } });
    const db = (await auth.$context).adapter;
    await db.update({ model: "user", where: [{ field: "id", value: created.user.id }], update: { isSuperAdmin: true } });

    const signIn = await call("/sign-in/email", { email: "admin@example.com", password: PASSWORD });
    expect(signIn.status).toBe(200);
    superAdminCookie = signIn.cookie;
    const me = await lib.loadStaffUser(auth, headersFor(superAdminCookie));
    expect(me).toMatchObject({ email: "admin@example.com", isSuperAdmin: true, memberships: [] });
  });

  it("rejects a wrong password", async () => {
    expect((await call("/sign-in/email", { email: "admin@example.com", password: "wrong-password-123" })).status).toBe(401);
  });

  it("super admin creates an organiser and invites its owner, who signs up and accepts", async () => {
    const admin = (await lib.loadStaffUser(auth, headersFor(superAdminCookie)))!;
    const org = await asUser(admin.id, () =>
      lib.createOrganizer(auth, admin, { name: "Test Garba", contactEmail: "hello@test.example", commissionBps: 800 }),
    );
    // Web address and order prefix come from the name.
    expect(org).toMatchObject({ slug: "test-garba", orderPrefix: "TG" });
    organizerId = org.id;
    const { invitationId } = await asUser(admin.id, () => lib.inviteMember(auth, admin, organizerId, "Owner@Example.com", "owner"));

    const job = await Job.findOne({ queue: "send-auth-email", "data.to": "owner@example.com" }).lean();
    expect(job?.data).toMatchObject({ kind: "invitation", url: `${BASE}/invite/${invitationId}`, organizationName: "Test Garba", role: "Owner" });

    const signUp = await call("/sign-up/email", { email: "owner@example.com", password: PASSWORD, name: "Olivia Owner" });
    expect(signUp.status).toBe(200);
    const accept = await call("/organization/accept-invitation", { invitationId }, signUp.cookie);
    expect(accept.status).toBe(200);

    const owner = (await lib.loadStaffUser(auth, headersFor(signUp.cookie)))!;
    expect(owner.organizers).toEqual([{ id: organizerId, name: "Test Garba", slug: "test-garba", role: "owner" }]);
    expect(can(owner, "order.refund", { organizerId })).toBe(true);
    expect(can(owner, "order.refund", { organizerId: new mongoose.Types.ObjectId().toHexString() })).toBe(false);
    expect(can(owner, "event.create")).toBe(false);
  });

  it("owner invites a scanner; scanners can scan but not manage members", async () => {
    const ownerSession = await call("/sign-in/email", { email: "owner@example.com", password: PASSWORD });
    const owner = (await lib.loadStaffUser(auth, headersFor(ownerSession.cookie)))!;
    const { invitationId } = await asUser(owner.id, () => lib.inviteMember(auth, owner, organizerId, "scan@example.com", "scanner"));

    const signUp = await call("/sign-up/email", { email: "scan@example.com", password: PASSWORD, name: "Sam Scanner" });
    await call("/organization/accept-invitation", { invitationId }, signUp.cookie);
    const scanner = (await lib.loadStaffUser(auth, headersFor(signUp.cookie)))!;

    expect(can(scanner, "scan.perform", { organizerId })).toBe(true);
    expect(can(scanner, "order.read", { organizerId })).toBe(false);
    await expect(asUser(scanner.id, () => lib.inviteMember(auth, scanner, organizerId, "x@example.com", "owner"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("won't remove or demote the last owner", async () => {
    const ownerSession = await call("/sign-in/email", { email: "owner@example.com", password: PASSWORD });
    const owner = (await lib.loadStaffUser(auth, headersFor(ownerSession.cookie)))!;
    const { members } = await lib.listMembers(auth, owner, organizerId);
    const me = members.find((m) => m.email === "owner@example.com")!;
    await expect(asUser(owner.id, () => lib.changeMemberRole(auth, owner, organizerId, me.memberId, "manager"))).rejects.toThrow(/at least one owner/);
    await expect(asUser(owner.id, () => lib.removeMember(auth, owner, organizerId, me.memberId))).rejects.toThrow(/last owner/);
  });

  it("does not let an invitation be accepted by a different account", async () => {
    const admin = (await lib.loadStaffUser(auth, headersFor(superAdminCookie)))!;
    const { invitationId } = await asUser(admin.id, () => lib.inviteMember(auth, admin, organizerId, "finance@example.com", "finance"));
    const scanSession = await call("/sign-in/email", { email: "scan@example.com", password: PASSWORD });
    const accept = await call("/organization/accept-invitation", { invitationId }, scanSession.cookie);
    expect(accept.status).toBeGreaterThanOrEqual(400);
  });
});

describe("organiser self-registration (1 Oct 2026)", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    organisationName: "Test Garba Co",
    name: "Reena Register",
    email: "reena@example.com",
    password: PASSWORD,
    confirm: PASSWORD,
    acceptTerms: true,
    ...over,
  });

  it("creates the organiser (10% fee, owner, generated web address and prefix) and audits it", async () => {
    const r = await lib.registerOrganizer(auth, input(), "test-register");
    // "TG" (the initials; "Co" is skipped) is already used by "Test Garba" above, so the next candidate is taken.
    expect(r).toMatchObject({ slug: "test-garba-co", orderPrefix: "TES", email: "reena@example.com" });
    const { Organizer, AuditLog } = await import("@indinite/db");
    const org = (await Organizer.findById(r.organizerId).lean())!;
    expect(org).toMatchObject({ name: "Test Garba Co", commissionBps: 1000, selfRegistered: true, contactEmail: "reena@example.com" });
    expect(await AuditLog.findOne({ action: "organizer.self_registered", "entity.id": r.organizerId }).lean()).toMatchObject({ actor: { type: "user", id: r.userId } });
    const db = (await auth.$context).adapter;
    expect(await db.findOne({ model: "member", where: [{ field: "userId", value: r.userId }] })).toMatchObject({ role: "owner" });
  });

  it("can't sign in until the email is verified, even with the right password; then can", async () => {
    const before = await call("/sign-in/email", { email: "reena@example.com", password: PASSWORD });
    expect(before.status).toBe(403);
    expect(before.json?.code).toBe("EMAIL_NOT_VERIFIED");
    // A wrong password gets the normal answer: the hook never reveals that the email is registered.
    expect((await call("/sign-in/email", { email: "reena@example.com", password: "wrong-password-123" })).status).toBe(401);

    await auth.api.sendVerificationEmail({ body: { email: "reena@example.com", callbackURL: "/org/test-garba-co?welcome=1" } });
    const job = await Job.findOne({ queue: "send-auth-email", "data.kind": "verify-email", "data.to": "reena@example.com" }).lean();
    const link = new URL(String((job?.data as { url: string }).url));
    expect(link.pathname).toBe("/api/auth/verify-email");
    const verify = await auth.handler(new Request(link.toString().replace(link.origin, BASE)));
    expect(verify.status).toBeGreaterThanOrEqual(200);

    const after = await call("/sign-in/email", { email: "reena@example.com", password: PASSWORD });
    expect(after.status).toBe(200);
    const me = (await lib.loadStaffUser(auth, headersFor(after.cookie)))!;
    expect(me.organizers).toEqual([expect.objectContaining({ slug: "test-garba-co", role: "owner" })]);
  });

  it("a second organiser with the same name gets a different web address and prefix", async () => {
    const r = await lib.registerOrganizer(auth, input({ email: "second@example.com" }), "test-register-2");
    expect(r.slug).toBe("test-garba-co-2");
    expect(r.orderPrefix).not.toBe("TES");
    expect(r.orderPrefix).toMatch(/^[A-Z]{2,5}$/);
  });

  it("refuses an email that already has an account, and leaves nothing behind", async () => {
    const { Organizer } = await import("@indinite/db");
    const count = await Organizer.countDocuments();
    await expect(lib.registerOrganizer(auth, input({ organisationName: "Another Co" }), "test-register-3")).rejects.toMatchObject({ field: "email" });
    expect(await Organizer.countDocuments()).toBe(count);
  });

  it("checks the form: matching passwords and the terms", async () => {
    await expect(lib.registerOrganizer(auth, input({ email: "x1@example.com", confirm: "different-pass-1" }), "t")).rejects.toThrow(/don't match/);
    await expect(lib.registerOrganizer(auth, input({ email: "x2@example.com", acceptTerms: false }), "t")).rejects.toThrow(/agree to the terms/);
  });

  it("invited staff aren't affected: the invited owner still signs in without verifying", async () => {
    expect((await call("/sign-in/email", { email: "owner@example.com", password: PASSWORD })).status).toBe(200);
  });
});
