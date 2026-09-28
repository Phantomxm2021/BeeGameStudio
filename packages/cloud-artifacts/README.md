# Bee Game Studio public artifacts

This Cloudflare Worker serves temporary, **public** HTML pages from an operator-owned R2 bucket. It is separate from the local project Artifacts panel, the Asset Manifest, and game publishing. Never use it to fix a local delivery-validation error.

## Configure

1. Deploy this Worker and R2 bucket in the Bee Game Studio Cloudflare account. Configure R2 lifecycle rules for `7d/` and `30d/` prefixes.
2. Set a strong Worker secret with `wrangler secret put TOKEN`. Do not commit it. Rotate any previously shared token before production use.
3. Set the public Worker custom domain. Optionally configure `PUBLIC_URL` in the Worker environment when an approved reverse proxy changes the external origin; otherwise response URLs use the request origin.
4. Configure the CLI/runtime with `BEEGAME_ARTIFACTS_URL=https://<your-public-domain>` and `BEEGAME_ARTIFACTS_TOKEN=<worker-secret>`. Both are required; without them the artifact tool refuses to upload.

The user must approve each public upload after seeing the source filename, destination domain, and 7- or 30-day lifetime. Anyone with the returned URL can read the page.

## API

`POST /upload?ttl=7|30&hash=<optional-id>` accepts `Authorization: Bearer <TOKEN>` and `Content-Type: text/html` (10 MB maximum). It returns `{id,url,expiresAt}`. `GET /7d/<id>.html` and `GET /30d/<id>.html` return the public page. Supplying `hash` overwrites that ID. Errors return `{error}` with an appropriate HTTP status.

For an authorized smoke test against your own deployment, set `WORKER_URL` and `TOKEN`, then run `bash scripts/test.sh`. The script performs real uploads and should not be run against a third-party endpoint.
