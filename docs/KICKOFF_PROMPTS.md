# Claude Code — milestone prompts

## Status
- M0 ✅ done (monorepo, web, worker, core, db, theme, health route, public listing + event page shells).
- M1 🟡 partly done: all models + indexes, `withTransaction`, `audited()` + request context, `quota.*`,
  permission matrix with tests, seed script. **Remaining:** Better Auth + organization plugin, super_admin
  flag, session → `AuthUser` mapping for `can()`, seeding auth users, ESLint.


Paste one prompt per session, in order. Start each in plan mode (Shift+Tab), review the plan, then let it
build. Commit and review at the end of every milestone before moving on.

---

## M0 — Scaffold (27 Sep)
Read CLAUDE.md and docs/SPEC.md. Scaffold the monorepo exactly as described in CLAUDE.md: pnpm workspaces,
Turborepo, apps/web (Next.js App Router, TypeScript strict, Tailwind v4, shadcn/ui initialised using the
existing apps/web/app/globals.css theme, Poppins + Inter via next/font), apps/worker (BullMQ), packages/db,
packages/core, packages/emails. Add ESLint, Prettier, Vitest, Playwright, a .env.example from SPEC §6, and
`pnpm dev/test/lint/typecheck` scripts. Add a health route that pings MongoDB and Redis. No features yet.

## M1 — Data layer, auth, permissions, audit (27–28 Sep)
**Use this shorter prompt now:** Read CLAUDE.md. The data layer, audit helper, quota and permissions are
already built (see "Where things live"). Add Better Auth with the MongoDB adapter and organization plugin
(roles owner/manager/box_office/scanner/finance), a super_admin flag on users, a `getAuthUser()` helper that
maps the session to `AuthUser` for `can()`, sign-in pages in the Indinite theme, protected `/admin` and
`/org` layouts, and extend the seed with a super admin and an organizer owner linked via `authOrgId`.
Add ESLint (flat config). Original prompt for reference:

Implement packages/db: Mongo connection, `withTransaction` helper, all Mongoose models and indexes from
SPEC §3. Implement packages/core/audit: AsyncLocalStorage request context (actor, organizerId, ip,
userAgent, requestId) and `audited(session, {action, entity, before, after, reason})` that writes a
redacted field-level diff. Set up Better Auth with the organization plugin (roles from SPEC §2) and a
super_admin flag. Implement `can(user, permission, resource)` from the SPEC §2 matrix with exhaustive
Vitest tests. Add a seed script: one super admin, one organizer with an owner user.

## M2 — Events admin + public pages (29–30 Sep)
Super-admin CRUD for events (with nights/sessions), ticket types (price, quota, sales window, maxPerOrder),
organizers (commission). S3 presigned image upload; video as YouTube/Vimeo URL. Soft delete, hard delete
only when no orders. Every mutation via audited services. Public pages: `/` listing published events and
`/e/[slug]` with gallery, venue, nights, ticket types and live availability. Follow the Indinite theme:
navy hero, yellow pill badge, orange gradient CTA, white cards on cream sections.

## M3 — Stripe Connect onboarding (30 Sep)
Organizer owner can start/resume Express onboarding via Account Links from /org/payouts. Handle
`account.updated` to sync chargesEnabled/payoutsEnabled. Block ticket sales for events whose organizer
can't accept charges. Idempotent webhook endpoint with signature verification and webhookEvents table.

## M4 — Checkout, holds, webhooks (30 Sep–1 Oct)
Implement SPEC §4.1: packages/core/quota atomic reserve/release/commit with tests (including a concurrency
test that fires 200 parallel reservations at a quota of 50). Checkout Session as destination charge with
application fee = commissionBps of total. Handle completed/expired webhooks in transactions; hold sweeper
job in the worker; late-payment-no-quota path auto-refunds.

## M5 — Tickets, QR, email, lookup (2 Oct)
Ed25519 QR signing/verification in packages/core/qr with tests. Pass PDF (@react-pdf/renderer) and QR PNG.
React Email ticket template in brand style (navy header, QR on white panel). Worker job `send-tickets`
via Resend. Ticket view page with signed 30-min link; hidden after event end. Lookup form per SPEC §4.4
with rate limiting and no enumeration.

## M6 — Organizer booking panel (3 Oct)
/org dashboard (sold, revenue, check-ins per night), orders table (TanStack Table, search by email/ref),
"New booking" with two actions: "Send payment link" (SPEC §4.2, discount with permission + limit) and
"Issue as already paid" (SPEC §4.3, method + required note, commission ledger). Resend tickets. Members
page (invite, change role). Org-scoped audit log view. Per-entity history timeline on order detail.

## M7 — Scanner PWA (5–7 Oct)
/scan per SPEC §4.5: installable PWA, camera scanning with qr-scanner, Dexie cache of manifest + scan
queue, local signature verification, full-screen green/amber/red result with haptics, background sync,
server conflict resolution, manual admit with reason. Gate dashboard (live entries per gate).
Test offline by toggling network in devtools and on two real phones.

## M8 — Refunds, exports, finance (8 Oct)
SPEC §4.6 refunds, CSV exports (orders, attendees, check-ins), commission ledger view for super admin,
super-admin global audit log with filters.

## M9 — Hardening (9–10 Oct)
k6 load test for checkout surge; Playwright E2E for checkout, payment link, offline issue, scan; Sentry;
rate limits; security review of org scoping (try accessing another org's orders); backup restore test;
printable attendee list per gate as fallback; write docs/RUNBOOK.md for event nights.
