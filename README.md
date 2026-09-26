# Indinite Events

Event booking and QR pass platform for events.indinite.co.uk. Spec: `docs/SPEC.md`. Conventions: `CLAUDE.md`.

## Setup
```bash
corepack enable
pnpm install
cp .env.example .env.local            # fill in MongoDB, Redis, Stripe, Resend, S3
pnpm --filter @indinite/core gen:qr-keys   # paste the output into .env.local
ln -s ../../.env.local apps/web/.env.local # Next.js reads env from its own folder
pnpm --filter @indinite/db sync-indexes
pnpm --filter @indinite/db seed        # demo organizer, 9-night event, 2 ticket types (draft)
pnpm dev                               # web on :3000, worker alongside
```
Health check: http://localhost:3000/api/health

## Checks
```bash
pnpm typecheck
pnpm test                                  # unit tests (33)
pnpm --filter @indinite/db test:db         # real MongoDB replica set: 200 parallel reservations vs quota 50
```

## Layout
```
apps/web        Next.js 16 (App Router): public site, /admin, /org, /scan
apps/worker     BullMQ: send-tickets, sweep-holds (every minute)
packages/core   Pure domain logic + tests (pricing, permissions, QR, quota ops, audit diff, schemas)
packages/db     Mongoose models, transactions, audited(), atomic quota, queues, hold release
```
