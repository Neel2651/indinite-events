import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/staff/password-forms";
import { AuthCard } from "@/components/staff/ui";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset your password" intro="Enter your staff account email and we'll send you a link.">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
