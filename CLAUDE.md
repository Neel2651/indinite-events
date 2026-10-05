# Indinite Events — events.indinite.co.uk

Event booking + QR pass platform. First launch: two Navratri events (UK organizers), sales open ~4 Oct 2026,
gates open Sun 11 Oct 2026. Full spec: `docs/SPEC.md`. Milestone prompts: `docs/KICKOFF_PROMPTS.md`.

## Stack
- pnpm workspaces + Turborepo, TypeScript strict everywhere
- `apps/web` — Next.js (App Router): public site, super-admin, organizer panel, `/scan` PWA
- `apps/worker` — Node, MongoDB-backed job queue (emails, pass rendering, hold sweeper, reconciliation)
- `packages/db` — Mongoose models, indexes, transaction helper
- `packages/core` — pure domain logic: pricing, discounts, quota, QR signing, permissions, audit helper
- `packages/emails` — React Email ticket template + PDF passes (@react-pdf/renderer)
- MongoDB Atlas (London, replica set), Stripe Connect (Express, GBP), Resend.
  Media is stored on the app server's disk (`MEDIA_DIR`) — no S3/CloudFront, no Sentry
- UI: Tailwind v4 + shadcn/ui, theme in `apps/web/app/globals.css` (Indinite brand — do not invent colours)
- Fonts: Poppins (headings) + Inter (body), self-hosted via Fontsource — do not switch to next/font/google
- Validation: Zod schemas in `packages/core`, shared by forms and API
- Auth: Better Auth + organization plugin (MongoDB adapter)

## Where things live (already built)
- `packages/core`: money + pricing (`calculateOrder`), permissions (`can`, `assertCan`, `maxDiscountBps`),
  QR (`signTicket`, `verifyTicketToken`), ids (`generatePublicId`), quota op builders, audit diff, Zod schemas.
  `@indinite/core/context` (server-only): `runWithContext`, `requireContext`, `systemActor`, `stripeActor`.
  `@indinite/core/links` (server-only): `signOrderLink` / `verifyOrderLink` (30-min customer links).
- `packages/db`: `connectDb`, `withTransaction`, `audited`, `quota.*` (atomic), all models, job queue
  (`enqueue`, `enqueueSendTickets` — pass `session` to enqueue in the same transaction), `releaseHold` / `sweepExpiredHolds`,
  `hitRateLimit` (Mongo fixed window), `requeue-failed-jobs` script,
  checkout: `createCheckoutOrder` + `fulfilOrder` (shared by demo payments and the Stripe webhook), media: `mediaDir`, `resolveMediaPath`.
- `apps/web/lib/request-context.ts`: `withRequestContext(actor, fn)` — wrap every mutating action with it.
- `packages/auth`: Better Auth (email + password, invitation-only sign-up, organisation plugin), `loadStaffUser`,
  member management, `createOrganizer`. `apps/web/lib/staff.ts`: `requireStaff`, `requireSuperAdmin`, `requireOrg(slug)`, `asStaff`.
- Scanning: `@indinite/core` `decideScan` (offline decision), `packages/db` `getScanManifest` / `syncScans` / `gateStats`,
  `/scan` PWA (Dexie cache, service worker `public/scan-sw.js`).
- Pricing (SPEC §4.7): `priceOrder` + `receiptLines` in core; `pricingFor(event, organizer)`, coupons (`findCoupon`,
  `redeemCoupon`), `createPendingOrder` (online + payment links), `issueOfflineOrder`, settings services
  (`setEventPricing`, `setEventCharges`, coupons, `recordCommissionPayment`), `eventFinance`, `getOrderHistory`.
- Demo videos: `pnpm --filter @indinite/e2e demo:videos [booking|organiser|scanning]` → `e2e/demo-videos/out/`.
- `apps/web/lib/queries.ts`: public read models for events.
- Installable staff app: `public/app.webmanifest` + `lib/app-meta.ts` (org, admin, scan layouts), one service worker
  `public/scan-sw.js` (scanner offline, `/offline` page for staff screens; not registered under `next dev`), phone tabs `components/staff/mobile-nav.tsx`.
- Self-registration: `/register` → `registerOrganizer` (`packages/auth/src/organizers.ts`); web address and order prefix
  are generated (`slugify`, `suggestOrderPrefixes` in core; prefix unique, not editable); `mustVerifyEmail` users can't
  sign in until verified (after-hook in `packages/auth/src/auth.ts`).
- Forms: `useFormAction` (`apps/web/lib/use-form-action.ts`) keeps values on error; actions return `FormState`
  (`lib/form-state.ts`: `zodFailure`, `fieldFailure`) and forms show `<FieldError state name>`.
- Meta pixel per event (SPEC §4.11): `Event.metaPixelId`, `<MetaPixel>` + `track` / `trackCustom`
  (`apps/web/components/meta-pixel.tsx`, event page and confirmation only), parameter builders in core `meta-pixel.ts`;
  mark buttons with `data-pixel-button="name"` for ButtonClick. Server Purchase (CAPI): per-event token encrypted
  (`@indinite/core/secrets`, `SETTINGS_ENCRYPTION_KEY`), `Order.metaTracking` saved at checkout, `fulfilOrder` queues
  `meta-purchase`, `sendMetaPurchase` (`packages/db/src/services/meta.ts`), payload in core `meta-capi.ts`.
