# Deploying on aaPanel with PM2 (staging / demo server)

Two PM2 processes run from one checkout: **indinite-web** (Next.js on `127.0.0.1:3005`) and **indinite-worker**
(emails, expiring holds). aaPanel's Nginx serves HTTPS and proxies to the web app. The database is MongoDB Atlas.

Files: `ecosystem.config.cjs` (PM2), `scripts/deploy.sh` (deploy/update), `deploy/env.staging.example`
(settings), `deploy/nginx-aapanel.conf` (proxy).

## 1. Server prerequisites (once)
- A Linux server with **2 GB RAM or more** (the build needs it; add 2 GB swap in aaPanel → Linux Tools if smaller).
- In aaPanel: **App Store → Node.js version manager**: install **Node 22** and set it as the command-line
  version. Install **PM2 Manager** from the App Store (or `npm i -g pm2`).
- In a terminal (aaPanel → Terminal):
  ```bash
  corepack enable
  corepack prepare pnpm@9.15.9 --activate
  node -v && pnpm -v && pm2 -v
  ```
- **Git access** to the repo: add the server's SSH key as a read-only **deploy key** on GitHub.

## 2. DNS and MongoDB Atlas (once)
- Point `events.neelshah.co` (A record) at the server's IP.
- Atlas → **Network Access**: add the server's IP. Use a **separate database** for staging
  (e.g. `…mongodb.net/indinite-events-staging?...`).

## 2b. Email sending domain (once)
Resend only sends from a domain you've verified. For the demo, verify **`events.neelshah.co`**:
1. Resend → **Domains → Add domain** → `events.neelshah.co` (region: Ireland / eu-west-1).
2. Add the records Resend shows at the DNS provider for `neelshah.co` — typically a **TXT** `resend._domainkey.events`
   (DKIM), an **MX** and a **TXT** on `send.events` (bounces/SPF). They don't affect any existing email on `neelshah.co`.
3. Click **Verify** (usually minutes). Then set `EMAIL_FROM="Indinite Events <tickets@events.neelshah.co>"`.
4. Restart the worker and retry emails that failed meanwhile:
   ```bash
   pm2 restart indinite-worker --update-env
   pnpm --filter @indinite/db requeue-failed-jobs
   ```

## 3. Get the code and settings (once)
```bash
cd /www/wwwroot
git clone git@github.com:Neel2651/indinite-events.git
cd indinite-events
cp deploy/env.staging.example .env.local
nano .env.local        # fill in every value (see comments in the file)
```
Generate secrets on the server:
```bash
openssl rand -base64 48          # BETTER_AUTH_SECRET
openssl rand -base64 48          # LINK_SIGNING_SECRET
pnpm install && pnpm --filter @indinite/core gen:qr-keys   # QR_SIGNING_PRIVATE_KEY + NEXT_PUBLIC_QR_PUBLIC_KEY
```
Create the media folder outside the checkout: `mkdir -p /www/wwwroot/indinite-media`.

