"use client";

import { useEffect } from "react";

/** Service worker keeps the scanner page and its code available with no signal. */
export function RegisterScannerSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/scan-sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
