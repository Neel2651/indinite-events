import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listMembers, ROLE_LABELS } from "@indinite/auth";
import { PageHeader } from "@/components/staff/shell";
import { CancelInviteButton, InviteForm, MemberRowActions } from "@/components/staff/team";
import { auth } from "@/lib/auth";
import { formatDay } from "@/lib/format";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("org.members.manage")) notFound();
  const { members, invitations } = await listMembers(auth, user, organizer.id);

  return (
    <>
      <PageHeader title="Team" description="Who can sign in to this organiser panel, and what they can do." />

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Joined</th>
              <th className="px-4 py-3 text-right font-semibold">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.map((m) => (
              <tr key={m.memberId}>
                <td className="px-4 py-3">
                  <span className="font-semibold">
                    {m.name}
                    {m.userId === user.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground">{m.email}</span>
                </td>
                <td className="px-4 py-3">{formatDay(m.joinedAt)}</td>
                <td className="px-4 py-3">
                  <MemberRowActions slug={slug} memberId={m.memberId} role={m.role} isSelf={m.userId === user.id} />
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-muted-foreground">
                  Nobody has joined yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {invitations.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl">Pending invitations</h2>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <span className="font-semibold">{i.email}</span>
                  <span className="block text-xs text-muted-foreground">
                    {ROLE_LABELS[i.role]} · expires {formatDay(i.expiresAt)}
                  </span>
                </span>
                <CancelInviteButton slug={slug} invitationId={i.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 rounded-lg border border-border bg-card p-6">
        <h2 className="text-xl">Invite someone</h2>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">They&apos;ll get an email with a link to set up their account. Invitations last 7 days.</p>
        <InviteForm slug={slug} />
      </section>
    </>
  );
}
