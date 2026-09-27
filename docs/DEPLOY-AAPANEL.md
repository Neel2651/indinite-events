# Deploying on aaPanel with PM2 (staging / demo server)

Two PM2 processes run from one checkout: **indinite-web** (Next.js on `127.0.0.1:3000`) and **indinite-worker**
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
- Point `demo.events.indinite.co.uk` (A record) at the server's IP.
- Atlas → **Network Access**: add the server's IP. Use a **separate database** for staging
  (e.g. `…mongodb.net/indinite-events-staging?...`).

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
bash scripts/deploy.sh --seed    # --seed loads the demo events + staff accounts (staging only)
```
It installs, builds, syncs database indexes, starts both PM2 processes, saves the PM2 list and checks
`http://127.0.0.1:3000/api/health`. Make PM2 start on reboot (once): `pm2 startup` (run the command it prints),
then `pm2 save`. (aaPanel's PM2 Manager does this for you if you use it.)

## 5. Website, SSL and reverse proxy in aaPanel
1. **Website → Add site**: domain `demo.events.indinite.co.uk`, PHP: **Pure static**, no database.
2. Site → **SSL → Let's Encrypt**: issue the certificate and turn on **Force HTTPS**.
   (HTTPS is required: the scanner's camera and install-to-home-screen only work over HTTPS.)
3. Site → **Config**: replace the default `location /` part with the contents of `deploy/nginx-aapanel.conf`
   (keep aaPanel's `listen`, `server_name` and SSL lines). Save; aaPanel reloads Nginx.
   - Don't use aaPanel's built-in "Reverse proxy" tab *and* this config at the same time.
   - Keep port 3000 **closed** in aaPanel → Security (the app only listens on 127.0.0.1 anyway).
4. Open `https://demo.events.indinite.co.uk` — you should see the yellow "Demo site" bar.

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
| Health | `curl -s http://127.0.0.1:3000/api/health` |
| Retry failed emails | `pnpm --filter @indinite/db requeue-failed-jobs` |

## Checklist before sharing with the client
- [ ] `https://demo.events.indinite.co.uk/api/health` → `{"status":"ok"}`
- [ ] Yellow "Demo site" bar shows; `…/robots.txt` says `Disallow: /`
- [ ] Book a pass → confirmation → email arrives (Resend domain verified)
- [ ] Sign in at `/sign-in` with the seed accounts (password = `SEED_PASSWORD` in `.env.local`)
- [ ] Scanner at `/scan` on a phone: camera opens, a pass scans green, the same pass scans amber
- [ ] `pm2 status` shows both processes online; reboot the server once and check they come back

## Notes
- **Live server later:** same steps with `DEPLOY_ENV` removed (or `live`) and `PAYMENTS_MODE=stripe`; demo
  payments are refused on a live server by design. Online card checkout needs the Stripe milestones first.
- If port 3000 is taken on the server, set `PORT=3001` in `.env.local` **and** change `proxy_pass` in the
  Nginx config to match.
- Nginx sets `X-Forwarded-For` to the real client IP (not appended), which the rate limits rely on. Keep it that way.
