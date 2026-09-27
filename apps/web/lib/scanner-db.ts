"use client";

import Dexie, { type EntityTable } from "dexie";
import type { ManifestTicket, ScanResult } from "@indinite/core";

/** Offline store on the gate device (SPEC §4.5). */
export interface CachedManifest {
  eventId: string;
  title: string;
  publicKeyHex: string;
  sessions: { id: string; label: string; startsAt: string; endsAt: string }[];
  tickets: ManifestTicket[];
  downloadedAt: string;
  /** Server time of the last successful sync, for incremental admission updates. */
  lastSyncAt?: string;
}

export interface LocalAdmission {
  key: string; // `${ticketId}:${sessionId}`
  eventId: string;
  ticketId: string;
  sessionId: string;
  scannedAt: string;
  gate: string;
}

export interface QueuedScan {
  clientScanId: string;
  eventId: string;
  ticketId: string | null;
  sessionId: string;
  gate: string;
  deviceId: string;
  result: ScanResult;
  reason?: string;
  scannedAt: string;
  synced: 0 | 1;
  /** Decided on the device without the server (counts towards the offline limit until synced). */
  offline?: 0 | 1;
}

export const scannerDb = new Dexie("indinite-scanner") as Dexie & {
  manifests: EntityTable<CachedManifest, "eventId">;
  admissions: EntityTable<LocalAdmission, "key">;
  scans: EntityTable<QueuedScan, "clientScanId">;
};

scannerDb.version(1).stores({
  manifests: "eventId",
  admissions: "key, eventId",
  scans: "clientScanId, [eventId+synced], scannedAt",
});

export function deviceId(): string {
  try {
    let id = localStorage.getItem("indinite-device-id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("indinite-device-id", id);
    }
    return id;
  } catch {
    return "unknown-device";
  }
}
