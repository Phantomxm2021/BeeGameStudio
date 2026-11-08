# BeeGame Studio desktop shell

Run the frontend dev server from `apps/frontend` with the repository's fixed port `62173`, then run `npm run start` here. The development URL is localhost-only.

`npm run make` builds the shared frontend and the existing local Bun backend into the application's resources. Forge bundles matching Bun (>=1.4.3), the prebuilt BGS CLI and its code-mode host, production workspace dependencies, and the default native `bgs-game-development@bgs-professional` Plugin. Runtime files and executables are outside ASAR. The package hook installs dependencies offline using Bun's existing cache; run the normal workspace install and provide a native build for the current target before packaging. It never rebuilds the CLI. It checks the copied executable files without running them, so packaging does not launch BGS or trigger trust checks for a copied CLI.

The packaged local mode starts one owned backend on `127.0.0.1:62174` before opening the workbench and asks that child to stop through its existing SIGTERM cleanup on app quit. It never adopts or kills another process occupying that port. Logs are in Electron's userData `runtime.log`; project and account-scoped runtime data are under `Projects`, session/configuration records under `configuration`. A per-install encryption key is protected by Electron safeStorage; an unavailable OS key store or damaged key fails visibly rather than replacing credentials. This does not change native Agent execution or add another service stack. Development still uses the existing separately started services.

Public cloud settings are supplied through the existing Forge build environment. Supabase is the self-hosted `https://bgs.phantominfra.com`, not a Supabase Cloud project. For a cloud-connected release, supply its matching public anon key plus `BEEGAME_BILLING_API_BASE_URL`, `BEEGAME_SKILLS_API_BASE_URL`, and `BEEGAME_RESOURCE_SERVER_URL` as public HTTPS endpoints. Supabase's hostname does not imply routes for those separate BGS APIs. They have not yet been supplied; the current localhost development addresses are deliberately rejected in a release configuration. Only these public settings are written to the runtime payload; service-role keys, internal service tokens, provider keys and development `.env` files are not shipped.

The local workflow store is selected explicitly even when Supabase login is configured; native sessions and Plugin installation caches remain in existing per-account locations. Remote SaaS processes retain their existing store behavior. The public resource connection sends user authorization and cannot access the internal curation endpoint without its service token. A local install with no remote Skills endpoint reports user-Skills service unavailable; the bundled professional Plugin is independent of that API.

This work verifies packaging and local contracts, not complete cloud-connected release readiness. In addition to the three API addresses, existing cloud records encrypted with the server's key need an authorized secret-delivery design: a desktop-generated key cannot decrypt them and the server encryption key must not be packaged. Publication bucket/public routing, OAuth redirects, signing/notarization and Windows/Linux native artifacts also require release validation. No server credentials or signing exceptions are introduced to bypass these gaps.

The packaged app serves its bundled files through Electron's HTTP protocol handler at the existing `http://127.0.0.1:62173` origin, without listening on that port. API, preview and deployment paths retain the existing local runtime routing. Other HTTP requests use Chromium's network handler; context isolation and web security remain enabled. File paths are confined to the bundled frontend directory. An optional `BEEGAME_DESKTOP_APP_URL=https://<approved-renderer-host>` still selects the hosted mode, which remains HTTPS-only. Forge registers the `beegame://oauth/callback` protocol. OAuth uses a one-time callback code and the renderer's existing `sessionStorage` PKCE verifier; the desktop bridge accepts callbacks only from the trusted main renderer frame. A cold desktop restart cannot recover an interrupted login because that verifier is renderer-local; start sign-in again after restarting. Signing, notarization, and the real OAuth provider configuration are external release inputs.

Useful checks are `npm run typecheck`, `npm test`, `npm run lint`, `npm run package`, and `npm run make`. The current environment can compile Forge Vite targets, but the official Electron artifact download may be blocked by DNS/TLS access to GitHub.

## Desktop layout

The frontend is bundled during packaging. In optional hosted mode, release the matching frontend version. The frontend now
selects its desktop layout from the preload bridge, while normal browser sessions
keep the web layout. The window uses native macOS traffic lights or the native
Windows/Linux window-controls overlay. The renderer reserves their space and owns
the draggable titlebar; the load-failure page also provides a drag region.

The preload exposes the OS name and a boolean `setTheme` operation in addition to
the existing OAuth and external-link functions. The main process validates both
the caller and theme payload. Theme synchronization follows the frontend's saved
appearance. Context isolation, sandboxing, navigation restrictions and the
trusted-renderer checks remain enabled.

## App branding

App, Dock and About icons reuse the existing frontend bee mascot. Assets and regeneration instructions are under `assets/`. Run `npm run icons` to regenerate PNG, ICNS and ICO from the canonical SVG. The internal package name stays stable to retain the existing app data directory.

## Desktop preview 0.1.0

Project navigation remembers manual visibility in wide windows, collapses on
narrow project entry, and exposes full names on hover. The last project is stored
per signed-in account; explicit project/resource routes take precedence, and New
Project clears that account's remembered project. Invalid saved projects return
to the idea home. Web routing keeps its existing behavior.

The desktop workbench divider supports pointer drag, Left/Right arrows and Home;
double-click restores the default. The chosen width is remembered, and preview
iframes remain mounted while resizing or switching narrow panes. Files/assets
buttons have hover descriptions and an active state.

Native menus expose Cmd/Ctrl+N (New Project), Cmd/Ctrl+B (Toggle Sidebar), and
Cmd/Ctrl+L (Focus Input). Input focus returns from files/assets to chat and brings
chat forward in narrow layouts. Existing idea/chat composers are unchanged.

`npm run make:dmg` creates the macOS ZIP and a DMG with an Applications shortcut.
The DMG script preserves framework symlinks. This is an unsigned preview;
Developer ID signing/notarization and a hosted updater are not configured.

## Desktop preview 0.1.1

A direct Project History entry appears below New Project in the desktop sidebar
for signed-in users. It opens the existing project-history window from either
the idea home or workspace, with the original search, pagination and project
management behavior. Closing history preserves the idea draft.

## Desktop preview 0.1.2

The project sidebar is 264 px wide. The account trigger contains the avatar and
nickname in one button, with email-prefix/account fallbacks when no nickname is
available. Profile, system settings and the Credit store open one desktop page
with category navigation. The page embeds the existing settings/profile/store
content and operations; web sessions retain their dialogs. Underlying idea/chat
views remain mounted and inert until returning, and the settings page covers both the project sidebar and workbench below the
window titlebar. Back restores the prior sidebar state and draft. New Project
can exit settings through the native menu. Credit overview reuses the active
view's balance subscription. Desktop checkout uses the existing external-browser
bridge, with no new payment API. Narrow windows use compact settings navigation.

## Desktop preview 0.1.3

Desktop settings now use their own compact navigation and page layout while sharing the existing settings controller, permissions and service operations. Profile and Credit store have dedicated desktop views rather than embedded dialog bodies. The page uses aligned setting rows, a horizontal identity section, Credit pack selection with one checkout action, and local configuration saves without leaving settings. Reasoning preferences save on selection and revert on failure. Desktop appearance supports a persisted system/light/dark preference; OS appearance changes are followed while system mode is selected. ChatGPT authorization and checkout open through the existing external-browser bridge. Closing desktop settings unmounts connection panels and cancels pending authorization. The underlying project view and its original idea/chat inputs remain mounted.

End-to-end cloud integration and full project-creation testing remain deferred. No model calls or real payments are part of this validation. This is still an unsigned, unnotarized macOS arm64 preview.
