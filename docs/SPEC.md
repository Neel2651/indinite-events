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
| stripe.onboard | ✓ | ✓ | | | | |
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

Refunds: organiser owner and super admin only (confirmed 28 Sep 2026).
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
- **discounts**: organizerId, eventId?, code?, kind: percent|fixed, value, maxDiscountPence? (cap, % codes),
  minSubtotalPence? (minimum ticket spend), maxUses, used, validFrom, validTo, createdBy. Ad-hoc discounts on payment
  links are stored inline on the order, not here.
- **holds**: orderId, items [{ticketTypeId, qty}], expiresAt, releasedAt.
- **orders**: publicId (unique, e.g. NAV-7K3F9Q), organizerId, eventId, customer {name, email, phone?},
  source: online|payment_link|offline, status: pending|paid|expired|cancelled|refunded|partially_refunded,
  items [{ticketTypeId, name, unitPricePence, qty}], subtotalPence, discount {kind, value, amountPence,
  reason, appliedBy}?, totalPence, applicationFeePence, stripe {checkoutSessionId, paymentIntentId, url},
  offline {method: cash|bank_transfer|complimentary, note, issuedBy}?, cardFeePence, refundedPence,
  refunds [{ticketIds, amountPence, method: stripe|stripe_dashboard|outside_indinite|none, stripeRefundId?, reason,
  refundedBy}], needsReview, reviewNote?, cancellation {reason, by, at}?, expiresAt?, paidAt?, timestamps.
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
- **commissionLedger**: organizerId, eventId, orderId, amountPence, kind: offline_sale_owed|offline_sale_reversed|settled,
  note, recordedBy, createdAt. Owed = owed − reversed (a cancelled booking reverses what it owed).

## 4. Key flows

### 4.1 Public checkout
1. Customer picks ticket types → POST `/api/checkout`.
2. Server: validate sales window + maxPerOrder → create order (pending) → reserve quota atomically →
   create hold (expires in 30 min) → create Checkout Session (destination charge, expires_at 30 min,
   metadata.orderId) → redirect.
3. Webhook `checkout.session.completed` (transaction): mark paid, held→sold, create tickets, audit,
   enqueue `send-tickets`. If hold already released: re-reserve; if no quota → refund + email apology + audit.
4. `checkout.session.expired` or sweeper: release hold, order → expired.

**Demo payments (development only).** With `PAYMENTS_MODE=demo` (refused when `NODE_ENV=production`, see
`resolvePaymentsMode` in packages/core), step 2 skips Stripe: after the hold is created the server calls the
same fulfilment service as step 3 in its own transaction (mark paid, held→sold, create tickets, enqueue
`send-tickets`), audited as `order.paid` with reason `demo_payment` and `metadata.paymentsMode = "demo"`, then
redirects to `/checkout/success`. No Stripe fields are set; `applicationFeePence` is still calculated. The
organiser `chargesEnabled` check is skipped in demo mode. Payment links behave the same way.

### 4.2 Organizer payment link
Same as 4.1 but initiated in the organizer panel: customer details, items, optional discount
(permission + limit checked), link validity (1–24 h, default 24 h). Server emails the Checkout URL to the
customer and shows it for copying. Audit `order.payment_link_created`.
**Staff discount (built 28 Sep 2026):** % or £ off the ticket price with a reason, needs `order.applyDiscount`;
limited by `maxDiscountBps` (owner unlimited, manager `maxDiscountBpsForManager`, default 50%, box office none).
Stored on `order.discount` with `appliedBy`. A booking has a coupon or a staff discount, never both. After paying,
the customer returns to `/checkout/success`, which waits for the webhook.

### 4.3 Organizer offline issue (already paid)
Customer details, items, method (cash / bank transfer / complimentary), required note. Transaction: reserve
quota → sold, create paid order (source offline), tickets, ledger entry for commission owed (not for
complimentary unless configured), audit `order.issued_offline`. Enqueue `send-tickets`.

### 4.4 Ticket delivery and viewing
Email (Resend, React Email): order summary, one PDF pass per ticket attached, inline QR image, "View tickets"
link (signed, 30 min). Ticket page shows QR only while `now < event.endsAt`; afterwards shows "This event
has ended". Lookup form ("Find my tickets"): email + order ID → if both match a paid order, go straight to
the ticket page (booking details + QR codes) via a fresh signed 30-min link; otherwise "We couldn't find a
booking…". Rate limit 5/hour per IP and per email (order refs are random, so guessing is impractical).

