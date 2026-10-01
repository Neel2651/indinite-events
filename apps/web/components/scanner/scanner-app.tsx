"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  decideForTicket,
  decideScan,
  gatesOpenAt,
  normalisePassCode,
  offlineScansLeft,
  OFFLINE_SCAN_LIMIT,
  type ManifestTicket,
  type ScanDecision,
  type ScanResult,
} from "@indinite/core";
import { authClient } from "@/lib/auth-client";
import { scannerDb, deviceId, type CachedManifest, type QueuedScan } from "@/lib/scanner-db";

interface ScanEvent {
  id: string;
  title: string;
  canManualAdmit: boolean;
  sessions: { id: string; label: string; startsAt: string; endsAt: string }[];
}

interface Setup {
  event: ScanEvent;
  sessionId: string;
  gate: string;
}

const TZ = "Europe/London";
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const londonDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

/** Tonight's session, else the next one, else the last. */
function defaultSession(event: ScanEvent): string {
  const today = londonDay(new Date());
  const tonight = event.sessions.find((s) => londonDay(new Date(s.startsAt)) === today);
  if (tonight) return tonight.id;
  const next = event.sessions.find((s) => new Date(s.endsAt) > new Date());
  return (next ?? event.sessions[event.sessions.length - 1]!).id;
}

// ---------------------------------------------------------------------------------------------

/**
 * Ask the service worker to keep every script this page has loaded, for offline scanning, and wait until it has
 * (at most 8 s). On a first visit the worker may only take control after the scanner has loaded, so this waits
 * for that too. The camera is shown as ready only after this, so "ready" means "ready to work offline".
 */
function cacheLoadedFiles(): Promise<void> {
  if (!("serviceWorker" in navigator)) return Promise.resolve();
  const send = (sw: ServiceWorker) =>
    new Promise<void>((resolve) => {
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => u.startsWith(`${location.origin}/_next/static/`));
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      sw.postMessage({ type: "cache-urls", urls }, [channel.port2]);
    });
  const controlled = navigator.serviceWorker.controller
    ? Promise.resolve(navigator.serviceWorker.controller)
    : new Promise<ServiceWorker | null>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(navigator.serviceWorker.controller), { once: true }));
  return Promise.race([controlled.then((sw) => (sw ? send(sw) : undefined)), new Promise<void>((r) => setTimeout(r, 8000))]);
}

