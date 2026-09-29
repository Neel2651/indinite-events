"use client";

import { useEffect } from "react";

/**
 * One service worker for the whole staff app (organiser panel, admin and the scanner): keeps the scanner
 * working with no signal and shows an offline page for everything else. A site can have only one per scope.
 */
export function RegisterAppSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/scan-sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
