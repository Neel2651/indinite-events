# Indinite Events

Event booking and QR pass platform for events.indinite.co.uk. Spec: `docs/SPEC.md`. Conventions: `CLAUDE.md`.

## Setup
```bash
corepack enable
pnpm install
cp .env.example .env.local            # fill in MongoDB, Stripe, Resend
pnpm --filter @indinite/core gen:qr-keys   # paste the output into .env.local
ln -s ../../.env.local apps/web/.env.local # Next.js reads env from its own folder
pnpm --filter @indinite/db sync-indexes
pnpm --filter @indinite/db seed        # 2 demo organisers + published events (add --reset to reseed)
pnpm dev                               # web on :3000, worker alongside
```
Health check: http://localhost:3000/api/health

## Checks
```bash
pnpm typecheck
pnpm test                                  # unit tests (42)
pnpm --filter @indinite/db test:db         # real MongoDB replica set: quota, jobs, checkout → fulfilment, rate limits
pnpm --filter @indinite/db requeue-failed-jobs  # retry failed emails after fixing Resend config
```

## Layout
```
apps/web        Next.js 16 (App Router): public site, /admin, /org, /scan
apps/worker     Polls the MongoDB jobs queue (send-tickets); sweeps expired holds every minute
packages/core   Pure domain logic + tests (pricing, permissions, QR, quota ops, audit diff, schemas)
packages/db     Mongoose models, transactions, audited(), atomic quota, queues, hold release
```
