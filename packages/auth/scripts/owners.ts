/**
 * Organiser owners (they manage their organiser's events since 1 Oct 2026). Permissions come from each member's role
 * in code, so existing owners need no database change; this checks every organiser actually has one.
 *
 *   pnpm owners                                              # report (read-only)
 *   pnpm owners -- --make-owner <email> <organiser-slug>     # promote a member, or invite them as owner
 *
 * --make-owner asks before doing anything, runs as Indinite (system) and is audited like the admin screens.
 * An invitation is emailed by the worker. Reads MONGODB_URI etc. from the project's .env.local.
 */
import { runWithContext, systemActor } from "@indinite/core/context";
import { connectDb, disconnectDb, Event, Organizer } from "@indinite/db";
import { createAuth } from "../src/auth";
import { changeMemberRole, inviteMember, listMembers, MembershipError, type StaffUser } from "../src/staff";
import { ask } from "./prompt";

const args = process.argv.slice(2).filter((a) => a !== "--");
const makeOwnerAt = args.indexOf("--make-owner");

// Acts as Indinite, like a super admin on the admin screens (every change is audited with this actor).
const indinite: StaffUser = { id: "system", email: "system@indinite", name: "Indinite", isSuperAdmin: true, memberships: [], organizers: [] };
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

await connectDb();
const auth = createAuth();

await runWithContext({ actor: systemActor, requestId: "owners-script" }, async () => {
  if (makeOwnerAt >= 0) {
    const email = args[makeOwnerAt + 1]?.trim().toLowerCase();
    const slug = args[makeOwnerAt + 2]?.trim().toLowerCase();
    if (!email || !slug || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error("Usage: pnpm owners -- --make-owner <email> <organiser-slug>");
      process.exitCode = 1;
      return;
    }
    const org = await Organizer.findOne({ slug }, { name: 1 }).lean();
    if (!org) {
      console.error(`No organiser with the slug "${slug}". Run pnpm owners to see them.`);
      process.exitCode = 1;
      return;
    }
    const { members } = await listMembers(auth, indinite, String(org._id));
    const member = members.find((m) => m.email.toLowerCase() === email);
    if (member?.role === "owner") {
      console.log(`${email} is already an owner of ${org.name}. Nothing to do.`);
      return;
    }
    const what = member ? `change ${email} from ${member.role} to owner` : `email ${email} an invitation to be owner`;
    if ((await ask(`${org.name}: ${what}? (y/N) `)).toLowerCase() !== "y") {
      console.log("Nothing changed.");
      return;
    }
    try {
      if (member) {
        await changeMemberRole(auth, indinite, String(org._id), member.memberId, "owner");
        console.log(`${email} is now an owner of ${org.name}. They'll see Events in the organiser panel next time they load it.`);
      } else {
        await inviteMember(auth, indinite, String(org._id), email, "owner");
        console.log(`Invitation queued for ${email} (valid 7 days). The worker emails it; they choose their own password.`);
      }
    } catch (e) {
      console.error(e instanceof MembershipError ? e.message : `Couldn't do that: ${e instanceof Error ? e.message : e}`);
      process.exitCode = 1;
    }
    return;
  }

  // Report.
  const orgs = await Organizer.find({}, { name: 1, slug: 1, status: 1 }).sort({ name: 1 }).lean();
  let missing = 0;
  console.log(`${orgs.length} organiser${orgs.length === 1 ? "" : "s"}\n`);
  for (const org of orgs) {
    const events = await Event.countDocuments({ organizerId: org._id, deletedAt: null });
    let owners: { name: string; email: string }[] = [];
    let invites: { email: string; expiresAt: Date }[] = [];
    try {
      const list = await listMembers(auth, indinite, String(org._id));
      owners = list.members.filter((m) => m.role === "owner");
      invites = list.invitations.filter((i) => i.role === "owner");
    } catch (e) {
      console.log(`  (couldn't read members: ${e instanceof Error ? e.message : e})`);
    }
    const flag = owners.length === 0 && invites.length === 0;
    if (flag) missing++;
    console.log(`${flag ? "✗" : "✓"} ${org.name} (${org.slug})${org.status === "suspended" ? " · suspended" : ""} · ${events} event${events === 1 ? "" : "s"}`);
    for (const o of owners) console.log(`    owner    ${o.name || "(no name)"} <${o.email}>`);
    for (const i of invites) console.log(`    invited  ${i.email} · invitation expires ${dateFmt.format(i.expiresAt)}`);
    if (flag) console.log(`    No owner: nobody can manage this organiser's events. Fix: pnpm owners -- --make-owner <email> ${org.slug}`);
  }
  console.log(missing ? `\n✗ ${missing} organiser${missing === 1 ? "" : "s"} without an owner.` : "\n✓ Every organiser has an owner or a pending owner invitation.");
});

await disconnectDb();
// Better Auth keeps its own database connection open; end the process explicitly.
process.exit(process.exitCode ?? 0);
