# Review Acceptance Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated user create an isolated current-schema Foundation Reviewer project from an owned project's confirmed Brief and eight completed foundation documents through Web/React.

**Architecture:** A focused backend service imports only byte-validated document files and plain Brief authority into a new managed workspace, then writes a fresh current-schema delivery run at `FOUNDATION_REVIEW`. One authenticated route registers the new project after the filesystem commit. The existing frontend history menu calls that route and selects the returned project; the existing Reviewer remains the only semantic review implementation.

**Tech Stack:** TypeScript 6, Bun, Hono, Zod 4, React 18, Zustand, Vitest, Testing Library, Chrome Web/React acceptance.

## Global Constraints

- Source project is read-only.
- Copy exactly the eight `CANONICAL_FOUNDATION_DOCUMENTS` plus `confirmedBriefContext`; copy no workflow state, reports, resources, sessions, usage, model configuration or journals.
- Reject missing, symlinked, non-regular or oversized documents.
- All source and destination paths remain below their owned workspace roots.
- Initialize only the current `DELIVERY_RUN_SCHEMA_VERSION` at `DOCUMENT_REVIEW / FOUNDATION_REVIEW`.
- Register destination metadata only after filesystem and run persistence succeed.
- Cleanup an incomplete destination when any step fails.
- Use the normal Web/React route; no test-only endpoint and no filesystem-only acceptance shortcut.
- Chrome acceptance uses frontend `62173` and runtime `62174`.

---

## File Structure

**Create**

- `packages/agent-workflow-server/src/beegame/review-project-copy.ts` — copy validation, byte import and fresh run initialization.
- `packages/agent-workflow-server/src/beegame/review-project-copy.test.ts` — service success, isolation and failure cleanup.

**Modify**

- `packages/agent-workflow-server/src/app.ts` — authenticated route and post-commit metadata registration.
- `packages/agent-workflow-server/src/__tests__/session-routes.test.ts` — route ownership and response behavior.
- `apps/frontend/src/services/beeGameAdapter.ts` — route client.
- `apps/frontend/src/services/beeGameAdapter.test.ts` — client contract.
- `apps/frontend/src/services/api.ts` — public API projection.
- `apps/frontend/src/store/projectStore.ts` — action and returned-project insertion.
- `apps/frontend/src/store/projectStore.test.ts` — state behavior.
- `apps/frontend/src/components/Demiurge/Landing/ProjectHistoryModal.tsx` — one menu action and pending state.
- `apps/frontend/src/components/Demiurge/Landing/ProjectHistoryModal.test.tsx` — UI success/failure/no-duplicate behavior.
- `apps/frontend/src/i18n/locales/en.json`
- `apps/frontend/src/i18n/locales/zh.json`

---

### Task 1: Build the isolated copy service

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/review-project-copy.ts`
- Create: `packages/agent-workflow-server/src/beegame/review-project-copy.test.ts`

**Interfaces:**
- Consumes: `CANONICAL_FOUNDATION_DOCUMENTS`, `createInitialDeliveryRun()`, `createRunStore()`, `createDocumentReviewRun()`.
- Produces:

```ts
export type ReviewProjectCopyResult = {
  workspacePath: string
  run: DeliveryRun
}

export async function createReviewProjectCopy(input: {
  sourceWorkspacePath: string
  destinationWorkspacePath: string
  ownerId: string
  projectId: string
  confirmedBriefContext: string
}): Promise<ReviewProjectCopyResult>
```

- [ ] **Step 1: Write failing success and source-immutability tests**

Create a temporary source containing all eight canonical paths and a destination sibling. Hash every source file and the source `.beegame/workflow/run.json`, call `createReviewProjectCopy()`, then assert:

```ts
expect(result.run).toMatchObject({
  schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
  projectId: 'copy-project',
  ownerId: 'owner-1',
  phase: 'DOCUMENT_REVIEW',
  documentStep: 'FOUNDATION_REVIEW',
  status: 'running',
  foundationDraftState: { completedPaths: CANONICAL_FOUNDATION_DOCUMENTS },
})
expect(result.run.documentReviewState.activeRun).toMatchObject({
  scope: 'foundation',
  status: 'pending',
  attempt: 1,
})
```

Assert destination document bytes equal source bytes and source hashes remain unchanged.

- [ ] **Step 2: Run RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/review-project-copy.test.ts
```

Expected: module-not-found failure for `./review-project-copy`.

- [ ] **Step 3: Implement strict import validation and fresh run creation**

Implementation requirements:

