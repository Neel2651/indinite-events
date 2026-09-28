import { StaffShell } from "@/components/staff/shell";
import { requireSuperAdmin } from "@/lib/staff";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin();
  return (
    <StaffShell
      area="Admin"
      areaHref="/admin"
      nav={[
        { href: "/admin", label: "Overview", exact: true },
        { href: "/admin/events", label: "Events" }, { href: "/admin/organisers", label: "Organisers" },
        { href: "/admin/finance", label: "Finance" },
      ]}
      user={{ name: user.name, email: user.email, roleLabel: "Super admin" }}
      links={[{ href: "/org", label: "Organiser panels" }]}
    >
      {children}
    </StaffShell>
  );
}
