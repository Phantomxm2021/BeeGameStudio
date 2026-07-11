# Resource Pack Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace ZIP-first Pack management with a product-grade create-Pack and Finder-style authoring workspace while retaining ZIP as an admin migration path.

**Architecture:** Extend the existing resource core with explicit folder nodes and upload states. Add Supabase-backed CRUD endpoints for draft Packs, folders, and element metadata; keep Storage for binaries. Replace the current frontend Pack detail view with a three-pane authoring workspace and a create-Pack dialog, using the existing API client and BeeGame typography/design tokens.

**Tech Stack:** Bun/Hono-style server app, Supabase REST/Storage, TypeScript, React, existing shadcn primitives, Vitest/Bun tests.

---

### Task 1: Extend resource domain for folders and authoring states

**Files:**
- Modify: `packages/beegame-resource-core/src/index.ts`
- Modify: `packages/beegame-resource-core/src/repository.ts`
- Create: `packages/beegame-resource-core/src/__tests__/authoring.test.ts`
- Modify: `docs/beegame-supabase-schema.sql`

- [ ] Write tests for folder creation, nested paths, element upload states, and publish preconditions.
- [ ] Run `bun test packages/beegame-resource-core/src/__tests__/authoring.test.ts` and confirm the new types/operations fail.
- [ ] Add `ResourceFolder`, `ResourceUploadState`, and repository methods for folder CRUD and element metadata updates.
- [ ] Add schema tables/columns for folders, upload state, and canonical storage paths with indexes on `(pack_id,parent_id)` and `(pack_id,path)`.
- [ ] Run core tests and typecheck; commit `feat: add resource pack authoring domain`.

### Task 2: Add draft Pack and folder server APIs

**Files:**
- Modify: `packages/beegame-resource-server/src/app.ts`
- Modify: `packages/beegame-resource-server/src/index.ts`
- Modify: `packages/beegame-resource-server/src/supabase-resource-repository.ts`
- Create: `packages/beegame-resource-server/src/__tests__/authoring-routes.test.ts`

- [ ] Write route tests for `POST /api/resource-packs`, folder CRUD, and publish validation.
- [ ] Run the focused tests and verify they fail because routes and repository methods are absent.
- [ ] Implement draft Pack creation with the four required fields and status `draft`.
- [ ] Implement folder list/create/rename/move/delete routes scoped to a Pack and protected by `resources.manage`.
- [ ] Implement publish validation for required metadata, failed uploads, and dependency references.
- [ ] Run all resource-server tests and typecheck; commit `feat: add resource authoring routes`.

### Task 3: Implement element upload queue and metadata endpoints

**Files:**
- Modify: `packages/beegame-resource-server/src/index.ts`
- Modify: `packages/beegame-resource-server/src/app.ts`
- Modify: `packages/beegame-resource-server/src/import-resource-pack.ts`
- Create: `packages/beegame-resource-server/src/upload-state.ts`
- Create: `packages/beegame-resource-server/src/__tests__/element-upload.test.ts`

- [ ] Write tests for queued/uploading/ready/failed transitions, duplicate path rejection, and cleanup after metadata failure.
- [ ] Run the tests to confirm the state machine and endpoint are missing.
- [ ] Add an upload handler accepting a Pack id, folder path, file, and semantic metadata; use bucket/path namespacing and explicit ArrayBuffer payloads.
- [ ] Add element metadata PATCH and DELETE endpoints; DELETE removes the Storage object only after metadata authorization succeeds.
- [ ] Return per-file progress-compatible response fields and preserve failed records for retry.
- [ ] Run focused and full server tests; commit `feat: add element upload lifecycle`.

### Task 4: Add frontend API contracts and create-Pack flow