```ts
const MAX_REVIEW_COPY_DOCUMENT_BYTES = 2 * 1024 * 1024
```

For each canonical path, resolve beneath `sourceWorkspacePath`, use `lstat()` to reject symlinks/non-files, enforce the byte limit, and retain the bytes in memory. Reject an empty trimmed Brief. Reject an existing destination. Create a temporary sibling directory named from the destination basename plus a random suffix. Write each file with `flag: 'wx'`, fsync each file and its parent directories, create a current-schema run using the SHA-256 Brief digest and `computeDocumentRevision()`, set all eight documents complete, attach `createDocumentReviewRun({ scope: 'foundation', revision })`, save through `createRunStore()`, fsync the temporary root, then atomically rename it to the final destination. On error, recursively remove only the resolved temporary destination.

- [ ] **Step 4: Add RED/GREEN failure tests**

Test each independently:

- missing one canonical document;
- symlinked canonical document;
- blank Brief;
- existing destination;
- injected run-store failure leaves no final or temporary destination.

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/review-project-copy.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/review-project-copy.ts packages/agent-workflow-server/src/beegame/review-project-copy.test.ts
git commit -m "feat: create isolated review project copies"
```

---

### Task 2: Add the authenticated project route

**Files:**
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`

**Interfaces:**
- Consumes: `createReviewProjectCopy()` from Task 1, `getOwnedProjectMetadata()`, `resolveSessionWorkspacePath()`, `getDefaultWorkspacePath()`, `getUserDashboardDataRoot()`, `dashboardRepository.upsertProject()`.
- Produces: `POST /api/projects/:id/review-copy -> { project, runId, phase }`.

- [ ] **Step 1: Write the failing route test**

Build an owned project with eight files and a raw workflow snapshot containing `confirmedBriefContext`. Call:

```ts
const response = await app.request('/api/projects/source-project/review-copy', {
  method: 'POST',
})
```

Assert status `201`, returned project ID differs from the source, destination root differs from the source, and the returned phase is `DOCUMENT_REVIEW`. Load the destination `run.json` and assert current schema plus `FOUNDATION_REVIEW`.

- [ ] **Step 2: Run RED**

Run:

```bash
bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts -t "creates an isolated review copy"
```

Expected: `404` because the route does not exist.

- [ ] **Step 3: Implement the minimal route**

Route behavior:

```ts
app.post('/api/projects/:id/review-copy', async c => {
  const user = getCurrentUser(c.req.raw)
  const forbidden = requirePermission(user, 'project.create')
  if (forbidden) return c.json(forbidden, 403)
  // owner lookup, source path resolution, raw snapshot Brief extraction,
  // destination ID/path creation, service call, metadata registration
})
```

Use `randomUUID()` for the new ID. Resolve the default workspace and current user root, then derive the not-yet-created destination as `join(userRoot, `review-copy--${projectId}`)`; the service owns directory creation and atomic rename. Name the metadata `${source.name} Review Copy`. Read raw snapshot JSON without calling `parseDeliveryRun`; extract only a trimmed string `confirmedBriefContext`. After `createReviewProjectCopy()` succeeds, register metadata with `phase_name: 'DOCUMENT_REVIEW'`. If metadata registration fails, remove only the newly created destination. Return the original API error through `tracedRouteError()`.

- [ ] **Step 4: Add authorization and atomicity tests**

Add cases asserting:

- foreign/missing project returns `404` and creates nothing;
- missing Brief returns `400` with the original message;
- project quota/metadata failure removes the destination;
- source metadata, source snapshot and source document bytes remain unchanged.

Run:

```bash
bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts
bun run typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
git commit -m "feat: expose review copy creation"
```

---

### Task 3: Add the Web/React history action

**Files:**
- Modify: `apps/frontend/src/services/beeGameAdapter.ts`
- Modify: `apps/frontend/src/services/beeGameAdapter.test.ts`
- Modify: `apps/frontend/src/services/api.ts`
- Modify: `apps/frontend/src/store/projectStore.ts`
- Modify: `apps/frontend/src/store/projectStore.test.ts`
- Modify: `apps/frontend/src/components/Demiurge/Landing/ProjectHistoryModal.tsx`
- Modify: `apps/frontend/src/components/Demiurge/Landing/ProjectHistoryModal.test.tsx`
- Modify: `apps/frontend/src/i18n/locales/en.json`
- Modify: `apps/frontend/src/i18n/locales/zh.json`

**Interfaces:**
- Consumes: Task 2 route.
- Produces:

