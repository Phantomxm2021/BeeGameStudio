# Resource Library Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an Admin-only resource-library service and frontend panel for Pack-first asset management, with Pack cards at the root and a Pack detail workspace that uses a category tree, large asset preview, and overlay properties.

**Architecture:** Introduce a small shared `beegame-resource-core` package for Pack/element contracts, validation, repository interfaces, and route behavior. Run it through a separate `beegame-resource-server` Bun service with a local repository for development and an adapter boundary for Supabase persistence. The frontend consumes the service through a dedicated resource API client and renders the Admin Pack grid and Pack detail browser; existing project asset-manifest upload behavior remains unchanged.

**Tech Stack:** TypeScript, Bun.serve, Vitest/Bun test, React, existing Tailwind/zinc/glass design tokens, Supabase REST boundary.

---

### Task 1: Define resource contracts and repository behavior

**Files:**
- Create: `packages/beegame-resource-core/package.json`
- Create: `packages/beegame-resource-core/src/types.ts`
- Create: `packages/beegame-resource-core/src/validation.ts`
- Create: `packages/beegame-resource-core/src/repository.ts`
- Create: `packages/beegame-resource-core/src/__tests__/validation.test.ts`
- Create: `packages/beegame-resource-core/src/__tests__/repository.test.ts`

- [ ] **Step 1: Write failing contract tests**

  Add tests covering: a Pack requires a name, primary dimension (`2D`, `3D`, or `agnostic`), style, supported game types, and an array-valued `categories` field (which may be empty before elements are uploaded); elements inherit Pack metadata while retaining their own category and preview metadata; invalid dimensions/categories are rejected; listing Pack cards returns stable counts and sorting; listing elements by category returns only elements in that Pack.

- [ ] **Step 2: Run the focused tests and verify RED**

  Run `bun test packages/beegame-resource-core/src/__tests__` from the worktree root. Expected result: module/contract failures because the core package does not exist yet.

- [ ] **Step 3: Implement the minimal contracts**

  Define `ResourcePack`, `ResourceElement`, `ResourceCategory`, `ResourceDimension`, `PackSummary`, `ResourceRepository`, and `ResourceValidationError`. Keep Pack metadata Pack-first: `style`, `gameTypes`, `dimension`, `categories`, `license`, `status`, `version`; keep element metadata focused on `path`, `category`, `kind`, `preview`, `specs`, `dependencies`, and optional overrides.

- [ ] **Step 4: Implement validation and a deterministic local repository**

  Implement pure validation functions and an in-memory repository that supports `listPacks`, `getPack`, `listElements`, and `getElement`. Sort Pack summaries by name and elements by normalized path. Do not match by hardcoded keywords; filter by explicit fields and category/dimension values.

- [ ] **Step 5: Run focused tests and commit**

  Run `bun test packages/beegame-resource-core/src/__tests__`; expected result: all new tests pass. Commit with `git add packages/beegame-resource-core && git commit -m "feat: add resource library contracts"`.

### Task 2: Add the standalone resource service

