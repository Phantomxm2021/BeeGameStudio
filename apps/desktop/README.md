# BeeGame Studio desktop shell

Run the frontend dev server from `apps/frontend` with the repository's fixed port `62173`, then run `npm run start` here. The development URL is localhost-only.

Packaged builds require an explicit HTTPS renderer URL, for example `BEEGAME_DESKTOP_APP_URL=https://<your-approved-renderer-host> npm run package`. The value is embedded by the main-process Vite build; no production hostname is guessed. Forge registers the `beegame://oauth/callback` protocol. OAuth uses a one-time callback code and the renderer's existing `sessionStorage` PKCE verifier; the desktop bridge accepts callbacks only from the trusted main renderer frame. A cold desktop restart cannot recover an interrupted login because that verifier is renderer-local; start sign-in again after restarting. Signing, notarization, and the real OAuth provider configuration are external release inputs.

Useful checks are `npm run typecheck`, `npm test`, `npm run lint`, `npm run package`, and `npm run make`. The current environment can compile Forge Vite targets, but the official Electron artifact download may be blocked by DNS/TLS access to GitHub.
