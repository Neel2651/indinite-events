import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/staff/sign-in-form";
import { AuthCard } from "@/components/staff/ui";
import { getStaffUser, homeFor } from "@/lib/staff";

export const metadata: Metadata = { title: "Organiser login", robots: { index: false } };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const user = await getStaffUser();
  if (user) redirect(homeFor(user));
  return (
    <AuthCard title="Organiser login" intro="For event organisers and their teams. Customers don't need an account to book.">
      <SignInForm next={(await searchParams).next ?? null} />
    </AuthCard>
  );
}
