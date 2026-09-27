import type { Metadata } from "next";
import Link from "next/link";
import { getInvitation } from "@indinite/auth";
import { connectDb } from "@indinite/db";
import { AcceptInvite } from "@/components/staff/accept-invite";
import { AuthCard } from "@/components/staff/ui";
import { auth } from "@/lib/auth";
import { getStaffUser } from "@/lib/staff";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accept invitation", robots: { index: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ id: string }> };

export default async function InvitePage({ params }: Props) {
  await connectDb();
  const invitation = /^[a-f0-9]{24}$/.test((await params).id) ? await getInvitation(auth, (await params).id) : null;

  if (!invitation || invitation.status !== "pending" || invitation.expired) {
    return (
      <AuthCard
        title={invitation?.status === "accepted" ? "Invitation already accepted" : "This invitation isn't valid"}
        intro={
          invitation?.status === "accepted"
            ? "You can sign in with the email the invitation was sent to."
            : "It may have expired or been cancelled. Ask the person who invited you to send a new one."
        }
      >
        <Link href="/sign-in" className="btn-cta inline-block">
          Go to sign in
        </Link>
      </AuthCard>
    );
  }

  const user = await getStaffUser();
  const sameEmail = user?.email.toLowerCase() === invitation.email.toLowerCase();

  return (
    <AuthCard
      title={`Join ${invitation.organizerName}`}
      intro={
        <>
          You&apos;ve been invited to join <strong className="text-foreground">{invitation.organizerName}</strong> on Indinite Events as{" "}
          <strong className="text-foreground">{invitation.role}</strong>.
        </>
      }
    >
      <AcceptInvite
        invitationId={invitation.id}
        email={invitation.email}
        signedInAsInvitee={!!user && sameEmail}
        signedInAsOther={user && !sameEmail ? user.email : null}
        hasAccount={invitation.hasAccount}
      />
    </AuthCard>
  );
}
