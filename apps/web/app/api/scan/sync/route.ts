import { z } from "zod";
import { can } from "@indinite/core";
import { connectDb, syncScans } from "@indinite/db";
import { json, scanAccess } from "@/lib/scan-access";
import { withRequestContext } from "@/lib/request-context";

export const runtime = "nodejs";

const bodySchema = z.object({
  eventId: z.string(),
  since: z.string().optional(),
  scans: z
    .array(
      z.object({
        clientScanId: z.string().min(8).max(64),
        ticketId: z.string().regex(/^[a-f0-9]{24}$/).nullable().optional(),
        sessionId: z.string().regex(/^[a-f0-9]{24}$/),
        gate: z.string().trim().min(1).max(60),
        deviceId: z.string().min(1).max(80),
        result: z.enum(["admitted", "already_used", "invalid", "wrong_session", "cancelled", "manual_admit"]),
        reason: z.string().max(300).optional(),
        scannedAt: z.iso.datetime(),
      }),
    )
    .max(500),
});

/** SPEC §4.5: devices push queued scans every ~10 s; server resolves conflicts and returns other gates' admissions. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid scan data." }, 400);
  await connectDb();
  const access = await scanAccess(parsed.data.eventId);
  if ("error" in access) return access.error;
  const { user, organizerId } = access;
  const res = await withRequestContext(
    { type: "user", id: user.id },
    () =>
      syncScans({
        eventId: parsed.data.eventId,
        scannerUserId: user.id,
        canManualAdmit: can(user, "scan.manualAdmit", { organizerId }),
        scans: parsed.data.scans,
        since: parsed.data.since,
      }),
    organizerId,
  );
  return json(res);
}
