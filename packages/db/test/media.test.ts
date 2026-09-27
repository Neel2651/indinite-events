import path from "node:path";
import { describe, expect, it } from "vitest";
import { mediaDir, mediaUrl, resolveMediaPath } from "../src/media";

const root = "/srv/media";

describe("media paths", () => {
  it("resolves files inside the media dir", () => {
    expect(resolveMediaPath("events/demo/cover.svg", root)).toBe("/srv/media/events/demo/cover.svg");
  });

  it("refuses anything that escapes the media dir", () => {
    expect(resolveMediaPath("../secrets.png", root)).toBeNull();
    expect(resolveMediaPath("events/../../etc/passwd.png", root)).toBeNull();
    expect(resolveMediaPath("/etc/cover.png", root)).toBeNull();
    expect(resolveMediaPath("cover.png\0.txt", root)).toBeNull();
    expect(resolveMediaPath("", root)).toBeNull();
  });

  it("refuses types we don't serve", () => {
    expect(resolveMediaPath("events/demo/page.html", root)).toBeNull();
    expect(resolveMediaPath("events/demo/.env", root)).toBeNull();
  });

  it("resolves a relative MEDIA_DIR against the repo root, not the cwd", () => {
    const dir = mediaDir("./storage/media");
    expect(path.isAbsolute(dir)).toBe(true);
    expect(dir.endsWith(path.join("storage", "media"))).toBe(true);
    expect(dir).not.toContain(path.join("packages", "db"));
    expect(mediaDir("/abs/media")).toBe("/abs/media");
  });

  it("builds encoded URLs", () => {
    expect(mediaUrl("events/demo/cover image.svg")).toBe("/media/events/demo/cover%20image.svg");
  });
});
