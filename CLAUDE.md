# Indinite Events — events.indinite.co.uk

Event booking + QR pass platform. First launch: two Navratri events (UK organizers), sales open ~4 Oct 2026,
gates open Sun 11 Oct 2026. Full spec: `docs/SPEC.md`. Milestone prompts: `docs/KICKOFF_PROMPTS.md`.

## Stack
- pnpm workspaces + Turborepo, TypeScript strict everywhere
- `apps/web` — Next.js (App Router): public site, super-admin, organizer panel, `/scan` PWA
- `apps/worker` — Node + BullMQ (emails, pass rendering, hold sweeper, reconciliation)
- `packages/db` — Mongoose models, indexes, transaction helper
- `packages/core` — pure domain logic: pricing, discounts, quota, QR signing, permissions, audit helper
- `packages/emails` — React Email templates
- MongoDB Atlas (London, replica set), Redis, Stripe Connect (Express, GBP), Resend, S3 + CloudFront
- UI: Tailwind v4 + shadcn/ui, theme in `apps/web/app/globals.css` (Indinite brand — do not invent colours)
- Fonts: Poppins (headings) + Inter (body), self-hosted via Fontsource — do not switch to next/font/google
- Validation: Zod schemas in `packages/core`, shared by forms and API
- Auth: Better Auth + organization plugin (MongoDB adapter)

## Where things live (already built)
- `packages/core`: money + pricing (`calculateOrder`), permissions (`can`, `assertCan`, `maxDiscountBps`),
  QR (`signTicket`, `verifyTicketToken`), ids (`generatePublicId`), quota op builders, audit diff, Zod schemas.
  `@indinite/core/context` (server-only): `runWithContext`, `requireContext`, `systemActor`, `stripeActor`.
- `packages/db`: `connectDb`, `withTransaction`, `audited`, `quota.*` (atomic), all models, BullMQ queues
  (`enqueueSendTickets`), `releaseHold` / `sweepExpiredHolds`.
- `apps/web/lib/request-context.ts`: `withRequestContext(actor, fn)` — wrap every mutating action with it.
- `apps/web/lib/queries.ts`: public read models for events.

## Commands
- `pnpm dev` — web + worker
- `pnpm test` — Vitest (unit); `pnpm --filter @indinite/db test:db` — real-MongoDB concurrency tests
- `pnpm --filter @indinite/core gen:qr-keys` — generate QR signing keys for .env.local
- `pnpm --filter @indinite/db seed` / `sync-indexes`
- `pnpm typecheck && pnpm test` — must pass before any milestone is done (ESLint not configured yet)
- `stripe listen --forward-to localhost:3000/api/webhooks/stripe`

## Non-negotiable rules
1. **Money is integer pence** (`amountPence: number`). Never floats, never pounds. Currency is always `gbp`.
2. **Every state change goes through a service function that calls `audited()`** inside the same Mongo
   transaction (`withTransaction` from `packages/db`). No direct model writes from route handlers.
3. **Org scoping**: every organizer-facing query filters by `organizerId` from the session, never from the
   request body. Permission checks use `can(user, permission, resource)` from `packages/core/permissions`.
4. **Quota** changes only via the atomic conditional update in `packages/core/quota` — never read-then-write.
5. **Tickets are issued only** from (a) a verified Stripe webhook or (b) the audited offline-issue service.
   Never from a client-side redirect.
6. **Webhooks are idempotent**: insert `stripeEventId` into `webhookEvents` (unique index) first; skip on duplicate.
7. **QR payload** = `v1.<ticketId>.<ed25519 signature>` (base64url). No personal data in the QR.
8. **Public IDs** (order refs like `NAV-7K3F9Q`) are random (nanoid, Crockford alphabet); never expose Mongo `_id`
   sequences to customers.
9. Store all dates in UTC; display in `Europe/London`.
10. No secrets in code or logs. Redact email/phone in audit diffs and logs.
11. British English in all UI copy. Sentence case. Buttons say exactly what happens ("Send payment link").

## Stripe patterns
- Organizers are **Express** connected accounts, onboarded via Account Links.
- Charges are **destination charges** via Checkout Sessions:
  `payment_intent_data: { application_fee_amount, transfer_data: { destination } }`, card payments only for v1.
- `expires_at` between 30 min (public checkout) and 24 h (organizer payment links); release holds on
  `checkout.session.expired`.
- Refunds: `refund_application_fee: true, reverse_transfer: true`.
- Handle: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`, `account.updated`.

## Working style
- Start each milestone in plan mode; list files to touch before editing.
- Write Vitest tests for anything in `packages/core` before or with the implementation.
- Small commits per feature; stop at the end of each milestone for review.
- If a requirement in `docs/SPEC.md` is ambiguous, ask — don't guess on payments, quota or permissions.
