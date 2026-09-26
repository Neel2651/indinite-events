# Indinite Events — Specification v1 (Navratri launch)

## 1. Scope

### In v1
- Public listing at events.indinite.co.uk (currently 2 Navratri events) and event detail pages
  (images, video embed, venue, nights, ticket types and prices).
- Customer checkout via Stripe (card), tickets emailed with QR, viewable online until the event ends.
- Order lookup: customer enters email + order ID → receives a one-time link (30 min) to view tickets.
- Super-admin panel: add / edit / delete events, ticket types, quotas, organizers, commission.
- Organizer panel (org login, multiple users with roles):
  - Book for a client and **send a payment link** (optional discount).
  - Book for a client and **issue directly as already paid** (cash / bank transfer / complimentary).
  - View orders, resend tickets, see sales and check-ins.
- Stripe Connect Express onboarding; organizer receives payment minus platform commission.
- Gate scanner PWA (offline-capable), duplicate-entry prevention.
- Audit trail on every state change.

### Out of v1 (post-Navratri)
Self-serve organizer signup, ticket transfers, organizer-editable events, WhatsApp delivery, custom pass
designer, advanced analytics, native apps.

## 2. Roles and permissions

Platform role: `super_admin` (Indinite staff). Organizer roles (per organization):
`owner`, `manager`, `box_office`, `scanner`, `finance`.

| Permission | super_admin | owner | manager | box_office | scanner | finance |
|---|---|---|---|---|---|---|
| event.create / event.delete | ✓ | | | | | |
| event.update | ✓ | | | | | |
| event.read (own org) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ticketType.manage (price, quota) | ✓ | | | | | |
| organizer.manage (create org, commission) | ✓ | | | | | |
| org.members.manage (invite, change role) | ✓ | ✓ | | | | |
| stripe.onboard | | ✓ | | | | |
| order.read | ✓ | ✓ | ✓ | ✓ | | ✓ |
| order.createPaymentLink | ✓ | ✓ | ✓ | ✓ | | |
| order.applyDiscount | ✓ | ✓ | ✓ | | | |
| order.issueOffline (already paid) | ✓ | ✓ | ✓ | ✓ | | |
| order.resendTickets | ✓ | ✓ | ✓ | ✓ | | |
| order.refund / order.cancel | ✓ | ✓ | | | | |
| scan.perform | ✓ | ✓ | ✓ | | ✓ | |
| scan.manualAdmit (override) | ✓ | ✓ | ✓ | | | |
| reports.read / export | ✓ | ✓ | ✓ | | | ✓ |
| audit.read (own org) | ✓ | ✓ | | | | |
| audit.read (global) | ✓ | | | | | |

Discount limit for `box_office`: none (cannot apply). `manager`: max percent configurable per org (default 50%).

## 3. Data model (MongoDB, all money in pence)

- **organizers**: name, slug, contactEmail, stripeAccountId, chargesEnabled, payoutsEnabled,
  commissionBps (e.g. 800 = 8%), maxDiscountBpsForManager, status, timestamps.
- **events**: organizerId, slug (unique), title, description (rich text), venue {name, address, postcode,
  mapUrl}, media [{type: image|video, url, alt, order}], sessions [{_id, label: "Night 1", startsAt, endsAt}],
  startsAt, endsAt (= last session end), status: draft|published|archived, deletedAt (soft delete), timestamps.
  Hard delete only if zero orders.
- **ticketTypes**: eventId, name ("Season pass – adult"), description, pricePence, validSessionIds[],
  quota, sold, held, salesStartAt, salesEndAt, maxPerOrder, sortOrder, active.
- **discounts**: organizerId, eventId?, code?, kind: percent|fixed, value, maxUses, used, validFrom, validTo,
  createdBy. Ad-hoc discounts on payment links are stored inline on the order, not here.
- **holds**: orderId, items [{ticketTypeId, qty}], expiresAt, releasedAt.
- **orders**: publicId (unique, e.g. NAV-7K3F9Q), organizerId, eventId, customer {name, email, phone?},
  source: online|payment_link|offline, status: pending|paid|expired|cancelled|refunded|partially_refunded,
  items [{ticketTypeId, name, unitPricePence, qty}], subtotalPence, discount {kind, value, amountPence,
  reason, appliedBy}?, totalPence, applicationFeePence, stripe {checkoutSessionId, paymentIntentId, url},
  offline {method: cash|bank_transfer|complimentary, note, issuedBy}?, expiresAt?, paidAt?, timestamps.
- **tickets**: orderId, eventId, ticketTypeId, attendeeName?, qrToken, validSessionIds[],
  status: valid|cancelled|refunded, timestamps.