/** `panelHref`: link back to the organiser panel for staff who have one (gate-only staff don't). */
export function ScannerApp({ panelHref = null }: { panelHref?: string | null }) {
  const [events, setEvents] = useState<ScanEvent[] | null>(null);
  const [userName, setUserName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);

  useEffect(() => {
    fetch("/api/scan/events")
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/sign-in?next=/scan";
          return;
        }
        const data = (await r.json()) as { events: ScanEvent[]; user: { name: string } };
        setEvents(data.events);
        setUserName(data.user.name);
      })
      .catch(async () => {
        // Offline: fall back to events already downloaded on this device.
        const cached = await scannerDb.manifests.toArray();
        setEvents(cached.map((m) => ({ id: m.eventId, title: m.title, canManualAdmit: false, sessions: m.sessions })));
        if (!cached.length) setError("You're offline and no events are saved on this device yet.");
      });
  }, []);

  // Scanning is its own step in the browser history, so the phone's Back gesture (or the browser's Back button)
  // returns to this setup screen instead of leaving the scanner; Back from setup then leaves as normal.
  useEffect(() => {
    const onPop = () => setSetup(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const startScanning = (s: Setup) => {
    window.history.pushState({ scanner: "scanning" }, "");
    setSetup(s);
  };
  const stopScanning = () => {
    if ((window.history.state as { scanner?: string } | null)?.scanner === "scanning") window.history.back();
    else setSetup(null);
  };

  if (setup) return <Scanning setup={setup} onExit={stopScanning} />;
  return <SetupScreen events={events} userName={userName} error={error} onStart={startScanning} panelHref={panelHref} />;
}

// ---------------------------------------------------------------------------------------------

function SetupScreen({ events, userName, error, onStart, panelHref }: { events: ScanEvent[] | null; userName: string; error: string | null; onStart: (s: Setup) => void; panelHref: string | null }) {
  const [eventId, setEventId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [gate, setGate] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!events?.length) return;
    const first = events[0]!;
    setEventId(first.id);
    setSessionId(defaultSession(first));
    try {
      setGate(localStorage.getItem("indinite-gate") ?? "Gate A");
    } catch {
      setGate("Gate A");
    }
  }, [events]);

  const event = events?.find((e) => e.id === eventId);

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!event) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/scan/manifest?eventId=${event.id}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Couldn't download passes.");
      const m = await res.json();
      await saveManifest(m);
    } catch (err) {
      // Offline start is fine if this device already has the passes.
      if (!(await scannerDb.manifests.get(event.id))) {
        setProblem(err instanceof Error ? err.message : "Couldn't download passes. Check your connection.");
        setBusy(false);
        return;
      }
    }
    try {
      localStorage.setItem("indinite-gate", gate.trim());
    } catch {}
    onStart({ event, sessionId, gate: gate.trim() || "Gate" });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-brand-navy px-[max(1.25rem,env(safe-area-inset-left))] pt-[calc(env(safe-area-inset-top)+2rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)] text-white">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-display text-lg font-bold text-brand-orange">
          <img src="/brand/indinite-mark.png" alt="" width={32} height={28} className="h-7 w-auto" />
          <span>
            INDINITE <span className="font-sans font-normal text-on-dark-muted">scanner</span>
          </span>
        </p>
        <div className="flex items-center gap-2">
          {panelHref && (
            <a
              href={panelHref}
              aria-label="Back to organiser panel"
              className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full border border-white/25 py-2 pr-4 pl-2.5 text-sm font-semibold active:bg-white/15"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back
            </a>
          )}
          <button
            type="button"
            onClick={async () => {
              await authClient.signOut();
              window.location.href = "/sign-in";
            }}
            className="min-h-11 whitespace-nowrap rounded-full border border-white/25 px-4 text-sm font-semibold active:bg-white/15"
          >
            Sign out
          </button>
        </div>
      </div>
      <h1 className="mt-6 text-3xl text-white">Gate scanning</h1>
      {userName && <p className="mt-1 text-on-dark-muted">Signed in as {userName}</p>}

      {events === null ? (
        <p className="mt-10 text-on-dark-muted">Loading events…</p>
      ) : events.length === 0 ? (
        <p className="mt-10 text-on-dark-muted">{error ?? "There are no events you can scan at right now."}</p>
      ) : (
        <form onSubmit={start} className="mt-8 space-y-5">
          <label className="block text-sm font-semibold">
            Event
            <select
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                const ev = events.find((x) => x.id === e.target.value);
                if (ev) setSessionId(defaultSession(ev));
              }}
              className="mt-1 w-full rounded-md border border-white/20 bg-brand-navy px-3 py-3 text-base"
            >
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
          {event && (
            <label className="block text-sm font-semibold">
              Night
              <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} className="mt-1 w-full rounded-md border border-white/20 bg-brand-navy px-3 py-3 text-base">
                {event.sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} · {dayFmt.format(new Date(s.startsAt))}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-sm font-semibold">
            Gate
            <input value={gate} onChange={(e) => setGate(e.target.value)} required maxLength={60} className="mt-1 w-full rounded-md border border-white/20 bg-transparent px-3 py-3 text-base" />
          </label>
          {problem && <p className="rounded-md bg-danger/20 px-3 py-2 text-sm">{problem}</p>}
          <button type="submit" disabled={busy || !event} className="btn-cta w-full py-4 text-lg disabled:opacity-60">
            {busy ? "Downloading passes…" : "Start scanning"}
          </button>
          <p className="text-center text-xs text-on-dark-muted">Passes are saved on this phone, so scanning keeps working without signal.</p>
        </form>
      )}
    </div>
  );
}

