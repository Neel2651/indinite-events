"use client";

import { useEffect } from "react";

/**
 * One service worker for the whole staff app (organiser panel, admin and the scanner): keeps the scanner
 * working with no signal and shows an offline page for everything else. A site can have only one per scope.
 */
export function RegisterAppSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Development: no service worker. `next dev` keeps the same file names between edits, so a cached copy would
    // show old code and styles. Remove one left from earlier. (`next build && next start` registers it as live.)
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()));
      return;
    }
    void navigator.serviceWorker.register("/scan-sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
