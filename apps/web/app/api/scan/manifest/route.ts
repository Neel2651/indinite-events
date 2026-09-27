import { connectDb, getScanManifest } from "@indinite/db";
import { json, scanAccess } from "@/lib/scan-access";

export const runtime = "nodejs";

/** SPEC §4.5: pass manifest + public key, cached on the device for offline scanning. */
export async function GET(req: Request) {
  await connectDb();
  const access = await scanAccess(new URL(req.url).searchParams.get("eventId"));
  if ("error" in access) return access.error;
  const manifest = await getScanManifest(new URL(req.url).searchParams.get("eventId")!);
  if (!manifest) return json({ error: "Event not found." }, 404);
  return json({ ...manifest, publicKeyHex: process.env.NEXT_PUBLIC_QR_PUBLIC_KEY });
}
