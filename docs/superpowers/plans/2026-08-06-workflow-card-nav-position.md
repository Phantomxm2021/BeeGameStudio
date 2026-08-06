# Workflow Card Navigation Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the existing workflow stage navigation control group to the bottom-right of the front card without changing its appearance or behavior.

**Architecture:** Keep `WorkflowCard` responsible for constructing the existing control group and `WorkflowStageCard` responsible for placing the supplied `headerControls` slot inside the card surface. The slot will leave the header and become an absolutely positioned bottom-right element; additional bottom padding will reserve space below the existing footer.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest, Testing Library.

---

### Task 1: Lock the placement contract with a failing test

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx:50-85`

- [ ] **Step 1: Add assertions for bottom-right placement.**

Extend the existing stage-deck test after locating `frontCard`:

```tsx
expect(within(front).getByTestId('workflow-card-controls')).toHaveClass('absolute', 'bottom-4', 'right-4');
expect(frontCard).toHaveClass('relative');
```

These assertions must use the existing control test id and front-card scope so they verify the controls are inside the card rather than in an external toolbar.

- [ ] **Step 2: Run the focused test and verify it fails for the missing placement classes.**

Run:

```bash
bun run --cwd apps/frontend test:run -- src/components/Demiurge/WorkflowCard.test.tsx
```

Expected: the existing behavioral tests pass, while the new placement assertion fails because the control group is still rendered in the header and does not have bottom-right positioning.

### Task 2: Move the existing control slot only

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.tsx:108-145`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx:506-565`

- [ ] **Step 1: Add positioning classes to the existing control group.**

Keep every existing control child and visual utility unchanged; update only the group wrapper class in `WorkflowCard.tsx` to include `absolute bottom-4 right-4`.

- [ ] **Step 2: Make the card a positioning context and reserve bottom space.**

In `WorkflowStageCard.tsx`:

```tsx
className="relative box-border min-w-0 w-full max-w-[46rem] overflow-hidden rounded-3xl border border-white/15 bg-[#17181d] text-zinc-100 shadow-sm"
```

Change the content wrapper from `px-4 py-4` to `px-4 pb-16 pt-4` so the absolute controls sit below the existing elapsed/action footer without overlapping it.

- [ ] **Step 3: Render the supplied control slot at the card bottom-right.**

Remove `{headerControls}` from the header status row and render it once near the end of the card section, after the existing content wrapper:

```tsx
{headerControls}
```

The `WorkflowCard` control group itself already has `data-testid="workflow-card-controls"`; no new control markup or behavior is introduced.

- [ ] **Step 4: Run the focused test and verify the placement assertions pass.**

Run:

```bash
bun run --cwd apps/frontend test:run -- src/components/Demiurge/WorkflowCard.test.tsx src/components/Demiurge/useWorkflowCardDeck.test.tsx
```

Expected: 56 tests pass, including the new bottom-right placement assertions.

### Task 3: Verify the unchanged behavior and commit

**Files:**
- Review only: `apps/frontend/src/components/Demiurge/WorkflowCard.tsx`
- Review only: `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`
- Review only: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`

- [ ] **Step 1: Run frontend verification.**

Run:

```bash
bun run --cwd apps/frontend test:run
bun run typecheck
bun run --cwd apps/frontend build
bun run --cwd apps/frontend eslint src/components/Demiurge/WorkflowCard.tsx src/components/Demiurge/WorkflowCard.test.tsx src/components/Demiurge/WorkflowStageCard.tsx
git diff --check
```

Expected: all 663 frontend tests pass, typecheck/build succeed, the three changed files have no ESLint errors, and `git diff --check` is clean. Existing unrelated full-repository lint errors are not part of this change.

- [ ] **Step 2: Review the diff for scope.**

Confirm the diff contains only control placement classes, card positioning context/bottom spacing, the matching test assertions, and no button style, icon, label, state, or drag logic changes.

- [ ] **Step 3: Commit the implementation.**

```bash
git add apps/frontend/src/components/Demiurge/WorkflowCard.tsx apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
git commit -m "fix: move workflow card navigation to bottom right"
```
