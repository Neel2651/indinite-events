import { ROLE_LABELS } from "@indinite/auth";
import type { MobileTab } from "@/components/staff/mobile-nav";
import { StaffShell } from "@/components/staff/shell";
import { requireOrg } from "@/lib/staff";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, organizer, role, can } = await requireOrg(slug);
  const base = `/org/${organizer.slug}`;
  const nav: { href: string; label: string; exact?: boolean }[] = [{ href: base, label: "Dashboard", exact: true }];
  if (can("event.update")) nav.push({ href: `${base}/events`, label: "Events" });
  if (can("order.read")) nav.push({ href: `${base}/orders`, label: "Orders" });
  if (can("order.issueOffline")) nav.push({ href: `${base}/bookings/new`, label: "New booking" });
  if (can("coupon.manage")) nav.push({ href: `${base}/coupons`, label: "Coupons" });
  nav.push({ href: `${base}/pricing`, label: "Pricing" });
  if (can("reports.read") || can("scan.perform")) nav.push({ href: `${base}/checkins`, label: "Check-ins" });
  if (can("org.members.manage")) nav.push({ href: `${base}/members`, label: "Team" });
  if (can("audit.read")) nav.push({ href: `${base}/audit`, label: "Audit log" });
  nav.push({ href: `${base}/payments`, label: "Payments" });

  // Phone bottom tabs: the four things organisers do most (SPEC organiser app, 29 Sep 2026).
  const tabs: MobileTab[] = [{ href: base, label: "Home", icon: "home", exact: true }];
  if (can("order.read")) tabs.push({ href: `${base}/orders`, label: "Orders", icon: "orders" });
  if (can("order.issueOffline") || can("order.createPaymentLink")) tabs.push({ href: `${base}/bookings/new`, label: "Book", icon: "plus" });
  if (can("scan.perform")) tabs.push({ href: "/scan", label: "Scan", icon: "scan" });
  else if (can("reports.read")) tabs.push({ href: `${base}/checkins`, label: "Check-ins", icon: "checkins" });

  const links: { href: string; label: string }[] = [];
  if (can("scan.perform")) links.push({ href: "/scan", label: "Open scanner" });
  if (user.isSuperAdmin) links.push({ href: "/admin", label: "Admin" });
  if (user.isSuperAdmin || user.organizers.length > 1) links.push({ href: "/org", label: "Switch organiser" });

  return (
    <StaffShell
      area={organizer.name}
      areaHref={base}
      nav={nav}
      user={{ name: user.name, email: user.email, roleLabel: role ? ROLE_LABELS[role] : "Super admin" }}
      links={links}
      tabs={tabs}
    >
      {children}
    </StaffShell>
  );
}
