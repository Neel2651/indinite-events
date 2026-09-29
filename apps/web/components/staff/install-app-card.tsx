"use client";

import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISMISS_KEY = "indinite-install-dismissed";

/**
 * "Add Indinite to your home screen": the browser's own install prompt on Android / Chrome / Edge, the two
 * Share steps on iPhone and iPad (Safari has no prompt). Hidden once installed or dismissed on this device.
 */
export function InstallAppCard() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [mode, setMode] = useState<"hidden" | "prompt" | "ios">("hidden");

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {}
    if (standalone || dismissed) return;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
      setMode("prompt");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const t = ios ? setTimeout(() => setMode("ios"), 0) : undefined;
    const onInstalled = () => setMode("hidden");
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  if (mode === "hidden") return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setMode("hidden");
  };

  return (
    <section className="mb-6 flex flex-col gap-4 rounded-lg border border-brand-orange/40 bg-card p-5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <img src="/app-icon-192.png" alt="" width={48} height={48} className="size-12 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">Add Indinite to your home screen</h2>
          {mode === "ios" ? (
            <p className="text-sm text-muted-foreground">
              In Safari, tap <strong>Share</strong> (the square with an arrow), then <strong>Add to Home Screen</strong>. It opens full screen, like an app.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Bookings, orders, check-ins and the gate scanner in one app. No app store needed.</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {mode === "prompt" && prompt && (
          <button
            type="button"
            onClick={async () => {
              await prompt.prompt();
              const choice = await prompt.userChoice;
              if (choice.outcome === "accepted") setMode("hidden");
            }}
            className="btn-cta"
          >
            Install app
          </button>
        )}
        <button type="button" onClick={dismiss} className="rounded-full border border-border px-4 py-2.5 text-sm font-semibold">
          Not now
        </button>
      </div>
    </section>
  );
}
