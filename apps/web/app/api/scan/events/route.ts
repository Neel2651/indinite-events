import { connectDb } from "@indinite/db";
import { json, scannableEvents } from "@/lib/scan-access";

export const runtime = "nodejs";

export async function GET() {
  await connectDb();
  const data = await scannableEvents();
  return data ? json(data) : json({ error: "Sign in to scan." }, 401);
}
