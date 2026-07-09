# Preview Action Group Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Group the live preview refresh and open-online-version actions together at the right side of the toolbar without changing their behavior.

**Architecture:** Keep `BeeGameLivePreviewPage` as the sole owner of preview toolbar rendering and callbacks. Split the existing single `ButtonGroup` into a primary-controls group and an online-preview group, separated by a small flex gap. Extend the existing component test to assert the accessible order and independent group boundaries.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest, Testing Library.

---

### Task 1: Add the failing toolbar grouping test

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/DashboardView.test.tsx`
- Test target: the BeeGame live preview toolbar rendered by `DashboardView`

- [ ] **Step 1: Locate the existing BeeGame preview action tests and add one focused assertion.**

Use the existing render helpers and accessible labels already present in the test file. The test should render the preview in a live state, find the actions group, and assert that the primary controls and online preview controls are separate groups with the online group ordered last. Use accessible names rather than implementation-specific class names.

- [ ] **Step 2: Run the focused test and verify it fails because the current toolbar has one group.**

Run:

```bash
conda run -n xrmoddemiurge npm exec vitest -- apps/frontend/src/components/Demiurge/DashboardView.test.tsx -t "groups online preview actions"
```

Expected result: the new test fails because the current markup exposes only one action group.

### Task 2: Implement the two-group toolbar layout

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx:379-445`

- [ ] **Step 1: Preserve the existing button elements and handlers while changing only their containers.**

Render the start/stop and deploy buttons in the first `ButtonGroup`. Render refresh and open-online-version buttons in a second `ButtonGroup` with the same `aria-label` semantics. Wrap both groups in a flex container with `gap-2`, `justify-end`, and `shrink-0` so the second group remains at the right edge. Keep `handleRestart`, `handlePlay`, `handleStop`, `setDeploymentDialogOpen`, and `onOpenExternal` unchanged.

- [ ] **Step 2: Run the focused test and verify it passes.**

Run:

```bash
conda run -n xrmoddemiurge npm exec vitest -- apps/frontend/src/components/Demiurge/DashboardView.test.tsx -t "groups online preview actions"
```

Expected result: PASS.

### Task 3: Run regression checks

**Files:**
- No additional files.

- [ ] **Step 1: Run the complete DashboardView test file.**

```bash
conda run -n xrmoddemiurge npm exec vitest -- apps/frontend/src/components/Demiurge/DashboardView.test.tsx
```

Expected result: all tests pass.

- [ ] **Step 2: Run the frontend typecheck/build command defined by the repository.**

Inspect `apps/frontend/package.json` for the existing check script, then run the matching command with `conda run -n xrmoddemiurge`. Expected result: exit code 0 with no TypeScript/build errors.

- [ ] **Step 3: Review the diff and confirm only the planned layout/test changes are present.**

Use `git diff -- apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx apps/frontend/src/components/Demiurge/DashboardView.test.tsx` and leave all unrelated pre-existing working-tree changes untouched.
