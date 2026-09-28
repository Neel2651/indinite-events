import { notFound } from "next/navigation";
import { buildExport, EXPORT_KINDS, recordExport, type ExportKind } from "@indinite/db";
import { asStaff, requireOrg } from "@/lib/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Organiser CSV export (owner, manager, finance: reports.read). Always this organiser's data only. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await params;
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("reports.read") || !EXPORT_KINDS.includes(kind as ExportKind)) notFound();
  const eventId = new URL(req.url).searchParams.get("event") || null;
  const scope = { organizerId: organizer.id, eventId };
  const out = await buildExport(kind as ExportKind, scope);
  await asStaff(user, () => recordExport({ kind: kind as ExportKind, scope, rows: out.rows }), organizer.id);
  return new Response(out.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
