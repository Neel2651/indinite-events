import { existsSync } from "node:fs";
import path from "node:path";

/** Public URL prefix for files in MEDIA_DIR, served by apps/web/app/media/[...path]/route.ts. */
export const MEDIA_URL_PREFIX = "/media";

export const MEDIA_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

function repoRoot(from = process.cwd()): string {
  let dir = from;
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
  return dir;
}

/**
 * Absolute media directory. A relative MEDIA_DIR is resolved against the repo root, so apps/web
 * (cwd apps/web) and scripts (cwd packages/db) agree on one folder.
 */
export function mediaDir(env = process.env.MEDIA_DIR): string {
  const dir = env?.trim() || "./storage/media";
  return path.isAbsolute(dir) ? dir : path.resolve(repoRoot(), dir);
}

/**
 * Absolute path for a media-relative path, or null if it would escape MEDIA_DIR
 * (`..`, absolute paths, NUL bytes) or has a type we don't serve.
 */
export function resolveMediaPath(relative: string, root = mediaDir()): string | null {
  if (!relative || relative.includes("\0")) return null;
  const full = path.resolve(root, relative);
  if (!full.startsWith(root + path.sep)) return null;
  if (!MEDIA_CONTENT_TYPES[path.extname(full).toLowerCase()]) return null;
  return full;
}

export function mediaUrl(relative: string): string {
  return `${MEDIA_URL_PREFIX}/${relative.split(path.sep).map(encodeURIComponent).join("/")}`;
}
