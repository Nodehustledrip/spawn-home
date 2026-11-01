# Spawn Cloud

Serves published apps at `<slug>.spawnapp.org` from Cloudflare (Worker + R2 + D1). spawnapp.org itself stays on Render.

## One-time setup (needs Cloudflare access)
1. `wrangler r2 bucket create spawn-cloud-apps` · `wrangler d1 create spawn-cloud` → put the id in `wrangler.toml`.
2. `wrangler d1 migrations apply spawn-cloud --remote`
3. `wrangler secret put SECRETS_KEY` (32 random bytes, base64). Same value goes to Render as `CLOUD_SECRETS_KEY`.
4. `npm run build && wrangler deploy` (route `*.spawnapp.org/*`). DNS: proxied wildcard `*` record (owner adds it).
5. Render env (merge, one key at a time): CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID, R2_ACCESS_KEY_ID,
   R2_SECRET_ACCESS_KEY, CLOUD_SECRETS_KEY, then CLOUD_PUBLISH_ENABLED=1 last. Optional: R2_BUCKET, CF_ZONE_ID, CLOUD_FALLBACK_ORIGIN.

API token: Workers Scripts Edit, Workers Routes Edit (zone), R2 Edit (+ an R2 S3 key pair), D1 Edit,
SSL and Certificates Edit (custom hostnames, only for customer domains).

## Moving the desktop apps
1. Set `BIDBOARD_OWNER_EMAIL` on Render first (the spawnapp.org account that owns BidBoard; the `bidboard` name is reserved for it).
2. Publish bidboard, pass-p-checkout, pass-p-landing from `apps/` (or from the desktop's Go Live).
   On publish, spawn-home sets BidBoard's runtime and fees ($25 lead, $99/mo Pro) and copies its keys in (below).
3. Data: `node scripts/import-desktop-data.js --app bidboard --data <AppForge>/generated/bidboard/data --out out`
   plus `--places <...>/us-places.json`; run the SQL with `wrangler d1 execute --remote --file`, then `out/bidboard-photos.sh`.

## BidBoard payments (on-site Stripe Checkout, Degen Social account)
Server-side Checkout Sessions, like spawnapp.org billing. No payment links.
- Lead unlock: `POST /api/leads/unlock` → payment-mode session for `STRIPE_PRICE_LEAD`, tied to the unlock (metadata
  unlock_id/job_id/slug, buyer email). Webhook or `/paid` (which re-checks the session with Stripe) marks it paid only if
  it is that exact session, paid, USD, and at least the fee. `/paid` then opens the job with the contact.
- Contractor Pro: `POST /api/pro/checkout` (signed in) → subscription session for `STRIPE_PRICE_PRO`.
  On: checkout.session.completed, customer.subscription.created/updated (active, trialing).
  Off: customer.subscription.updated (any other status), customer.subscription.deleted, invoice.payment_failed.
- Manage billing: `POST /api/billing/portal` → Customer Portal (optional `STRIPE_PORTAL_CONFIG`), returns to /contractors.html.
- Webhook `https://bidboard.spawnapp.org/api/stripe/webhook`: v1 signature checked with Web Crypto (5 min tolerance),
  idempotent via `stripe_events`; a failed handler returns 500 so Stripe retries.
- Payments switch on only when the secret key, webhook secret and lead price id are all present; until then
  unlocks are a labelled free preview.

### Where the keys live
Render env (source of truth, merge mode, one key at a time) → copied by spawn-home, AES-256-GCM encrypted, into the
app's secrets in D1 on every spawn-home start and after each BidBoard publish. The Worker decrypts them with `SECRETS_KEY`.
Values are never returned by any API or logged (names only).

| Render env | App secret | Notes |
|---|---|---|
| BIDBOARD_OWNER_EMAIL | — | reserves the `bidboard` name; not secret |
| BIDBOARD_STRIPE_SECRET_KEY | STRIPE_SECRET_KEY | Degen Social restricted key (rk_live_…) |
| BIDBOARD_STRIPE_WEBHOOK_SECRET | STRIPE_WEBHOOK_SECRET | from the BidBoard webhook endpoint |
| BIDBOARD_STRIPE_PRICE_LEAD | STRIPE_PRICE_LEAD | price_… ($25 one-time) |
| BIDBOARD_STRIPE_PRICE_PRO | STRIPE_PRICE_PRO | price_… ($99/month) |
| BIDBOARD_STRIPE_PORTAL_CONFIG | STRIPE_PORTAL_CONFIG | optional bpc_… |
| BIDBOARD_AI_API_KEY / _AI_BASE_URL / _AI_MODEL | AI_API_KEY / AI_BASE_URL / AI_MODEL | optional |

Restricted key permissions: Checkout Sessions (write), Customer portal (write), Customers (write). Nothing else is called.

## Tests
`npm test` (Miniflare; the BidBoard end-to-end test uses desktop data if present).
