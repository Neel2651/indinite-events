import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/staff/register-form";
import { AuthCard } from "@/components/staff/ui";
import { getStaffUser, homeFor } from "@/lib/staff";

export const metadata: Metadata = { title: "Register your organisation", description: "Sell passes for your events on Indinite Events." };

/** Organiser self-registration (1 Oct 2026). */
export default async function RegisterPage() {
  const user = await getStaffUser();
  if (user) redirect(homeFor(user));
  return (
    <AuthCard title="Register your organisation" intro="Sell passes for your events. You can set up your first event straight away; card payments are set up later from your Payments page.">
      <RegisterForm />
    </AuthCard>
  );
}
