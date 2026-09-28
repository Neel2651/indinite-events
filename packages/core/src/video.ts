/**
 * Event videos (SPEC §1): YouTube or Vimeo links only, embedded privacy-friendly (youtube-nocookie).
 * Returns null for anything else, so arbitrary sites can never be framed on event pages.
 */
export function embedUrlFor(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const id = /^[A-Za-z0-9_-]{6,20}$/;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = u.pathname === "/watch" ? u.searchParams.get("v") : u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    return v && id.test(v) ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === "youtu.be") {
    const v = u.pathname.slice(1);
    return id.test(v) ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const v = u.pathname.match(/(?:^|\/)(\d{6,12})(?:\/|$)/)?.[1];
    return v ? `https://player.vimeo.com/video/${v}` : null;
  }
  return null;
}

export const isSupportedVideoUrl = (url: string) => embedUrlFor(url) !== null;
