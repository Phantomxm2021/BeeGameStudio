# Bee Play game portal

`/` lists games explicitly published to Portal. `/g/<project-id>` is the stable play/share page, and `/?author=<Supabase-user-id>` lists one creator's games. Guests can play and share without signing in. Signed-in BGS users can open “我的发布”. The Portal imports the existing BGS Auth client, including password login, OAuth PKCE and callback validation; it uses the same Supabase project and user IDs as web and desktop BGS. Browser sessions remain scoped to each origin; this does not introduce cross-domain automatic sign-in.

The existing delivery Worker and R2 files stay in place. The iframe loads the original immutable game URL from a separate origin; there is no second upload, universal game SDK or game start/pause flow.

## Publication

Apply `supabase/migrations/20261023040000_game_portal.sql` **before** running the updated BGS backend. It adds `portal_published_at` and the public `beegame_portal_games` projection. No existing deployment is backfilled or silently listed. Existing BGS links continue to use their raw URL until the author explicitly publishes a new Portal release.

The backend initially registers a successful delivery record so the existing delivery Worker can serve files for anonymous verification. It writes `portalPublishedAt` only after file verification and the final eligibility check. The database projects that final record into the catalogue atomically. Failed verification leaves the preceding release active. A final persistence/local-write failure restores the prior public release; rollback publishes a new record pointing at the old immutable files. Delayed older records cannot replace a newer release.

Only public title, creator name/user ID, game URL and publish/update timestamps enter the projection. Private paths, logs, prompts, drafts and email addresses do not. Anonymous/authenticated roles can read the projection but cannot write it. Project deletion removes its public entry. Publishing copies the current project/creator name; subsequent private project renames do not change the public title until another publication.

## Configuration and launch

1. Configure `BEEGAME_SUPABASE_URL` and `BEEGAME_DELIVERY_ORIGIN` in `wrangler.toml`. Keep the game delivery origin separate from the Portal so game code cannot read Portal auth storage. Remote delivery requires HTTPS; loopback HTTP is supported for local development on separate ports.
2. Set `BEEGAME_SUPABASE_ANON_KEY` using `wrangler secret put`. This is the **public anon key** for the same Supabase project used by BGS; `/api/config` returns it to the shared browser Auth client. Never substitute a service role key.
3. Set `BEEGAME_SUPABASE_SERVICE_ROLE_KEY` as a Worker secret. Only the historical version endpoint uses it, and only for explicitly published successful versions; it is never sent to the client.
4. Allow the Portal origin in Supabase Auth redirect URLs for OAuth, and enable the same GitHub/Discord providers as BGS. Portal login uses existing accounts; it does not bypass BGS registration/invitation policies.
5. Run `bun run build` to build `public/auth.js` from the shared Auth source. `bun run dev` and `bun run deploy` include this step automatically. The generated file is ignored by Git.
6. Set `VITE_BEEGAME_GAME_PORTAL_BASE_URL=https://portal.beegame.studio` when building **both** web and desktop BGS frontends. The publish dialog discloses public discovery and shows a stable Portal link after publication. Historical releases keep their exact version links.

`wrangler.toml` attaches only `portal.beegame.studio`; it does not replace the delivery Worker. Database migration, OAuth allowlist changes, deployment and service restarts are separate operational steps; local tests do not perform them.

## Player and sharing

Game pages render their title, description, canonical URL and Open Graph metadata on the server. Sharing always uses `/g/<project-id>`, including from a version page. Native sharing is used when available, then clipboard, with a selectable URL when clipboard is unavailable. The player preserves a 16:9 surface on desktop, mobile and fullscreen (with letterboxing as needed). Share and fullscreen controls sit in the upper-right overlay; reload remains below the player. Fullscreen includes a viewport fallback. Sharing feedback and the manual-copy field remain inside the fullscreen element. An iframe load event is not presented as proof of playability; errors/slow connections retain recovery controls. Keyboard/touch support comes from the game itself.

