# BeeGame Studio desktop shell

Run the frontend dev server from `apps/frontend` with the repository's fixed port `62173`, then run `npm run start` here. The development URL is localhost-only.

`npm run make` builds the shared frontend into `apps/desktop/frontend`, includes it in the application resources, and generates a ZIP containing the app. No hosted frontend URL or frontend dev server is needed. BGS service deployment is planned for the cloud. Set `VITE_API_BASE_URL` when the cloud endpoint is available; the existing local development endpoint is retained for now. This UI update does not add service startup or management. This package does not include the BGS backend or models. The build reads public `VITE_` configuration from the repository environment, with API requests defaulting to the local runtime.

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

Cloud integration and full project-creation testing remain deferred. No model calls or real payments are part of this validation. This is still an unsigned, unnotarized macOS arm64 preview.
