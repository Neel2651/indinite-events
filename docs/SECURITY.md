# Security review — tickets and gate scanning

Last reviewed: 27 Sep 2026. Scope: pass issue, QR codes, typed codes, gate scanning, customer links, checkout.

## Rule: a pass gets in once per night
A single-night pass is admitted once. A season pass is admitted once **per night** it covers.

| Threat | Protection | Tested in |
|---|---|---|
| Forged QR code | Ed25519 signature over `v1.<ticketId>`; private key only on the server (`QR_SIGNING_PRIVATE_KEY`), never in the browser bundle (checked by scanning the build). | `core/test/qr.test.ts`, `db/test/claim.db.test.ts` |
| Edited QR (swap ticket id) | Signature fails. | `claim.db.test.ts` |
| Genuine QR from another event | Ticket must belong to the event being scanned. | `claim.db.test.ts` |
| Screenshot shared / same QR at two gates | **Online:** the server records the admission atomically before the phone shows green; a unique index allows one admission per pass per night — 30 simultaneous scans of one QR → exactly 1 admitted. **Offline:** the phone refuses passes it has already let in, and syncs every 10 s; a conflict is recorded as "already used". | `claim.db.test.ts`, `scanning.db.test.ts` |
| Guessing a typed code | Codes are derived from the pass's signature (40 bits, Crockford base32), not from the ticket id, so another pass's code can't be worked out. Typed codes are limited to 30 per minute per staff member on the server and lock for 30 s on the phone after 5 misses. *(Fixed: codes were previously the last 8 hex characters of the ticket id, which increase by one within an order.)* | `core/test/scan.test.ts`, `claim.db.test.ts` |
| Refunded / cancelled pass | Refused ("Pass cancelled"); the server re-checks every offline admission. | `claim.db.test.ts`, `scanning.db.test.ts` |
| Wrong night | Refused ("Wrong night"); scanner shows a warning bar if the selected night isn't tonight. | `scan.test.ts` |
| Retries after a network timeout | One `clientScanId` per scan is used for both the server claim and any offline fallback, so a slow claim is never logged twice. | `claim.db.test.ts` |
| Override abuse | "Admit anyway" needs the `scan.manualAdmit` permission (owner/manager) and a reason; audited. | `scanning.db.test.ts` |
| Who scanned what | Every scan stores device, gate, staff user and time; shown per pass on the order page. | — |
| Long offline stretches | **Offline limit: 5 scans per phone.** A phone may decide at most 5 scans without the server (no signal, or the server didn't answer in 2 s). The 6th is refused with "Reconnect to keep scanning" and nothing is recorded; scanning resumes automatically once back online and the 5 have synced. | `core/test/scan.test.ts`, `e2e/tests/offline-limit.ts` |

## Other checks
- **Customer links** (passes page, pay page): HMAC-signed, expiring, bound to the order reference. Find my tickets needs email + order reference, 5 attempts/hour per IP and per email.
- **Checkout**: rate-limited (20 per 10 min per IP, 8 per email) so scripts can't hold all seats with unpaid bookings. Coupon checks: 20/hour per IP.
- **Scanner pass list** contains no emails, phone numbers or QR tokens (only ids, pass codes, type, order ref, attendee name), and needs `scan.perform` for that organiser.
- **Organiser scoping**: every organiser page/action resolves the organiser from the URL + signed-in membership (`requireOrg`) and filters queries by it; never from form data.
- **Headers**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS, `Permissions-Policy` (camera only on our own pages).
- **Media**: path traversal blocked; SVGs served with a sandboxing CSP.

## Known limits (accepted)
- **Offline window:** if two phones are both offline and scan the same screenshot before syncing, both may let the person in; the second is logged as "already used" when they sync. The offline limit caps this at 5 scans per phone. Keep gate phones online where possible (venue Wi-Fi / mobile data).
- **Passes bought after a phone went offline** aren't in its pass list until it reconnects (it refreshes every 2 minutes and whenever it meets an unknown pass online).
- **Staff accounts** are trusted with the scanner; misuse is traceable (every scan records the user).
