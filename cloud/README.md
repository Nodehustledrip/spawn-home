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
1. Publish bidboard, pass-p-checkout, pass-p-landing from `apps/` (or from the desktop's Go Live).
2. Data: `node scripts/import-desktop-data.js --app bidboard --data <AppForge>/generated/bidboard/data --out out`
   plus `--places <...>/us-places.json`; run the SQL with `wrangler d1 execute --remote --file`, then `out/bidboard-photos.sh`.
3. Fill and run `scripts/apps-config.sql.template`. Set app secrets (write-only, via the publish API):
   STRIPE_WEBHOOK_SECRET, AI_API_KEY (optional AI_BASE_URL, AI_MODEL).

## Tests
`npm test` (Miniflare; the BidBoard end-to-end test uses desktop data if present).
