# Spawn Cloud

Serves published apps at `<slug>.spawnapp.org` from Cloudflare Workers + D1 on the **free plan, no card on file**
(no R2, no Cloudflare for SaaS). spawnapp.org itself stays on Render.

## Storage
- `DB` (D1 `spawn-cloud`): apps, versions, secrets, app data, BidBoard, Stripe event log.
- `FILES` (D1 `spawn-cloud-files`): every file — published bundles (`blob/<slug>/<sha256>`, shared across versions),
  `/api/storage` uploads and BidBoard photos — as 512 KiB base64 chunks (tables `blobs`, `blob_chunks`).
  If `FILES` isn't bound, files go to `DB`. Two databases = 2 × 500 MB free.
- Edge Cache API in front of static files, so repeat hits don't read D1.

Free limits (per day unless noted): Workers 100,000 requests, 10 ms CPU per request; D1 5 M rows read, 100,000 rows
written, 500 MB per database, 5 GB per account. KV was rejected for files: 1,000 writes/day would cap publishing.

## One-time setup (needs Cloudflare access; each step approved first)
1. `wrangler d1 create spawn-cloud` and `wrangler d1 create spawn-cloud-files` → put both ids in `wrangler.toml`.
2. `wrangler d1 migrations apply spawn-cloud --remote` and the same for `spawn-cloud-files`.
3. `wrangler secret put SECRETS_KEY` (32 random bytes, base64). Same value goes to Render as `CLOUD_SECRETS_KEY`.
4. `npm run build && wrangler deploy` (route `*.spawnapp.org/*`). DNS: proxied `AAAA * 100::`. Universal SSL already covers `*.spawnapp.org`.
5. Render env (merge, one key at a time): CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID, CF_D1_FILES_DATABASE_ID,
   CLOUD_SECRETS_KEY, then CLOUD_PUBLISH_ENABLED=1 last.

Render API token: D1 Edit only. Deploy token (wrangler): Workers Scripts Edit, Workers Routes Edit (zone), D1 Edit.

Custom domains: off. They need Cloudflare for SaaS (card) or the customer's zone inside this account; apps use `<slug>.spawnapp.org`.

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
