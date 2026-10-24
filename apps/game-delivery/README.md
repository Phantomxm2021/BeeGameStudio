# Game delivery Worker

This directory versions the existing `beegame-delivery` Cloudflare Worker for `game.beegame.studio`. It checks public deployment authorization through Supabase before serving a manifest-verified file from the private delivery R2 bucket. Existing path validation, SPA fallback, asset caching, CSP, GET/HEAD behavior and missing/private release handling are preserved.

The only new delivery behavior is the BeePlay first-interaction bridge: `HTMLRewriter` prepends it to the entry HTML head. It sends one message to the configured Portal parent on trusted gameplay input. Standalone games and unrelated embeddings do not report. Stored game bytes remain unchanged. See [Portal analytics](../game-portal/README.md#beeplay-management-and-analytics) for counting and rollout details.

Deploy with `wrangler deploy` after the Portal management migration. Retain existing `SUPABASE_URL` and `SUPABASE_ANON_KEY` secrets and the `DELIVERY_BUCKET` binding. `PORTAL_ORIGIN` defaults to `https://portal.beegame.studio`. A custom CSP must continue to allow this inline bridge; it is not weakened automatically.