**Files:**
- Modify: `apps/frontend/src/services/resourceLibraryApi.ts`
- Modify: `apps/frontend/src/services/resourceLibraryApi.test.ts`
- Create: `apps/frontend/src/components/Demiurge/ResourceLibrary/CreateResourcePackDialog.tsx`
- Create: `apps/frontend/src/components/Demiurge/ResourceLibrary/CreateResourcePackDialog.test.tsx`

- [ ] Add typed API methods for Pack creation, folder CRUD, element upload, element metadata update, and publish.
- [ ] Write dialog tests for required name/style/dimension/game-type validation and draft creation.
- [ ] Run Vitest and confirm the dialog/API tests fail before implementation.
- [ ] Implement the dialog with existing typography, form controls, i18n keys, and no new sidebar/frame.
- [ ] Run frontend focused tests and typecheck; commit `feat: add resource pack creation flow`.

### Task 5: Replace Pack detail with Finder-style authoring workspace

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/ResourceLibrary/ResourceLibraryView.tsx`
- Create: `apps/frontend/src/components/Demiurge/ResourceLibrary/ResourcePackWorkspace.tsx`
- Create: `apps/frontend/src/components/Demiurge/ResourceLibrary/FolderTree.tsx`
- Create: `apps/frontend/src/components/Demiurge/ResourceLibrary/ElementBrowser.tsx`
- Create: `apps/frontend/src/components/Demiurge/ResourceLibrary/ElementInspector.tsx`
- Create: `apps/frontend/src/components/Demiurge/ResourceLibrary/UploadQueue.tsx`
- Modify: `apps/frontend/src/components/Demiurge/ResourceLibrary/*.test.tsx`

- [ ] Write component tests for empty Pack state, folder navigation, selected element inspector, and upload retry/error states.
- [ ] Run focused frontend tests and confirm the new workspace behavior is absent.
- [ ] Implement the three-pane layout: folder tree, selected-folder browser, inspector; use existing dark design tokens and shadcn Empty pattern.
- [ ] Add Pack header actions for metadata, save state, publish, and ZIP overflow import.
- [ ] Implement multi-file/folder drag-drop queue with per-file progress, retry, cancel, and refresh-safe server states.
- [ ] Run frontend tests, lint, and typecheck; commit `feat: add finder resource authoring workspace`.

### Task 6: Integrate navigation, translations, and acceptance coverage

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx`
- Modify: `apps/frontend/src/i18n/index.ts`
- Modify: `apps/frontend/src/i18n/useBeeGameTranslations.ts`
- Modify: `apps/frontend/src/services/resourceLibraryApi.ts`
- Create: `apps/frontend/src/components/Demiurge/ResourceLibrary/resourceAuthoring.acceptance.test.tsx`

- [ ] Add navigation from the admin resource entry to the Pack workspace and back without embedding it inside Settings.
- [ ] Add Chinese and English strings for creation, folders, upload states, inspector, validation, and publish actions.
- [ ] Write an acceptance test covering create mixed Pack → create folder → upload two files → edit metadata → publish.
- [ ] Run the complete frontend and server suites plus both typechecks.
- [ ] Review the rendered page in the local browser at desktop and narrow widths; commit `test: cover resource authoring flow`.

### Task 7: Remove obsolete ZIP-first UI assumptions

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/ResourceLibrary/ResourceLibraryView.tsx`
- Modify: `apps/frontend/src/services/resourceLibraryApi.ts`
- Modify: `packages/beegame-resource-server/src/import-resource-pack.ts`

- [ ] Remove summary-card/import-first controls that are no longer part of the primary flow while preserving the admin overflow ZIP action.
- [ ] Ensure no browser-local persistence or ZIP parsing remains in the frontend.
- [ ] Run `rg -n "localStorage|unzipSync|pack.json" apps/frontend/src/components/Demiurge/ResourceLibrary apps/frontend/src/services/resourceLibraryApi.ts` and verify only server migration code references ZIP/manifest parsing.
- [ ] Run all tests, typechecks, and `git diff --check`; commit `refactor: make pack authoring the primary flow`.

