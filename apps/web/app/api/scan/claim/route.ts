import { z } from "zod";
import { claimScan, connectDb, hitRateLimit } from "@indinite/db";
import { json, scanAccess } from "@/lib/scan-access";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    eventId: z.string(),
    sessionId: z.string().regex(/^[a-f0-9]{24}$/),
    gate: z.string().trim().min(1).max(60),
    deviceId: z.string().min(1).max(80),
    clientScanId: z.string().min(8).max(64),
    token: z.string().max(400).optional(),
    code: z.string().max(20).optional(),
  })
  .refine((b) => !!b.token !== !!b.code, "Send a QR token or a code");

/** SPEC §4.5 online check: the server decides and records the admission atomically (once per pass per night). */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid scan." }, 400);
  await connectDb();
  const access = await scanAccess(parsed.data.eventId);
  if ("error" in access) return access.error;
  // Typed codes are the only guessable input; cap them per staff member.
  if (parsed.data.code && !(await hitRateLimit(`scan-code:${access.user.id}`, 30, 60_000)).allowed) {
    return json({ error: "Too many codes typed. Wait a minute." }, 429);
  }
  const publicKeyHex = process.env.NEXT_PUBLIC_QR_PUBLIC_KEY;
  if (!publicKeyHex) return json({ error: "Scanner isn't configured." }, 500);
  const result = await claimScan({ ...parsed.data, scannerUserId: access.user.id, publicKeyHex });
  return json(result);
}
