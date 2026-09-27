import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { MEDIA_CONTENT_TYPES, resolveMediaPath } from "@indinite/db/media";

export const runtime = "nodejs";

type Params = { params: Promise<{ path: string[] }> };

/** Serves uploaded media from MEDIA_DIR on the app server's disk. */
export async function GET(_req: Request, { params }: Params) {
  const full = resolveMediaPath((await params).path.join("/"));
  if (!full) return new Response("Not found", { status: 404 });

  try {
    const info = await stat(full);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    const body = await readFile(full);
    return new Response(body, {
      headers: {
        "Content-Type": MEDIA_CONTENT_TYPES[path.extname(full).toLowerCase()]!,
        "Content-Length": String(info.size),
        "Last-Modified": info.mtime.toUTCString(),
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        // SVGs opened directly must not run scripts.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