async function saveManifest(m: {
  event: { id: string; title: string; sessions: CachedManifest["sessions"] };
  tickets: ManifestTicket[];
  admissions: { ticketId: string; sessionId: string; scannedAt: string; gate: string }[];
  publicKeyHex: string;
  generatedAt: string;
}) {
  const existing = await scannerDb.manifests.get(m.event.id);
  await scannerDb.transaction("rw", scannerDb.manifests, scannerDb.admissions, async () => {
    await scannerDb.manifests.put({
      eventId: m.event.id,
      title: m.event.title,
      publicKeyHex: m.publicKeyHex,
      sessions: m.event.sessions,
      tickets: m.tickets,
      downloadedAt: m.generatedAt,
      lastSyncAt: existing?.lastSyncAt ?? m.generatedAt,
    });
    await scannerDb.admissions.bulkPut(
      m.admissions.map((a) => ({ key: `${a.ticketId}:${a.sessionId}`, eventId: m.event.id, ...a })),
    );
  });
}

// ---------------------------------------------------------------------------------------------

interface Shown {
  decision: ScanDecision;
  manual?: boolean;
}

function Scanning({ setup, onExit }: { setup: Setup; onExit: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const manifestRef = useRef<CachedManifest | null>(null);
  const ticketsRef = useRef<Map<string, ManifestTicket>>(new Map());
  const admissionsRef = useRef<Map<string, { scannedAt: string; gate: string }>>(new Map());
  const busyRef = useRef(false);
  const lastTokenRef = useRef<{ token: string; at: number } | null>(null);

  const [shown, setShown] = useState<Shown | null>(null);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [admittedTonight, setAdmittedTonight] = useState(0);
  const [camera, setCamera] = useState<"starting" | "on" | "blocked">("starting");
  const [manualOpen, setManualOpen] = useState(false);
  const [offlinePending, setOfflinePending] = useState(0);
  const offlinePendingRef = useRef(0);
  const [blocked, setBlocked] = useState(false);

  const session = setup.event.sessions.find((s) => s.id === setup.sessionId)!;
  const notTonight = londonDay(new Date(session.startsAt)) !== londonDay(new Date());
  const [codeFailures, setCodeFailures] = useState<number[]>([]);
  const recentFailures = codeFailures.filter((t) => Date.now() - t < 120_000);
  const codesLocked = recentFailures.length >= 5 && Date.now() - recentFailures[recentFailures.length - 1]! < 30_000;

  const loadLocal = useCallback(async () => {
    const m = await scannerDb.manifests.get(setup.event.id);
    manifestRef.current = m ?? null;
    ticketsRef.current = new Map((m?.tickets ?? []).map((t) => [t.id, t]));
    const adm = await scannerDb.admissions.where("eventId").equals(setup.event.id).toArray();
    admissionsRef.current = new Map(adm.map((a) => [a.key, { scannedAt: a.scannedAt, gate: a.gate }]));
    setAdmittedTonight(adm.filter((a) => a.sessionId === setup.sessionId).length);
    const pending = await scannerDb.scans.where({ eventId: setup.event.id, synced: 0 }).toArray();
    setQueued(pending.length);
    const offline = pending.filter((p) => p.offline === 1).length;
    offlinePendingRef.current = offline;
    setOfflinePending(offline);
  }, [setup.event.id, setup.sessionId]);

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    const pending = await scannerDb.scans.where({ eventId: setup.event.id, synced: 0 }).limit(200).toArray();
    const since = manifestRef.current?.lastSyncAt;
    try {
      const res = await fetch("/api/scan/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: setup.event.id, since, scans: pending.map(({ synced: _s, eventId: _e, ...s }) => s) }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        results: { clientScanId: string; result: ScanResult }[];
        admissions: { ticketId: string; sessionId: string; scannedAt: string; gate: string }[];
        serverTime: string;
      };
      await scannerDb.transaction("rw", scannerDb.scans, scannerDb.admissions, scannerDb.manifests, async () => {
        for (const r of data.results) await scannerDb.scans.update(r.clientScanId, { synced: 1, result: r.result });
        await scannerDb.admissions.bulkPut(data.admissions.map((a) => ({ key: `${a.ticketId}:${a.sessionId}`, eventId: setup.event.id, ...a })));
        await scannerDb.manifests.update(setup.event.id, { lastSyncAt: data.serverTime });
      });
      await loadLocal();
    } catch {
      // Still offline or flaky: try again on the next tick.
    }
  }, [setup.event.id, loadLocal]);

  /** Pick up bookings made during the night. */
  const refreshManifest = useCallback(async () => {
    if (!navigator.onLine) return false;
    try {
      const res = await fetch(`/api/scan/manifest?eventId=${setup.event.id}`, { cache: "no-store" });
      if (!res.ok) return false;
      await saveManifest(await res.json());
      await loadLocal();
      return true;
    } catch {
      return false;
    }
  }, [setup.event.id, loadLocal]);

  const record = useCallback(
    async (decision: ScanDecision, extra?: { result?: ScanResult; reason?: string; synced?: boolean; prior?: { scannedAt: string; gate: string }; clientScanId?: string; offline?: boolean }) => {
      const ticketId = "ticket" in decision ? decision.ticket.id : (decision.ticketId ?? null);
      const result = extra?.result ?? decision.result;
      const scannedAt = new Date().toISOString();
      const scan: QueuedScan = {
        // Same id as any server claim for this scan, so a slow claim + offline fallback is stored once.
        clientScanId: extra?.clientScanId ?? crypto.randomUUID(),
        eventId: setup.event.id,
        ticketId,
        sessionId: setup.sessionId,
        gate: setup.gate,
        deviceId: deviceId(),
        result,
        reason: extra?.reason,
        scannedAt,
        // Already recorded on the server by a claim: don't send it again.
        synced: extra?.synced ? 1 : 0,
        offline: extra?.offline ? 1 : 0,
      };
      await scannerDb.transaction("rw", scannerDb.scans, scannerDb.admissions, async () => {
        await scannerDb.scans.put(scan);
        if (ticketId && (result === "admitted" || result === "manual_admit")) {
          await scannerDb.admissions.put({ key: `${ticketId}:${setup.sessionId}`, eventId: setup.event.id, ticketId, sessionId: setup.sessionId, scannedAt, gate: setup.gate });
        } else if (ticketId && result === "already_used" && extra?.prior) {
          await scannerDb.admissions.put({ key: `${ticketId}:${setup.sessionId}`, eventId: setup.event.id, ticketId, sessionId: setup.sessionId, ...extra.prior });
        }
      });
      await loadLocal();
      if (!extra?.synced) void sync();
    },
    [setup, loadLocal, sync],
  );

  const present = useCallback((decision: ScanDecision, manual = false) => {
    busyRef.current = true;
    setShown({ decision, manual });
    navigator.vibrate?.(decision.result === "admitted" ? 90 : decision.result === "already_used" ? [80, 60, 80] : [260]);
  }, []);

  const show = useCallback(
    async (decision: ScanDecision, manual = false, clientScanId?: string, offline = false) => {
      busyRef.current = true;
      await record(decision, { clientScanId, offline });
      present(decision, manual);
    },
    [record, present],
  );

  /**
   * Online: ask the server, which verifies and records the admission atomically (strict once per night).
   * Returns null if offline or the server doesn't answer within 1.5 s; the caller then decides locally.
   */
  const serverClaim = useCallback(
    async (payload: { token: string } | { code: string }, clientScanId: string): Promise<ScanDecision | null> => {
      if (!navigator.onLine) return null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      try {
        const res = await fetch("/api/scan/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({ eventId: setup.event.id, sessionId: setup.sessionId, gate: setup.gate, deviceId: deviceId(), clientScanId, ...payload }),
        });
        if (!res.ok) return null;
        const c = (await res.json()) as { result: ScanResult; reason?: "unreadable" | "bad_signature" | "unknown_ticket"; ticketId?: string; prior?: { scannedAt: string; gate: string } };
        let ticket = c.ticketId ? ticketsRef.current.get(c.ticketId) : undefined;
        if (c.ticketId && !ticket && (await refreshManifest())) ticket = ticketsRef.current.get(c.ticketId);
        let decision: ScanDecision;
        if (!ticket || c.result === "invalid") decision = { result: "invalid", reason: c.reason ?? "unknown_ticket", ticketId: c.ticketId };
        else if (c.result === "already_used") decision = { result: "already_used", ticket, prior: c.prior ?? { scannedAt: new Date().toISOString(), gate: "another gate" } };
        else if (c.result === "admitted" || c.result === "manual_admit") decision = { result: "admitted", ticket };
        else if (c.result === "wrong_session") decision = { result: "wrong_session", ticket };
        else if (c.result === "too_early") decision = { result: "too_early", ticket, opensAt: gatesOpenAt(session.startsAt) };
        else decision = { result: "cancelled", ticket };
        await record(decision, { synced: true, prior: c.prior, clientScanId });
        return decision;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    [setup, session.startsAt, record, refreshManifest],
  );

  /** Offline and already used the allowance: refuse to scan until back online and synced. */
  const offlineBlocked = useCallback(() => {
    if (offlineScansLeft(offlinePendingRef.current) > 0) return false;
    busyRef.current = true;
    setBlocked(true);
    navigator.vibrate?.([260, 80, 260]);
    return true;
  }, []);

  const check = useCallback(
    async (token: string) => {
      const m = manifestRef.current;
      if (!m || busyRef.current) return;
      const now = Date.now();
      if (lastTokenRef.current && lastTokenRef.current.token === token && now - lastTokenRef.current.at < 4000) return;
      lastTokenRef.current = { token, at: now };
      busyRef.current = true;
      const input = {
        token,
        publicKeyHex: m.publicKeyHex,
        sessionId: setup.sessionId,
        findTicket: (id: string) => ticketsRef.current.get(id),
        findAdmission: (id: string, s: string) => admissionsRef.current.get(`${id}:${s}`),
        // Gates open 1 hour before the night starts.
        nightStartsAt: session.startsAt,
        now: new Date(),
      };
      const local = decideScan(input);
      const clientScanId = crypto.randomUUID();
      // Forged or unreadable codes are refused on the spot; no need to ask the server.
      if (local.result === "invalid" && local.reason !== "unknown_ticket") {
        if (!navigator.onLine && offlineBlocked()) return;
        await show(local, false, clientScanId, !navigator.onLine);
        return;
      }
      const online = await serverClaim({ token }, clientScanId);
      if (online) {
        present(online);
        return;
      }
      if (offlineBlocked()) return;
      // Offline (or server too slow): decide on the device; the sync reuses clientScanId, so if the server did
      // record the claim, it answers with that result instead of logging a second scan.
      await show(local, false, clientScanId, true);
    },
    [setup.sessionId, session.startsAt, serverClaim, show, present, offlineBlocked],
  );

  // Camera
  useEffect(() => {
    let scanner: import("qr-scanner").default | null = null;
    let cancelled = false;
    void (async () => {
      await loadLocal();
      const QrScanner = (await import("qr-scanner")).default;
      // The decoder runs in a web worker loaded on first use: load it now, while online.
      await QrScanner.createQrEngine()
        .then((engine) => (engine as unknown as { terminate?: () => void }).terminate?.())
        .catch(() => {});
      if (cancelled || !videoRef.current) return;
      scanner = new QrScanner(videoRef.current, (r) => void check(r.data), {
        returnDetailedScanResult: true,
        preferredCamera: "environment",
        maxScansPerSecond: 8,
        highlightScanRegion: false,
      });
      try {
        await scanner.start();
        await cacheLoadedFiles();
        if (cancelled) return;
        setCamera("on");
      } catch {
        setCamera("blocked");
      }
    })();
    return () => {
      cancelled = true;
      scanner?.destroy();
    };
  }, [check, loadLocal]);

  // Sync loop + connectivity
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    const onOnline = () => {
      update();
      void sync();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", update);
    const syncTimer = setInterval(() => void sync(), 10_000);
    const manifestTimer = setInterval(() => void refreshManifest(), 120_000);
    void sync();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", update);
      clearInterval(syncTimer);
      clearInterval(manifestTimer);
    };
  }, [sync, refreshManifest]);

  // Back online and the saved scans have synced: resume automatically.
  useEffect(() => {
    if (blocked && online && offlineScansLeft(offlinePending) > 0) {
      setBlocked(false);
      setTimeout(() => (busyRef.current = false), 300);
    }
  }, [blocked, online, offlinePending]);

  function dismiss() {
    setShown(null);
    lastTokenRef.current = { token: lastTokenRef.current?.token ?? "", at: Date.now() };
    setTimeout(() => (busyRef.current = false), 300);
  }

  async function manualAdmit(reason: string) {
    if (!shown || !("ticket" in shown.decision)) return;
    const offline = !navigator.onLine;
    if (offline && offlineScansLeft(offlinePendingRef.current) === 0) {
      setShown(null);
      setBlocked(true);
      return;
    }
    await record(shown.decision, { result: "manual_admit", reason, offline });
    setShown({ decision: { result: "admitted", ticket: shown.decision.ticket }, manual: true });
    navigator.vibrate?.(90);
  }

  async function lookupCode(code: string) {
    const wanted = normalisePassCode(code);
    setManualOpen(false);
    busyRef.current = true;
    const fail = () => setCodeFailures((f) => [...f.filter((t) => Date.now() - t < 120_000), Date.now()]);
    if (!wanted) {
      fail();
      await show({ result: "invalid", reason: "unknown_ticket" }, true);
      return;
    }
    const clientScanId = crypto.randomUUID();
    const online = await serverClaim({ code: wanted }, clientScanId);
    if (online) {
      if (online.result === "invalid") fail();
      else setCodeFailures([]);
      present(online, true);
      return;
    }
    if (offlineBlocked()) return;
    const matches = [...ticketsRef.current.values()].filter((t) => t.code === wanted);
    if (matches.length !== 1) {
      fail();
      await show({ result: "invalid", reason: "unknown_ticket" }, true, clientScanId, true);
      return;
    }
    await show(
      decideForTicket(matches[0]!.id, {
        sessionId: setup.sessionId,
        findTicket: (id) => ticketsRef.current.get(id),
        findAdmission: (id, s) => admissionsRef.current.get(`${id}:${s}`),
        nightStartsAt: session.startsAt,
        now: new Date(),
      }),
      true,
      clientScanId,
      true,
    );
  }


  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white">
      {/* The installed app draws under the status bar and notch (viewportFit: cover), so pad by the safe areas. */}
      <header className="z-10 flex items-center justify-between gap-3 bg-brand-navy/95 pt-[calc(env(safe-area-inset-top)+0.5rem)] pr-[max(1rem,env(safe-area-inset-right))] pb-3 pl-[max(0.75rem,env(safe-area-inset-left))]">
        <button
          type="button"
          onClick={onExit}
          aria-label="Back to scanner setup"
          className="flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-white/25 py-2 pr-4 pl-2.5 text-sm font-semibold active:bg-white/15"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display font-semibold">{setup.event.title}</p>
          <p className="text-xs text-on-dark-muted">
            {session.label} · {dayFmt.format(new Date(session.startsAt))} · {setup.gate}
          </p>
        </div>
        <button type="button" onClick={onExit} className="min-h-11 shrink-0 rounded-full border border-white/25 px-3 text-xs font-semibold active:bg-white/15">
          Change
        </button>
      </header>

      {notTonight && (
        <p className="z-10 bg-warning px-4 py-2 text-center text-sm font-semibold text-white">
          You&apos;re scanning {session.label} ({dayFmt.format(new Date(session.startsAt))}), not tonight. Tap Change if that&apos;s wrong.
        </p>
      )}
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="aspect-square w-[70%] max-w-[320px] rounded-3xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
        <p className="absolute inset-x-0 top-6 text-center text-sm font-semibold drop-shadow">
          {camera === "blocked" ? "Camera blocked. Allow camera access, or enter codes by hand." : camera === "on" ? "Point the camera at a pass" : "Getting ready for offline scanning…"}
        </p>
      </div>

      <footer className="z-10 grid grid-cols-3 items-center gap-2 bg-brand-navy/95 px-[max(1rem,env(safe-area-inset-left))] pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] text-center text-xs">
        <div>
          <p className="font-display text-2xl font-bold">{admittedTonight}</p>
          <p className="text-on-dark-muted">in tonight</p>
        </div>
        <button type="button" disabled={codesLocked} onClick={() => setManualOpen(true)} className="rounded-full bg-white px-3 py-3 text-sm font-semibold text-brand-navy disabled:opacity-50">
          {codesLocked ? "Wait 30 s" : "Enter code"}
        </button>
        <div>
          <p className={`font-semibold ${online ? "text-success" : "text-warning"}`}>{online ? "Online" : "Offline"}</p>
          <p className="text-on-dark-muted">
            {offlinePending > 0 || !online
              ? `${offlineScansLeft(offlinePending)} of ${OFFLINE_SCAN_LIMIT} offline scans left`
              : queued
                ? `${queued} to sync`
                : "All synced"}
          </p>
        </div>
      </footer>

      {blocked && (
        <OfflineLimitScreen
          online={online}
          pending={offlinePending}
          onRetry={async () => {
            await sync();
            if (offlineScansLeft(offlinePendingRef.current) > 0) {
              setBlocked(false);
              setTimeout(() => (busyRef.current = false), 300);
            }
          }}
        />
      )}
      {manualOpen && <ManualEntry onCancel={() => setManualOpen(false)} onSubmit={lookupCode} />}
      {shown && (
        <ResultScreen
          shown={shown}
          sessions={setup.event.sessions}
          canManualAdmit={setup.event.canManualAdmit}
          onDone={dismiss}
          onManualAdmit={manualAdmit}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function ManualEntry({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-entry-title"
      className="absolute inset-0 z-20 flex items-end bg-black/60"
    >
      {/* Tapping outside the sheet closes it. */}
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onCancel} className="absolute inset-0 cursor-default" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(code);
        }}
        className="relative w-full space-y-4 rounded-t-3xl bg-white p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-brand-navy"
      >
        <h2 id="manual-entry-title" className="text-xl">
          Enter the code under the QR
        </h2>
        <label htmlFor="manual-code" className="sr-only">
          Pass code
        </label>
        <input
          id="manual-code"
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
          // Focus moves into the dialog that just opened (the gate phone's keyboard comes up straight away).
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. K7Q2-M9XA"
          inputMode="text"
          autoCapitalize="characters"
          className="w-full rounded-md border border-border px-4 py-3 text-center font-display text-2xl tracking-widest"
        />
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={onCancel} className="rounded-full border border-border py-3 font-semibold">
            Cancel
          </button>
          <button type="submit" className="btn-cta py-3">
            Check pass
          </button>
        </div>
      </form>
    </div>
  );
}

