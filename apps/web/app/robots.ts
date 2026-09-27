import type { MetadataRoute } from "next";
import { isStaging } from "@indinite/core";

// Read DEPLOY_ENV at request time, not build time.
export const dynamic = "force-dynamic";

/** Staging/demo servers must never be indexed; live allows the public pages only. */
export default function robots(): MetadataRoute.Robots {
  if (isStaging(process.env)) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/org", "/scan", "/orders", "/pay", "/checkout", "/api", "/invite"] }] };
}
