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
      lib.createOrganizer(auth, admin, { name: "Test Garba", slug: "test-garba", contactEmail: "hello@test.example", commissionBps: 800, orderPrefix: "TST" }),
    );
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