const TONE = {
  admitted: "bg-success",
  already_used: "bg-warning",
  wrong_session: "bg-danger",
  too_early: "bg-warning",
  cancelled: "bg-danger",
  invalid: "bg-danger",
} as const;

function ResultScreen({
  shown,
  sessions,
  canManualAdmit,
  onDone,
  onManualAdmit,
}: {
  shown: Shown;
  sessions: ScanEvent["sessions"];
  canManualAdmit: boolean;
  onDone: () => void;
  onManualAdmit: (reason: string) => void;
}) {
  const d = shown.decision;
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");

  // Green clears itself; amber/red wait for a tap so staff read them.
  useEffect(() => {
    if (d.result !== "admitted") return;
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, [d, onDone]);

  let title = "";
  let detail = "";
  if (d.result === "admitted") {
    title = "Admitted";
  } else if (d.result === "already_used") {
    title = "Already scanned";
    detail = `Scanned at ${timeFmt.format(new Date(d.prior.scannedAt))} at ${d.prior.gate}`;
  } else if (d.result === "wrong_session") {
    title = "Wrong night";
    const nights = sessions.filter((s) => d.ticket.validSessionIds.includes(s.id)).map((s) => dayFmt.format(new Date(s.startsAt)));
    detail = `This pass is for ${nights.join(", ") || "another night"}`;
  } else if (d.result === "too_early") {
    title = "Too early";
    detail = `Gates open at ${timeFmt.format(d.opensAt)}, 1 hour before the start. Ask them to come back then.`;
  } else if (d.result === "cancelled") {
    title = "Pass cancelled";
    detail = "This pass was refunded or cancelled";
  } else if (d.reason === "unknown_ticket") {
    // A genuine pass, but not one of this event's (e.g. another organiser's event): passes are only ever
    // accepted at their own event.
    title = "Not for this event";
    detail = "This pass is for a different event. Check the event name and night on their pass.";
  } else {
    title = "Not a valid pass";
    detail = d.reason === "unreadable" ? "This QR code isn't an Indinite pass" : "This pass has been altered or is fake";
  }

  const ticket = "ticket" in d ? d.ticket : null;
  const canOverride = canManualAdmit && (d.result === "already_used" || d.result === "wrong_session");

  return (
    <div role="alert" className={`absolute inset-0 z-30 flex flex-col items-center justify-center px-6 text-center text-white ${TONE[d.result]}`}>
      {/* The whole screen is a "next scan" button for fast gate flow; content sits above it and lets taps through. */}
      {!reasonOpen && <button type="button" aria-label="Scan the next pass" onClick={onDone} className="absolute inset-0 cursor-default" />}
      <div className="pointer-events-none relative flex flex-col items-center [&_button]:pointer-events-auto [&_form]:pointer-events-auto">
      <div className="text-7xl font-bold" aria-hidden>
        {d.result === "admitted" ? "✓" : d.result === "already_used" ? "!" : "✕"}
      </div>
      <p className="mt-4 font-display text-4xl font-bold">{title}</p>
      {detail && <p className="mt-3 text-lg font-semibold">{detail}</p>}
      {ticket && (
        <div className="mt-6 rounded-2xl bg-black/20 px-5 py-4 text-base">
          <p className="font-display text-xl font-semibold">{ticket.ticketTypeName}</p>
          <p className="mt-1">
            Pass {ticket.position} of {ticket.count} · {ticket.orderRef}
          </p>
          {ticket.attendeeName && <p className="mt-1">{ticket.attendeeName}</p>}
        </div>
      )}

      {canOverride && !reasonOpen && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setReasonOpen(true);
          }}
          className="mt-8 rounded-full bg-white px-6 py-3 font-semibold text-brand-navy"
        >
          Admit anyway
        </button>
      )}
      {reasonOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length >= 3) onManualAdmit(reason.trim());
          }}
          className="mt-6 w-full max-w-sm space-y-3"
        >
          <label className="block text-left text-sm font-semibold">
            Reason (required)
            {/* Focus the reason field the moment "Admit anyway" opens it. */}
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={300} className="mt-1 w-full rounded-md px-3 py-3 text-brand-navy" placeholder="e.g. Manager approved, bought wrong night" />
          </label>
          <button type="submit" className="w-full rounded-full bg-white py-3 font-semibold text-brand-navy">
            Admit and record reason
          </button>
        </form>
      )}
      </div>
      {!reasonOpen && d.result !== "admitted" && <p className="pointer-events-none absolute inset-x-0 bottom-10 text-sm opacity-90">Tap to scan the next pass</p>}
    </div>
  );
}

