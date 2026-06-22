# BeeGame Intake Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep users on the landing page after submitting an idea, show selectable BeeGame direction options, collect final production settings, and only then start the dashboard build session.

**Architecture:** Add a lightweight frontend intake layer before the existing BeeGame session bootstrap. The existing dashboard execution flow remains the build surface; the new intake flow produces a final brief and then calls a new adapter method that starts the current backend session with an execution prompt.

**Tech Stack:** React 19, Zustand, Vitest, TypeScript, existing BeeGame adapter and Demiurge/Tailwind components.

---

### Task 1: BeeGame Intake Adapter

**Files:**
- Modify: `apps/frontend/src/services/beeGameAdapter.ts`
- Modify: `apps/frontend/src/services/beeGameAdapter.test.ts`

- [ ] **Step 1: Add failing adapter tests**

Add tests proving `generateIntakeOptions()` returns 2-4 path-safe options and `bootstrapProjectFromBrief()` sends a final execution prompt that rejects host source paths.

- [ ] **Step 2: Run tests to verify failure**

Run: `/Users/nswell/.bun/bin/bun run test:run src/services/beeGameAdapter.test.ts`

Expected: fails because the new adapter methods do not exist.

- [ ] **Step 3: Implement intake types and methods**

Add:
- `BeeGameIntakeOption`
- `BeeGameIntakeSettings`
- `BeeGameBuildBrief`
- `generateIntakeOptions({ idea })`
- `bootstrapProjectFromBrief({ idea, option, settings })`

Use a deterministic local fallback for intake options first. Keep LLM execution only for the confirmed build session.

- [ ] **Step 4: Run adapter tests**

Run: `/Users/nswell/.bun/bin/bun run test:run src/services/beeGameAdapter.test.ts`

Expected: pass.

### Task 2: Landing Intake UI Flow

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/LandingView.tsx`
- Modify: `apps/frontend/src/components/Demiurge/LandingView.test.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/store/projectStore.ts`

- [ ] **Step 1: Add failing UI tests**

Add tests proving idea submit does not immediately transition to the dashboard and option cards render first.

- [ ] **Step 2: Run tests to verify failure**

Run: `/Users/nswell/.bun/bin/bun run test:run src/components/Demiurge/LandingView.test.tsx`

Expected: fails because the page still transitions after submit.

- [ ] **Step 3: Add local intake state**

Add landing states:
- `idle`
- `generating_options`
- `options_ready`
- `configuring_details`
- `confirming_brief`
- `starting_build`
- `failed`

Wire submit to `generateIntakeOptions()`.

- [ ] **Step 4: Render option cards**

Render 2-4 option cards with title, pitch, gameplay, platform, style, dimension, genre, inputs, and scope.

- [ ] **Step 5: Run UI tests**

Run: `/Users/nswell/.bun/bin/bun run test:run src/components/Demiurge/LandingView.test.tsx`

Expected: pass.

### Task 3: Detail Wizard and Final Brief

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/LandingView.tsx`
- Modify: `apps/frontend/src/components/Demiurge/LandingView.test.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/store/projectStore.ts`

- [ ] **Step 1: Add failing tests**

Add tests proving selecting an option opens settings controls and confirming the brief calls build bootstrap.

- [ ] **Step 2: Run tests to verify failure**

Run: `/Users/nswell/.bun/bin/bun run test:run src/components/Demiurge/LandingView.test.tsx`

Expected: fails because wizard controls are not implemented.

- [ ] **Step 3: Add wizard controls**

Add controls for platform, style, dimension, genre, inputs, scope, and notes. Pre-fill from selected option recommendations.

- [ ] **Step 4: Add final brief confirmation**

Render the final brief and call `bootstrapProjectFromBrief()` only when the user confirms.

- [ ] **Step 5: Run UI tests**

Run: `/Users/nswell/.bun/bin/bun run test:run src/components/Demiurge/LandingView.test.tsx`

Expected: pass.

### Task 4: Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:
`/Users/nswell/.bun/bin/bun run test:run src/services/beeGameAdapter.test.ts src/components/Demiurge/LandingView.test.tsx src/App.test.tsx`

- [ ] **Step 2: Run frontend typecheck**

Run:
`/Users/nswell/.bun/bin/bunx tsc -b`

- [ ] **Step 3: Summarize outcome**

Report changed files, tests run, and any known limitations.