- **scans**: ticketId, eventId, sessionId, gate, deviceId, scannerUserId, result:
  admitted|already_used|invalid|wrong_session|cancelled|manual_admit, scannedAt (device time), syncedAt.
  Unique partial index: {ticketId, sessionId} where result=admitted.
- **webhookEvents**: stripeEventId (unique), type, processedAt.
- **auditLogs** (insert-only DB role): actor {type: user|customer|system|stripe, id, email, role},
  organizerId?, action, entity {type, id}, changes [{path, before, after}], reason?, ip?, userAgent?,
  requestId, createdAt.
  Indexes: {organizerId, createdAt:-1}, {"entity.type","entity.id",createdAt}, {"actor.id",createdAt}.
- **commissionLedger**: organizerId, orderId, amountPence, kind: offline_sale_owed|settled, createdAt.

## 4. Key flows

### 4.1 Public checkout
1. Customer picks ticket types → POST `/api/checkout`.
2. Server: validate sales window + maxPerOrder → create order (pending) → reserve quota atomically →
   create hold (expires in 30 min) → create Checkout Session (destination charge, expires_at 30 min,
   metadata.orderId) → redirect.
3. Webhook `checkout.session.completed` (transaction): mark paid, held→sold, create tickets, audit,
   enqueue `send-tickets`. If hold already released: re-reserve; if no quota → refund + email apology + audit.
4. `checkout.session.expired` or sweeper: release hold, order → expired.

### 4.2 Organizer payment link
Same as 4.1 but initiated in the organizer panel: customer details, items, optional discount
(permission + limit checked), link validity (1–24 h, default 24 h). Server emails the Checkout URL to the
customer and shows it for copying. Audit `order.payment_link_created`.

### 4.3 Organizer offline issue (already paid)
Customer details, items, method (cash / bank transfer / complimentary), required note. Transaction: reserve
quota → sold, create paid order (source offline), tickets, ledger entry for commission owed (not for
complimentary unless configured), audit `order.issued_offline`. Enqueue `send-tickets`.

### 4.4 Ticket delivery and viewing
Email (Resend, React Email): order summary, one PDF pass per ticket attached, inline QR image, "View tickets"
link (signed, 30 min). Ticket page shows QR only while `now < event.endsAt`; afterwards shows "This event
has ended". Lookup form: email + order ID → always responds "If that order exists we've emailed a link"
(no enumeration); rate limit 5/hour per IP and per email.

### 4.5 Gate scanning
Scanner logs in (scanner role), picks event + session + gate. Downloads pass manifest
(ticketId, status, validSessionIds, ticket type name, attendee name) + public key; caches in IndexedDB.
Scan: verify signature locally → check manifest → check local scan log → show result screen
(green admitted / amber already used with time+gate / red invalid) in under 1 s. Queue scans; sync every
10 s when online; server resolves conflicts (first admitted wins, later ones recorded as already_used).
Manual admit requires reason; audited.

### 4.6 Refund
Owner/super-admin: full or per-ticket refund → Stripe refund with refund_application_fee + reverse_transfer →
tickets cancelled → quota returned (configurable) → audit → email customer.

## 5. Routes (indicative)

Public: `/`, `/e/[slug]`, `/checkout/success`, `/orders/lookup`, `/orders/[publicId]?t=<token>`
Admin: `/admin` (events, ticket types, organizers, orders, audit)
Organizer: `/org` (dashboard, orders, new booking, members, payouts/Stripe, audit)
Scanner: `/scan`
API: `/api/checkout`, `/api/webhooks/stripe`, `/api/org/orders` (payment link / offline),
`/api/org/stripe/onboarding-link`, `/api/scan/manifest`, `/api/scan/sync`, `/api/orders/lookup`

## 6. Environment variables
MONGODB_URI, REDIS_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, RESEND_API_KEY, EMAIL_FROM, QR_SIGNING_PRIVATE_KEY,
NEXT_PUBLIC_QR_PUBLIC_KEY, S3_BUCKET, S3_REGION, CLOUDFRONT_URL, SENTRY_DSN, APP_URL

## 7. Non-functional
- Booking surge: 200 concurrent checkouts without oversell (k6 test).
- Scan result < 1 s offline; manifest for 5,000 tickets < 1 MB.
- UK GDPR: privacy notice, data minimisation, retention of customer PII 24 months after event.
- Accessibility: WCAG AA on public pages and ticket view.
- Backups: Atlas continuous backup; restore tested before 10 Oct.

## 8. Open decisions (confirm before the relevant milestone)
1. Who pays Stripe fees — absorbed in commission or passed on as a booking fee?
2. Quota returned to sale on refund — yes/no per event?
3. Commission on complimentary tickets — none by default?
4. Are sessions (nights) needed for daily passes, or season passes only for v1?
5. Is Indinite's Stripe platform account held by a UK-registered entity?