function OfflineLimitScreen({ online, pending, onRetry }: { online: boolean; pending: number; onRetry: () => void }) {
  const [trying, setTrying] = useState(false);
  return (
    <div role="alert" className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-danger px-6 text-center text-white">
      <div className="text-6xl font-bold" aria-hidden>
        ⏸
      </div>
      <p className="mt-4 font-display text-3xl font-bold">Reconnect to keep scanning</p>
      <p className="mt-3 max-w-sm text-lg font-semibold">
        This phone has scanned {OFFLINE_SCAN_LIMIT} passes without signal. Don&apos;t let anyone in on this phone until it&apos;s back online.
      </p>
      <p className="mt-2 max-w-sm text-sm opacity-90">
        {online ? `Back online. Syncing ${pending} scan${pending === 1 ? "" : "s"}…` : "Connect to Wi-Fi or mobile data. Scanning resumes once the saved scans have synced."}
      </p>
      <button
        type="button"
        disabled={trying}
        onClick={async () => {
          setTrying(true);
          await onRetry();
          setTrying(false);
        }}
        className="mt-8 rounded-full bg-white px-6 py-3 font-semibold text-brand-navy disabled:opacity-60"
      >
        {trying ? "Checking…" : "Try again"}
      </button>
    </div>
  );
}
