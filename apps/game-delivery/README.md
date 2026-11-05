# Game delivery Worker

This directory versions the existing `beegame-delivery` Cloudflare Worker for `game.beegame.studio`. It checks public deployment authorization through Supabase before serving a manifest-verified file from the private delivery R2 bucket. Existing path validation, SPA fallback, asset caching, CSP, GET/HEAD behavior and missing/private release handling are preserved.

The publisher uses `bgs_verification=raw` on the entry HTML request to verify the stored bytes before the normal GET-only play bridge injection. The query does not bypass deployment authorization or manifest/file lookup.

The only new delivery behavior is the BeePlay first-interaction bridge: `HTMLRewriter` prepends it to the entry HTML head. It sends one message to the configured Portal parent on trusted gameplay input. Standalone games and unrelated embeddings do not report. Stored game bytes remain unchanged. See [Portal analytics](../game-portal/README.md#beeplay-management-and-analytics) for counting and rollout details.

Deploy the delivery Worker together with the backend publisher change after the Portal management migration. Retain existing `SUPABASE_URL` and `SUPABASE_ANON_KEY` secrets and the `DELIVERY_BUCKET` binding. `PORTAL_ORIGIN` defaults to `https://portal.beegame.studio`. A custom CSP must continue to allow this inline bridge; it is not weakened automatically.

Project deletion retention requires `supabase/migrations/20261103010000_retained_publication_delivery_authorization.sql`, after the publication retention migration. The existing public-deployment RPC accepts project-scoped manifests during publication and deployment-scoped manifests for retained Portal releases. Owner, deployment, public visibility, ready status and deletion checks still apply. No Worker redeploy or game republish is required for this SQL change.
