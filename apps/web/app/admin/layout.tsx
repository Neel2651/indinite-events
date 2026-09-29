import { StaffShell } from "@/components/staff/shell";
import { appMetadata, appViewport } from "@/lib/app-meta";
import { requireSuperAdmin } from "@/lib/staff";

export const dynamic = "force-dynamic";
export const metadata = appMetadata;
export const viewport = appViewport;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin();
  return (
    <StaffShell
      area="Admin"
      areaHref="/admin"
      nav={[
        { href: "/admin", label: "Overview", exact: true },
        { href: "/admin/events", label: "Events" }, { href: "/admin/orders", label: "Orders" }, { href: "/admin/organisers", label: "Organisers" },
        { href: "/admin/finance", label: "Finance" }, { href: "/admin/audit", label: "Audit log" },
      ]}
      user={{ name: user.name, email: user.email, roleLabel: "Super admin" }}
      links={[{ href: "/org", label: "Organiser panels" }]}
      tabs={[
        { href: "/admin", label: "Home", icon: "home", exact: true },
        { href: "/admin/events", label: "Events", icon: "events" },
        { href: "/admin/orders", label: "Orders", icon: "orders" },
        { href: "/admin/finance", label: "Finance", icon: "money" },
      ]}
    >
      {children}
    </StaffShell>
  );
}