## 4. First deploy
```bash
cd /www/wwwroot/indinite-events
bash scripts/deploy.sh --seed    # --seed adds or updates the demo events + staff accounts (staging only; keeps orders)
```
It installs, builds, syncs database indexes, starts both PM2 processes, saves the PM2 list and checks
`http://127.0.0.1:3005/api/health`. Make PM2 start on reboot (once): `pm2 startup` (run the command it prints),
then `pm2 save`. (aaPanel's PM2 Manager does this for you if you use it.)

## 5. Website, SSL and reverse proxy in aaPanel
1. **Website → Add site**: domain `events.neelshah.co`, PHP: **Pure static**, no database.
2. Site → **SSL → Let's Encrypt**: issue the certificate and turn on **Force HTTPS**.
   (HTTPS is required: the scanner's camera and install-to-home-screen only work over HTTPS.)
3. Site → **Config**: replace the default `location /` part with the contents of `deploy/nginx-aapanel.conf`
   (keep aaPanel's `listen`, `server_name` and SSL lines). Save; aaPanel reloads Nginx.
   - Don't use aaPanel's built-in "Reverse proxy" tab *and* this config at the same time.
   - Keep port 3005 **closed** in aaPanel → Security (the app only listens on 127.0.0.1 anyway).
4. Open `https://events.neelshah.co` — you should see the yellow "Demo site" bar.

## 6. Updating
```bash
cd /www/wwwroot/indinite-events && bash scripts/deploy.sh
```
Zero-downtime reload for the web app; the worker restarts after finishing in-flight emails.

## 7. Day-to-day
| Task | Command |
|---|---|
| Status | `pm2 status` |
| Logs | `pm2 logs indinite-web` / `pm2 logs indinite-worker` (files in `logs/`) |
| Restart | `pm2 restart indinite-web indinite-worker` |
| Health | `curl -s http://127.0.0.1:3005/api/health` |
| Retry failed emails | `pnpm --filter @indinite/db requeue-failed-jobs` |
| Set a staff password | `pnpm --filter @indinite/auth set-password someone@example.com` (asks for it; signs them out everywhere) |
| Reset demo accounts | `pnpm --filter @indinite/auth set-password --seed-accounts` (all demo accounts → `SEED_PASSWORD`) |

## Checklist before sharing with the client
- [ ] `https://events.neelshah.co/api/health` → `{"status":"ok"}`
- [ ] Yellow "Demo site" bar shows; `…/robots.txt` says `Disallow: /`
- [ ] Book a pass → confirmation → email arrives (Resend domain verified)
- [ ] Sign in at `/sign-in` with the seed accounts (password = `SEED_PASSWORD` in `.env.local`)
- [ ] Scanner at `/scan` on a phone: camera opens, a pass scans green, the same pass scans amber
- [ ] `pm2 status` shows both processes online; reboot the server once and check they come back

## Troubleshooting
- **Sign-in says `Invalid origin` (INVALID_ORIGIN)**: you're on `http://`. Turn on aaPanel → site → SSL →
  **Force HTTPS** (or keep the `if ($scheme = http)` redirect from `deploy/nginx-aapanel.conf`), and make sure
  `APP_URL` / `BETTER_AUTH_URL` in `.env.local` are exactly `https://events.neelshah.co` (no trailing slash, no www).
- **Edited `.env.local` but the app still uses old values** (old database, old `EMAIL_FROM`): PM2 keeps the
  environment it was first started with, and that copy wins over `.env.local`. Start both apps fresh from a new
  terminal:
  ```bash
  cd /www/wwwroot/indinite-events && git pull
  pm2 delete indinite-web indinite-worker
  bash scripts/deploy.sh
  ```
  Check nothing stale is saved (prints names only): `pm2 env indinite-worker | grep -oE "^(MONGODB_URI|EMAIL_FROM)"`
  should print nothing. (Older versions of `deploy.sh` caused this by exporting `.env.local` before starting PM2.)
- **`Interpreter bun is NOT AVAILABLE in PATH`**: PM2 picks Bun for `.ts` files unless told otherwise. The
  ecosystem file now sets `interpreter: "node"` for both apps. If you started PM2 with the old file, clear it:
  ```bash
  git pull
  pm2 delete indinite-web indinite-worker
  pm2 start ecosystem.config.cjs && pm2 save
  ```
- **`--env-file` / `--import` not recognised**: PM2 is using an old Node. Check `node -v` (needs 22) and that
  aaPanel's Node.js manager sets Node 22 as the command-line version, then `pm2 update`.
- **Started PM2 by hand instead of `deploy.sh`?** Also run `ln -sfn ../../.env.local apps/web/.env.local` and
  `pnpm --filter @indinite/web build` first, or the web app has no settings / no build.

## Stripe: webhooks and connecting existing accounts
Do these in Stripe test mode first, then again in live mode (each mode has its own keys and secrets).
1. **Webhook for Indinite's own account.** Developers → Webhooks → Add endpoint →
   `https://<domain>/api/webhooks/stripe`, "Events on your account": `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`. Signing secret →
   `STRIPE_WEBHOOK_SECRET`.
2. **Webhook for connected accounts** (same URL, second endpoint), "Events on Connected accounts": the same four
   events plus `account.updated` and `account.application.deauthorized`. Signing secret →
   `STRIPE_CONNECT_WEBHOOK_SECRET`. Needed for organisers' own accounts, and for Express status updates.
3. **Let organisers connect an existing Stripe account** (optional). Connect → Settings → Onboarding options →
   OAuth: turn OAuth on for **Standard** accounts and add the redirect URI
   `https://<domain>/api/stripe/connect/callback`. Copy the client ID (`ca_…`) → `STRIPE_CONNECT_CLIENT_ID`.
   Without it, the "Connect your existing Stripe account" button is hidden.
4. `pm2 reload ecosystem.config.cjs --update-env` (or `bash scripts/deploy.sh`) after editing `.env.local`.

Testing locally: `stripe listen --forward-to localhost:3001/api/webhooks/stripe --forward-connect-to localhost:3001/api/webhooks/stripe`
prints one signing secret; put it in both `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`.

## Organiser owners
Organiser owners create and manage their own events (organiser panel → Events). Permissions come from each person's
role, so existing owners need no database change. To check every organiser has an owner:
```bash
pnpm owners
```
To make someone an owner (an existing member is promoted; anyone else is emailed an owner invitation; it asks
first and is audited): `pnpm owners -- --make-owner name@example.com organiser-slug`.

## Check the settings
After creating or editing `.env.local`, run from the project folder:
```bash
pnpm check:env
```
It checks every setting (URLs, secrets, QR key pair, database connection and super admin, Stripe keys and which
Stripe account they belong to, the Resend key and sending domain, the media folder) without printing any secret.
✗ must be fixed; ! is worth a look. It only reads; nothing is changed. `pnpm check:env -- --offline` skips the network
checks.

## Live server: first-time database setup
The demo seeds refuse to run on a live server (`NODE_ENV=production` without `DEPLOY_ENV=staging`). Instead, on a
new, empty live database run, once, from the project folder:
```bash
pnpm setup:production admin@indinite.co.uk
```
It creates every collection and index, then the first super admin, asking for the password (typed twice, never
shown, at least 10 characters). Safe to re-run: an existing account keeps its password and is made super admin.
To change a password later: `pnpm --filter @indinite/auth set-password admin@indinite.co.uk`. Organisers and their
staff are then added from the admin panel (they get an invitation email and choose their own password).

## Notes
- **Live server later:** same steps with `DEPLOY_ENV` removed (or `live`) and `PAYMENTS_MODE=stripe`; demo
  payments are refused on a live server by design. Online card checkout needs the Stripe milestones first.
- The app listens on port **3005** (default in `ecosystem.config.cjs`, `scripts/deploy.sh` and
  `deploy/nginx-aapanel.conf`). If you change it, set `PORT` in `.env.local` **and** change every `proxy_pass` in the
  site's Nginx config to match. **Servers set up before 28 Sep 2026 used 3000:** update the aaPanel site's
  `proxy_pass` lines to `3005` (or set `PORT=3000` in the server's `.env.local`) before the next deploy, or the site
  will return 502.
- Nginx sets `X-Forwarded-For` to the real client IP (not appended), which the rate limits rely on. Keep it that way.
- The organiser app installs from the browser. Keep the Nginx `no-cache` rules for `/scan-sw.js` and
  `/app.webmanifest` (in `deploy/nginx-aapanel.conf`), or phones keep an old version of the app.
