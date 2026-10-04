"use client";

import { useEffect, useRef } from "react";

/**
 * Organiser's Meta pixel (SPEC §4.11). Rendered only by an event's page and its confirmation page when the event has
 * a pixel ID, never in a layout. Every call goes to this one pixel (trackSingle), and only while it's on screen:
 * leaving the page turns tracking off, and Meta's automatic PageView on in-app navigation is disabled.
 */

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[]; push?: unknown; loaded?: boolean; version?: string; disablePushState?: boolean };
type PixelWindow = Window & { fbq?: Fbq; _fbq?: Fbq };

export interface PixelEvent {
  name: string;
  data?: Record<string, unknown>;
  options?: { eventID?: string };
  custom?: boolean;
  /** Fire once per browser: e.g. `purchase:OME-7K3F9Q`, so a refresh or the back button never repeats it. */
  onceKey?: string;
}

let activePixel: string | null = null;
const initialised = new Set<string>();

/** Meta's base code, as in the brief, without the automatic PageView. */
function loadFbq(): Fbq {
  const w = window as PixelWindow;
  if (w.fbq) return w.fbq;
  const n = function (...args: unknown[]) {
    if (n.callMethod) n.callMethod(...args);
    else n.queue!.push(args);
  } as Fbq;
  w.fbq = n;
  if (!w._fbq) w._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  n.disablePushState = true;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);
  return n;
}

function seen(key: string): boolean {
  try {
    return window.localStorage.getItem(`pixel:${key}`) !== null;
  } catch {
    return false;
  }
}

function remember(key: string) {
  try {
    window.localStorage.setItem(`pixel:${key}`, String(Date.now()));
  } catch {
    // Private mode or blocked storage: Meta still de-duplicates by eventID.
  }
}

/** Standard event to the pixel on this page; does nothing when the page has none. */
export function track(name: string, data?: Record<string, unknown>, options?: { eventID?: string }) {
  const fbq = (window as PixelWindow).fbq;
  if (activePixel && fbq) fbq("trackSingle", activePixel, name, data ?? {}, options ?? {});
}

export function trackCustom(name: string, data?: Record<string, unknown>) {
  const fbq = (window as PixelWindow).fbq;
  if (activePixel && fbq) fbq("trackSingleCustom", activePixel, name, data ?? {});
}

export function MetaPixel({ pixelId, events = [] }: { pixelId: string; events?: PixelEvent[] }) {
  const eventsKey = JSON.stringify(events);
  // Per page view (kept across React's development double-run and the confirmation page's refreshes).
  const pageViewSent = useRef(false);
  const sent = useRef(new Set<string>());

  useEffect(() => {
    const fbq = loadFbq();
    fbq.disablePushState = true;
    if (!initialised.has(pixelId)) {
      // No automatic events (Meta's own button clicks and page scraping): only the events listed in SPEC §4.11.
      fbq("set", "autoConfig", false, pixelId);
      fbq("init", pixelId);
      initialised.add(pixelId);
    }
    activePixel = pixelId;

    if (!pageViewSent.current) {
      pageViewSent.current = true;
      fbq("trackSingle", pixelId, "PageView");
    }
    for (const e of JSON.parse(eventsKey) as PixelEvent[]) {
      const id = JSON.stringify(e);
      if (sent.current.has(id) || (e.onceKey && seen(e.onceKey))) continue;
      sent.current.add(id);
      if (e.custom) trackCustom(e.name, e.data);
      else track(e.name, e.data, e.options);
      if (e.onceKey) remember(e.onceKey);
    }

    // ButtonClick for any button or link marked data-pixel-button="get_directions".
    const onClick = (ev: MouseEvent) => {
      const el = ev.target instanceof Element ? ev.target.closest("[data-pixel-button]") : null;
      const button = el?.getAttribute("data-pixel-button");
      if (button) trackCustom("ButtonClick", { button });
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (activePixel === pixelId) activePixel = null;
    };
  }, [pixelId, eventsKey]);

  return (
    <noscript>
      <img height="1" width="1" style={{ display: "none" }} alt="" src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`} />
    </noscript>
  );
}