### 4.5 Gate scanning
Scanner logs in (scanner role), picks event + session + gate. Downloads pass manifest
(ticketId, status, validSessionIds, ticket type name, attendee name) + public key; caches in IndexedDB.
Scan: verify signature locally → check manifest → check local scan log → show result screen
(green admitted / amber already used with time+gate / red invalid) in under 1 s. Queue scans; sync every
10 s when online; server resolves conflicts (first admitted wins, later ones recorded as already_used).
Manual admit requires reason; audited.
**Gates open 1 hour before each night starts (agreed 29 Sep 2026):** a pass scanned earlier is refused as
`too_early` ("Too early. Gates open at 15:00") with no override, e.g. a 4:00 pm BST night admits from 3:00 pm.
Online, the server's clock decides; offline scans are re-checked on sync using their scan time.
**Online-first + offline limit:** when online, the server verifies and records each scan before the phone shows a
result (strictly once per pass per night). Offline (or no server answer within 2 s), a phone may decide at most
**5 scans**; the 6th is refused ("Reconnect to keep scanning") until it's back online and those scans have synced.

### 4.6 Refund
Owner/super-admin: full or per-ticket refund, before the event starts, passes not yet scanned. Only the ticket
price actually paid (after coupon) is refunded; platform fee, organiser charges, tax and card processing fee are
kept. Card orders: Stripe refund with `reverse_transfer` (Indinite keeps its fee: `refund_application_fee: false`);
the late-payment-sold-out path refunds everything including fees. Cash / account orders are recorded and repaid by
the organiser. → tickets refunded → **quota always returned to sale** (agreed 28 Sep 2026) → audit → email customer.

**Refunds in the Stripe dashboard (agreed 28 Sep 2026):** `charge.refunded` (and the reconciliation job) list the
payment's refunds; ours carry `metadata.source = "indinite"` and are skipped. A full refund refunds every unscanned
pass (quota returned), sets the order `refunded` and emails the customer. A part refund is recorded (`refundedPence`,
`refunds[]` with method `stripe_dashboard`), the order becomes `partially_refunded` with `needsReview`, and passes
stay valid for staff to decide.

**Cancel (agreed 28 Sep 2026):** unpaid (pending) bookings: anyone with `order.cancelPending` (owner, manager,
box office, super admin); the Stripe Checkout Session is expired first, and the cancel is refused if it has just
completed. Seats and the coupon use come back. Paid cash / account / complimentary bookings: owner or super admin
(`order.cancel`), only if no pass has been scanned; passes → cancelled, quota returned, coupon use given back,
commission reversed (`offline_sale_reversed`), customer emailed. The complimentary allowance isn't given back.
Card bookings are refunded instead. A card payment that completes after a cancel is refunded in full.

**Reconciliation:** the worker runs every 15 min: pending card orders whose session is paid → fulfilled (missed
webhook); expired sessions → hold released; card orders paid in the last 14 days → dashboard refunds recorded;
failed webhook events are logged.

### 4.7 Pricing, charges, coupons and commission (agreed 27 Sep 2026)
Per order: **tickets − coupon → + platform fee → + organiser charges → + tax on all of that = total.**
Example: £12 ticket, 6% platform fee, £0.30 venue fee, 20% tax = 12.00 + 0.72 + 0.30 + 2.60 = **£15.62**.
- **Platform fee = Indinite's commission.** Default **6%** per organiser (admin can change), with an optional
  per-event override (admin). The organiser keeps the full ticket price.
- **Organiser charges** (e.g. "Venue fee"): set by the organiser owner per event, per ticket, fixed £ or % of the
  ticket price. The money goes to the organiser.
- **Tax**: rate set per event by the admin (0 if not applicable); charged on tickets + platform fee + charges.
- **Coupons**: created by organiser owners/managers (% off or £ off, one event or all, max uses, dates as UK
  calendar days, optional maximum discount for % codes and minimum ticket spend, both measured on the ticket
  subtotal before fees, agreed 28 Sep 2026). Taken off the ticket price before fees (so the platform fee and %
  charges are on the discounted price). Redemption is atomic and audited against the coupon (`coupon.redeemed`); an
  unpaid booking that expires or is cancelled gives the use back (`coupon.released`).
- **Online / payment link (Stripe):** Indinite receives the platform fee (application fee); the organiser receives
  the rest (tickets, charges, tax). *Assumption to confirm: all tax goes to the organiser.*
- **Organiser bookings** (`/org/.../bookings/new`), four options: **Cash**, **Organiser's account** (bank transfer),
  **Complimentary**, **Generate payment link**. Cash/account: customer pays the full total to the organiser; the
  organiser owes Indinite the platform fee. Complimentary: £0 to the customer. Each event has a
  commission-free allowance (default **5** passes, set per event by the admin); beyond it the organiser owes the
  platform fee on each extra pass's normal price. The allowance covers the highest-priced passes first, is counted
  atomically, and isn't given back when a complimentary pass is refunded (agreed 28 Sep 2026). Payment link: pending booking held 1–24 h, customer emailed a link to `/pay/<ref>`
  (demo mode approves instantly; Stripe Checkout once connected). Box office bookings ignore public sales windows
  and per-order limits but never exceed quota.