**Files:**
- Create: `packages/beegame-resource-server/package.json`
- Create: `packages/beegame-resource-server/src/auth.ts`
- Create: `packages/beegame-resource-server/src/app.ts`
- Create: `packages/beegame-resource-server/src/env.ts`
- Create: `packages/beegame-resource-server/src/index.ts`
- Create: `packages/beegame-resource-server/src/__tests__/app.test.ts`
- Modify: `scripts/beegame-dev-lib.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing route and permission tests**

  Test `GET /api/resource-packs`, `GET /api/resource-packs/:packId`, `GET /api/resource-packs/:packId/elements`, and `GET /api/resource-packs/:packId/elements/:elementId`. Test that an Admin/owner context can read them and a viewer context receives 403. Test missing Pack and element IDs return 404 and malformed query values return 400.

- [ ] **Step 2: Run focused tests and verify RED**

  Run `bun test packages/beegame-resource-server/src/__tests__/app.test.ts`; expected result: route module failures because the server package does not exist yet.

- [ ] **Step 3: Implement the server boundary**

  Build `createBeeGameResourceServerApp({ repository, currentUser, currentUserResolver })` with the same authenticated-user resolution shape used by the existing skills server. Require a resource-admin permission or owner role on every route. Return JSON contracts from the core repository and consistent `{ error: { code, message } }` failures.

- [ ] **Step 4: Add local service configuration**

  Add `BEEGAME_RESOURCE_HOST`, `BEEGAME_RESOURCE_PORT`, and optional local seed configuration. Add the resource process to `buildBeeGameDevPlan` with a non-conflicting default port and expose `resources` in the printed local service URLs. Update the README local-development service list.

- [ ] **Step 5: Run tests and commit**

  Run `bun test packages/beegame-resource-core/src/__tests__ packages/beegame-resource-server/src/__tests__ scripts/beegame-dev-lib.test.ts`; expected result: all focused tests pass. Commit with `git add packages/beegame-resource-core packages/beegame-resource-server scripts/beegame-dev-lib.ts README.md && git commit -m "feat: add standalone resource library service"`.

### Task 3: Add persistent Pack/element storage boundary

**Files:**
- Modify: `docs/beegame-supabase-schema.sql`
- Create: `packages/beegame-resource-server/src/supabase-resource-repository.ts`
- Create: `packages/beegame-resource-server/src/__tests__/supabase-resource-repository.test.ts`
- Modify: `packages/beegame-resource-server/src/app.ts`

- [ ] **Step 1: Write repository adapter tests**

  Test request construction for Pack summaries, Pack detail, category-filtered elements, and element detail. Assert that user credentials are never exposed and that only the server-side Supabase key is used by this adapter.

- [ ] **Step 2: Add the schema**

  Add `beegame_resource_packs` and `beegame_resource_elements` with Pack metadata, element category/path/preview/spec fields, version/status, and indexes for Pack/category/path. Add owner/platform-owner access policies consistent with the existing `beegame_is_platform_owner()` helpers.

- [ ] **Step 3: Implement the adapter and service selection**

  Implement Supabase REST reads behind `ResourceRepository`. Use the local repository only when explicitly configured for local development; otherwise fail with a clear configuration error instead of silently returning fake data.

- [ ] **Step 4: Run tests and commit**

  Run `bun test packages/beegame-resource-server/src/__tests__`; expected result: adapter and route tests pass. Commit with `git add docs/beegame-supabase-schema.sql packages/beegame-resource-server && git commit -m "feat: persist resource packs and elements"`.

### Task 4: Add the frontend resource service client

**Files:**
- Create: `apps/frontend/src/services/resourceLibraryApi.ts`
- Create: `apps/frontend/src/services/resourceLibraryApi.test.ts`
- Modify: `apps/frontend/src/services/api.ts`
- Modify: `apps/frontend/src/services/currentUserApi.ts`

- [ ] **Step 1: Write failing client tests**

  Test request paths, query encoding for category filters, JSON normalization, empty collections, 403 handling, and 404 handling. Assert that the client does not reuse project asset-manifest upload endpoints.

- [ ] **Step 2: Run focused tests and verify RED**

  Run `bunx vitest run apps/frontend/src/services/resourceLibraryApi.test.ts`; expected result: module failure because the client does not exist yet.

- [ ] **Step 3: Implement the dedicated client**

  Add typed `listPacks`, `getPack`, `listElements`, and `getElement` functions using the existing authenticated fetch/base URL conventions. Keep Pack library reads separate from project asset upload/integration methods.

- [ ] **Step 4: Run client tests and commit**

  Run `bunx vitest run apps/frontend/src/services/resourceLibraryApi.test.ts`; expected result: pass. Commit with `git add apps/frontend/src/services/resourceLibraryApi.ts apps/frontend/src/services/resourceLibraryApi.test.ts apps/frontend/src/services/api.ts apps/frontend/src/services/currentUserApi.ts && git commit -m "feat: add resource library frontend client"`.

### Task 5: Build the Admin Pack grid and Pack detail browser

**Files:**
- Create: `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx`
- Create: `apps/frontend/src/components/ResourceLibrary/PackGrid.tsx`
- Create: `apps/frontend/src/components/ResourceLibrary/PackBrowser.tsx`
- Create: `apps/frontend/src/components/ResourceLibrary/ResourceInspectorOverlay.tsx`
- Create: `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx`
- Modify: `apps/frontend/src/components/Demiurge/DashboardView.tsx`
- Modify: `apps/frontend/src/i18n/locales/zh.json`
- Modify: `apps/frontend/src/i18n/locales/en.json`

- [ ] **Step 1: Write failing component tests**

  Test that the root renders Pack cards (not a table or outer wrapper), preserves the “已导入” and “全部元素” summaries, opens a Pack on click, renders a category tree on the left, renders file entries in the selected category, and shows a preview with an overlay inspector containing inherited Pack style/dimension plus element specs. Test loading, empty, and forbidden states.

- [ ] **Step 2: Run focused tests and verify RED**

  Run `bunx vitest run apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx`; expected result: module failure because components do not exist yet.

- [ ] **Step 3: Implement the minimal UI using current design tokens**

  Use existing `type-*`, `glass-panel`, `glass-control`, `primary-pill`, `secondary-pill`, zinc colors, orange status accents, and current radius conventions. Keep the root Pack view as an open Grid. Keep the Pack detail as a two-column file tree/preview workspace. The inspector must be an overlay over the preview and collapse without changing the preview layout.

- [ ] **Step 4: Integrate the Admin route/surface**

  Add the panel only where the returned user permissions include the resource-admin permission; do not expose it in the regular user account menu. Preserve the existing project AssetsPanel for project asset contracts.

- [ ] **Step 5: Run focused frontend tests and commit**

  Run `bunx vitest run apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx apps/frontend/src/services/resourceLibraryApi.test.ts`; expected result: pass. Commit with `git add apps/frontend/src/components/ResourceLibrary apps/frontend/src/components/Demiurge/DashboardView.tsx apps/frontend/src/i18n/locales/zh.json apps/frontend/src/i18n/locales/en.json && git commit -m "feat: add admin resource library panel"`.

### Task 6: Verify the vertical slice

**Files:**
- Modify: `scripts/beegame-dev-lib.test.ts` only if the resource process assertions need coverage.

- [ ] **Step 1: Run focused type checks**

  Run `bun run typecheck` and `bunx vitest run apps/frontend/src/components/ResourceLibrary apps/frontend/src/services/resourceLibraryApi.test.ts packages/beegame-resource-core packages/beegame-resource-server scripts/beegame-dev-lib.test.ts`.

- [ ] **Step 2: Run the local service plan test**

  Run `bun test scripts/beegame-dev-lib.test.ts`; verify the plan includes billing, skills, resource, runtime, and frontend processes with distinct ports.

- [ ] **Step 3: Record unrelated baseline failures**

  Do not modify unrelated failing tests from the baseline run. Report the pre-existing 282 failures/12 errors separately from this feature’s focused verification.

- [ ] **Step 4: Commit verification changes**

  Run `git status --short`, confirm only planned files are changed, then commit any final test-only changes with `git commit -m "test: verify resource library vertical slice"`.
