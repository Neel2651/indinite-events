import { appMetadata, appViewport } from "@/lib/app-meta";

// Organiser panel = the installable staff app (the service worker is registered by StaffShell).
export const metadata = appMetadata;
export const viewport = appViewport;

export default function OrgAppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