- **Admin finance** (`/admin/finance`), per event: total sales; organiser direct (cash / account) and commission
  owed, paid and outstanding (admin "Mark as paid" with any amount + note, audited); credited to the organiser via
  Indinite; Indinite income (platform fees + commission owed).
- **Ticket history**: every ticket has its own audit entry when generated; the order page shows per-pass
  timelines (generated, emailed, each scan with time, night, gate and scanner name, overrides) and order history
  (how it was sold, by whom, payment method and note).

### 4.8 Merchant onboarding and card fees (agreed 28 Sep 2026)
- Indinite's Stripe platform account is held by a UK-registered entity. Organisers are **Express** connected
  accounts (GB, GBP).
- The super admin creates the organiser (optionally with legal name, business type and website to prefill Stripe).
  Bank and business details are then entered on **Stripe's hosted onboarding form**, either by the super admin from
  `/admin/organisers/[id]` ("Fill in bank and business details") or by the organiser owner from `/org/[slug]/payments`
  (or the emailed setup link). Both open the same account; either can finish. Stripe may send a code to the
  organiser's phone and ask for photo ID. Bank details are never stored by Indinite.
- Merchant status (not started, in progress, waiting for Stripe, active, action needed) is synced from
  `account.updated` and refreshed on return from Stripe. Card checkout and payment links need an active, un-paused
  organiser. The super admin can pause online sales (cash / account / comp bookings still work).
- **Stripe card fee** (default 1.5% + 20p), set per organiser by the super admin, paid by one of:
  - **Indinite**: comes out of the platform fee.
  - **Organiser**: added to the application fee, so it's deducted from their payout.
  - **Customer**: added to card bookings (online and payment links, not cash / account / comp) as a
    **"Card processing fee"** line after tax, not taxed, grossed up so it covers Stripe's fee on the whole charge:
    `ceil((base × bps + fixed × 10000) / (10000 − bps))`. It's fixed on the order when priced, recovered in the
    application fee, and never refunded. *Note: UK rules restrict surcharging consumers for card payments; the
    business chose this label. Worth confirming with an adviser.*
- Finance shows recovered card fees separately; they're not Indinite income.

## 5. Routes (indicative)

Public: `/`, `/e/[slug]`, `/checkout/success`, `/orders/lookup`, `/orders/[publicId]?t=<token>`, `/pay/[publicId]`,
`/privacy`, `/booking-terms`, `/refund-policy`
Admin: `/admin`, `/admin/events` (+ `/new`, `/[id]`: nights, pass types, media, publish, delete), `/admin/orders`,
`/admin/organisers` (+ `/[id]`), `/admin/finance`, `/admin/audit`, `/admin/export/[orders|attendees|checkins]`
Organizer: `/org/[slug]` (dashboard with check-ins), `orders`, `bookings/new`, `coupons`, `pricing`, `checkins`,
`events/[eventId]/print` (gate list), `members`, `audit`, `payments`, `export/[orders|attendees|checkins]`
Scanner: `/scan`
API: `/api/checkout`, `/api/webhooks/stripe`, `/api/org/orders` (payment link / offline),
`/api/org/stripe/onboarding-link`, `/api/scan/manifest`, `/api/scan/sync`, `/api/orders/lookup`

## 6. Environment variables
MONGODB_URI, BETTER_AUTH_SECRET, BETTER_AUTH_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, RESEND_API_KEY, EMAIL_FROM, QR_SIGNING_PRIVATE_KEY,
NEXT_PUBLIC_QR_PUBLIC_KEY, MEDIA_DIR, PAYMENTS_MODE, LINK_SIGNING_SECRET, APP_URL

## 7. Non-functional
- Booking surge: 200 concurrent checkouts without oversell (k6 test).
- Scan result < 1 s offline; manifest for 5,000 tickets < 1 MB.
- UK GDPR: privacy notice, data minimisation, retention of customer PII 24 months after event.
- Accessibility: WCAG AA on public pages and ticket view.
- Backups: Atlas continuous backup; restore tested before 10 Oct.

## 8. Open decisions (confirm before the relevant milestone)
1. ~~Who pays Stripe fees?~~ Resolved 28 Sep 2026: super admin chooses per organiser: Indinite, organiser or
   customer (§4.8).
2. ~~Quota returned to sale on refund?~~ Resolved 28 Sep 2026: always.
3. ~~Commission on complimentary tickets?~~ Resolved 28 Sep 2026: free up to a per-event allowance (default 5),
   platform fee on the rest (§4.7).
4. Are sessions (nights) needed for daily passes, or season passes only for v1?
5. ~~Is Indinite's Stripe platform account held by a UK-registered entity?~~ Resolved 28 Sep 2026: yes.