Optional audio integration remains available through `game-audio-bridge.js`. A mute button appears only when a game connects its actual audio manager:

```html
<script src="https://portal.beegame.studio/game-audio-bridge.js"></script>
<script>BeeGamePortalAudio.connect(muted => gameAudio.setMuted(muted))</script>
```

## Verification

Run `bun test apps/game-portal/src`, `bun run typecheck`, the frontend publish-dialog tests and the frontend production build. Database verification must include initial/private deployments, verification in progress, final publication, failed updates, rollback, creator ownership and anonymous read-only access. Before production launch, verify actual Supabase migration/RLS and OAuth redirects, plus an authorized published game in desktop and mobile browsers. Local fixtures cannot establish production availability or real game quality.

## Interface

The catalogue, creator pages, account dialog and player share an Apple-inspired light palette, system typography and blue actions. The banner is a manually controlled, swipeable slider showing the first five newly published games without implying editorial ranking. The scrolling viewport extends through the page gutters, revealing adjacent cards at the page edge while the selected card stays aligned with the content. Artwork sits in normal grid flow with inset space for its rotation and shadows; mobile stacks artwork above text, and titles wrap without line clamping so the slider does not crop its content. Below it, the catalogue uses a responsive image-and-title grid with no creator/date/action row. It automatically loads the next page near the bottom, stops when the catalogue is exhausted, and offers a retry button if a request fails. Both carousel and grid links open the game in a new tab. Public metadata has no cover-image field, so both surfaces currently use SVG title graphics as placeholders, not game screenshots. No ratings or genre labels are invented. Motion includes slider scrolling, cover zoom and card hover/press, staggered grid entry, dialog entry and cross-document transitions where supported. `prefers-reduced-motion` disables animations. Apple devices use their installed system font; other devices use available fallback fonts.

Game pages use a standalone player-first layout without catalogue navigation or a back link. The game icon, title and author appear below the player; decorative captions and generic descriptions are omitted; a three-dot disclosure in the upper-right overlay reveals reload, audio (when supported), share and fullscreen controls on mouse hover or touch/keyboard activation.

The catalogue, player page and login dialog use the main site's light/dark palette. Both sites use the same `ThemeToggleButton` React component, including the 700ms circle reveal and animated sun/moon icons. `bun run build` bundles this shared component into `theme-controls.js` and a small pre-paint bootstrap into `theme.js`. Both frontend deployments must include the shared preference code. The `beegame-theme` cookie shares the choice across `beegame.studio` subdomains, or across local ports using the same hostname; the existing `system-storage` preference migrates when no shared choice exists, with dark as the default. Cookie change events update open pages where supported; returning to a page also rereads the choice. Unrelated domains and different browser profiles do not share the cookie. Game iframe contents retain their own styling. Long introductions scroll within a maximum height of `min(320px, 40dvh)`; short introductions keep their natural height, and the introduction title remains outside the scroll area.

The catalogue uses a centered top header instead of a sidebar. Its brand, heading, banner and game grid share one width and responsive page gutter; the account group aligns to the right edge. The account group reuses the main site's `UserAccountMenu` and `ProfileAvatarButton`, including the anonymous avatar, image fallback and animated popover. Its Portal actions are My releases and Sign out; the anonymous avatar opens the existing Portal login dialog. The build generates `account.css` with the main site's Tailwind configuration and design tokens, without adding global preflight resets. `theme-controls.js` now includes the catalogue/player controller once, so `portal.js` is source input rather than a second script tag.

The publish dialog can generate one editable introduction draft from `docs/GDD.md` and `docs/UI_UX_SPEC.md` using the existing model configuration and usage accounting. Generation occurs only on the creator's explicit button click, never on page load, and does not modify project documents. The creator must review and confirm nonempty copy before publishing. Apply `20261024010000_game_portal_description.sql` before deploying this capability. The confirmed text is versioned with the deployment and copied into the public projection only after successful publication. Historical links and rollback use that release's description. The player displays it below the title/author as plain text; empty descriptions have no placeholder or empty section.