```ts
beeGameAdapter.createReviewCopy(projectId: string): Promise<{ project: Project }>
useProjectStore().createReviewCopy(projectId: string): Promise<Project>
```

- [ ] **Step 1: Write failing adapter and store tests**

Assert the adapter sends exactly one `POST` to the encoded review-copy route. Assert the store inserts the returned project once, sets it active, and returns it without mutating the source project.

- [ ] **Step 2: Run RED**

Run:

```bash
cd apps/frontend
bunx vitest run src/services/beeGameAdapter.test.ts src/store/projectStore.test.ts
```

Expected: missing-method failures.

- [ ] **Step 3: Implement the adapter/store boundary**

Use existing `postJson()` and timestamp normalization. Do not refresh all projects after success; insert the returned authoritative project and set `activeProjectId` in one Zustand update. Let the original API error propagate.

- [ ] **Step 4: Write the failing history-menu test**

Render two projects, open the source row menu, click `Create review copy`, and assert:

- the store action receives the source ID once;
- the menu button becomes pending/disabled;
- `onSelectProject(copy.id)` is called after success;
- the modal closes after success;
- a rejected request leaves the modal open, source row present, action enabled and original error visible through the existing toast path.

- [ ] **Step 5: Implement the single menu action**

Import `CopyPlus` from `lucide-react`. Add `copyingProjectId` state and a `handleCreateReviewCopy()` handler parallel to deletion but without confirmation. Add localized labels:

```json
"createReviewCopy": "Create review copy",
"creatingReviewCopy": "Creating review copy…"
```

and Chinese equivalents. Disable row selection and repeat actions only for the row being copied.

- [ ] **Step 6: Run frontend GREEN and regression tests**

Run:

```bash
cd apps/frontend
bunx vitest run src/services/beeGameAdapter.test.ts src/store/projectStore.test.ts src/components/Demiurge/Landing/ProjectHistoryModal.test.tsx
bun run test:run
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/services/beeGameAdapter.ts apps/frontend/src/services/beeGameAdapter.test.ts apps/frontend/src/services/api.ts apps/frontend/src/store/projectStore.ts apps/frontend/src/store/projectStore.test.ts apps/frontend/src/components/Demiurge/Landing/ProjectHistoryModal.tsx apps/frontend/src/components/Demiurge/Landing/ProjectHistoryModal.test.tsx apps/frontend/src/i18n/locales/en.json apps/frontend/src/i18n/locales/zh.json
git commit -m "feat: create review copies from project history"
```

---

### Task 4: Verify and run Chrome acceptance

**Files:**
- No production file changes unless a failing acceptance exposes a defect in Tasks 1-3.

**Interfaces:**
- Consumes: Tasks 1-3 and the rebuilt Reviewer at commit `549ed0d1`.
- Produces: Web/React acceptance evidence and a final pass/fail report.

- [ ] **Step 1: Run static and complete automated verification**

Run:

```bash
bun run typecheck
bun test --dots packages/agent-workflow-server/src
cd apps/frontend && bun run test:run
git diff --check
```

Expected: zero failures and a clean worktree after commits.

- [ ] **Step 2: Start fixed-port services**

Start the existing development command with frontend `62173` and runtime `62174`. Confirm both listen before browser interaction. Do not change model/provider settings.

- [ ] **Step 3: Create the acceptance copy through Chrome**

Open `http://127.0.0.1:62173/` in Chrome, open project history, choose an existing completed eight-document project, open its menu, click `Create review copy`, and verify the new project is selected. Confirm the source project still appears unchanged.

- [ ] **Step 4: Observe the real Reviewer workflow**

Verify through the visible Web/React surface:

- phase is Document Review;
- bounded specialist roles appear;
- original per-role failures are visible if any;
- successful reports appear below `.beegame/reviews/foundation/<revision>/`;
- final Markdown appears only after its accepted digest exists;
- verdict and affected paths render;
- `NEEDS_REVISION` routes to document ownership and `READY` routes to checklist drafting;
- after three consecutive revision verdicts the workflow stops for user action.

If Chrome contradicts the architecture or repeats the same failure class twice, stop and reassess the design instead of adding compatibility or semantic parsing.

- [ ] **Step 5: Record acceptance result and final repository state**

Capture project IDs, revision, role statuses, verdict, elapsed time, token counters and exact error text when applicable. Stop fixed-port services. Run:

```bash
git status --short
git log -4 --oneline
```

Expected: clean worktree and three implementation commits following the design/plan commits.
