# Preview Starting State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show immediate loading feedback and prevent duplicate clicks while a live preview is starting.

**Architecture:** Keep the pending state local to `BeeGameLivePreviewPage`. Fold it into the existing derived preview state and render the existing localized `starting` message; do not change the preview API or parent state machine.

**Tech Stack:** React, TypeScript, Tailwind, Vitest, Testing Library.

---

### Task 1: Add the failing pending-state test

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/DashboardView.test.tsx`

- [ ] Add a test with a deferred `startProjectPreview` promise. Render without a preview URL, click `播放预览`, then assert the button is disabled, the preview surface shows `正在准备预览`, and a second click does not create another start request.
- [ ] Run the focused test and confirm it fails because the current play button remains enabled and the surface remains in its prior state.

### Task 2: Implement immediate starting feedback

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx`

- [ ] Add `isStartingPreview` state initialized to `false`.
- [ ] Make `previewState` resolve to `starting` while the local flag is true, and include the flag in `canStartPreview`.
- [ ] In `handlePlay`, guard against the local pending state, set it before awaiting `onStartPreview`, and clear it in `finally`.
- [ ] Render an animated `RefreshCw` icon and the localized starting label as the play button accessible name/title while pending; keep the existing Play icon and label otherwise.

### Task 3: Verify

**Files:**
- No additional files.

- [ ] Run the focused pending-state test and the existing preview action tests.
- [ ] Run `conda run -n xrmoddemiurge npm run build` from `apps/frontend`.
- [ ] Run `git diff --check` and review only the intended component/test changes, preserving unrelated dirty worktree changes.
