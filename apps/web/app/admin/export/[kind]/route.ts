import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { buildExport, EXPORT_KINDS, recordExport, type ExportKind } from "@indinite/db";
import { asStaff, requireSuperAdmin } from "@/lib/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Super admin CSV export, across organisers or filtered by ?org= and ?event=. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const user = await requireSuperAdmin();
  if (!EXPORT_KINDS.includes(kind as ExportKind)) notFound();
  const sp = new URL(req.url).searchParams;
  const org = sp.get("org") ?? "";
  const event = sp.get("event") ?? "";
  const scope = { organizerId: Types.ObjectId.isValid(org) ? org : null, eventId: Types.ObjectId.isValid(event) ? event : null };
  const out = await buildExport(kind as ExportKind, scope);
  await asStaff(user, () => recordExport({ kind: kind as ExportKind, scope, rows: out.rows }));
  return new Response(out.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
