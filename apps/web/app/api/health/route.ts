import { pingDb } from "@indinite/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};
  try {
    await pingDb();
    checks.mongo = "ok";
  } catch (e) {
    checks.mongo = e instanceof Error ? e.message : "error";
  }
  const healthy = Object.values(checks).every((v) => v === "ok");
  return Response.json({ status: healthy ? "ok" : "degraded", checks }, { status: healthy ? 200 : 503 });
}