- Events: one editor (`components/staff/event-editor.tsx`) for Admin → Events and the organiser panel (`/org/[slug]/events`,
  owners). Event actions (`app/admin/events/actions.ts`) check permission against the event's organiser from the DB.

## Commands
- `pnpm dev` — web + worker
- `pnpm test` — Vitest (unit); `pnpm --filter @indinite/db test:db` — real-MongoDB concurrency tests
- `pnpm --filter @indinite/core gen:qr-keys` — generate QR signing keys for .env.local
- `pnpm --filter @indinite/db seed` / `sync-indexes`; `seed -- --update` adds and updates demo data in place (keeps orders), `--reset` replaces it.
  Seeds refuse on a live server (`NODE_ENV=production` without `DEPLOY_ENV=staging`)
- `pnpm setup:production <email>` — live database: collections, indexes and the first super admin (asks for the password)
- `pnpm migrate:registration` — live DB update for self-registration (flags, unique order prefixes); run before deploying it
- `pnpm funnel <event-slug>` — read-only booking funnel; `pnpm meta:backfill-purchases` — send unsent paid bookings
  (last 7 days) to Meta's Conversions API (asks first)
- `pnpm --filter @indinite/core gen:settings-key` — `SETTINGS_ENCRYPTION_KEY` (encrypts per-event Meta tokens)
- `pnpm owners` — each organiser's owners (they manage their own events); `-- --make-owner <email> <slug>`
- `pnpm check:env` — checks this server's settings (formats, database, Stripe, Resend, QR key pair); never prints secrets. `-- --offline` skips network calls
- `LOAD_BASE_URL=… pnpm --filter @indinite/e2e test:load` — load test (sales rush) against a demo server; see `e2e/tests/load.ts`
- `pnpm lint` — ESLint (TypeScript, Next.js, jsx-a11y accessibility rules); must have no errors
- `pnpm typecheck && pnpm lint && pnpm test` — must pass before any milestone is done
- `pnpm --filter @indinite/e2e test:a11y` — axe WCAG 2.1 AA check of public pages (dev server running; `A11Y_BASE_URL` to change)
- `stripe listen --forward-to localhost:3000/api/webhooks/stripe --forward-connect-to localhost:3000/api/webhooks/stripe`

## Non-negotiable rules
1. **Money is integer pence** (`amountPence: number`). Never floats, never pounds. Currency is always `gbp`.
2. **Every state change goes through a service function that calls `audited()`** inside the same Mongo
   transaction (`withTransaction` from `packages/db`). No direct model writes from route handlers.
3. **Org scoping**: every organizer-facing query filters by `organizerId` from the session, never from the
   request body. Permission checks use `can(user, permission, resource)` from `packages/core/permissions`.
4. **Quota** changes only via the atomic conditional update in `packages/core/quota` — never read-then-write.
5. **Tickets are issued only** from (a) a verified Stripe webhook, (b) the audited offline-issue service, or
   (c) in development, the audited demo-payment path (`PAYMENTS_MODE=demo`, refused in production — SPEC §4.1).
   All three go through the same fulfilment service. Never from a client-side redirect.
6. **Webhooks are idempotent**: insert `stripeEventId` into `webhookEvents` (unique index) first; skip on duplicate.
7. **QR payload** = `v1.<ticketId>.<ed25519 signature>` (base64url). No personal data in the QR.
8. **Public IDs** (order refs like `NAV-7K3F9Q`) are random (nanoid, Crockford alphabet); never expose Mongo `_id`
   sequences to customers.
9. Store all dates in UTC; display in `Europe/London`.
10. No secrets in code or logs. Redact email/phone in audit diffs and logs.
11. British English in all UI copy. Sentence case. Buttons say exactly what happens ("Send payment link").

## Stripe patterns
- Organizers are **Express** connected accounts, onboarded via Account Links, or connect their **existing** Stripe
  account via Connect OAuth (`stripeAccountType: "standard"`, SPEC §4.8).
- Express: **destination charges** via Checkout Sessions:
  `payment_intent_data: { application_fee_amount, transfer_data: { destination } }`, card payments only for v1.
  Existing accounts: **direct charges** (`stripeAccount` header, `application_fee_amount` only). Use
  `stripeTarget(order)` for every call about an order's payment.
- `expires_at` between 30 min (public checkout) and 24 h (organizer payment links); release holds on
  `checkout.session.expired`.
- Refunds: `reverse_transfer: true` (destination only); Indinite's fee isn't refunded except for late sold-out refunds.
- Handle: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`, `account.updated`.

## Working style
- Start each milestone in plan mode; list files to touch before editing.
- Write Vitest tests for anything in `packages/core` before or with the implementation.
- Small commits per feature; stop at the end of each milestone for review.
- If a requirement in `docs/SPEC.md` is ambiguous, ask — don't guess on payments, quota or permissions.
