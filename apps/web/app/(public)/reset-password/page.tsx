import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/staff/password-forms";
import { AuthCard } from "@/components/staff/ui";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false }, referrer: "no-referrer" };

type Props = { searchParams: Promise<{ token?: string; error?: string }> };

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token, error } = await searchParams;
  if (!token || error) {
    return (
      <AuthCard title="This link has expired" intro="Password reset links work for 1 hour and can only be used once.">
        <Link href="/forgot-password" className="btn-cta inline-block">
          Ask for a new link
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
