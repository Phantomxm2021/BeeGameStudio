# Resource Curation Tab Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Make the `资源整理` tab a focused manual-review surface with no duplicated AI controls or non-actionable summary cards.

**Architecture:** Keep the existing durable curation queue and mutation API unchanged. The `资源整理` tab will render only pending suggestions, tag selection, selected-count context, and the two opposing manual decisions; AI start/progress/retry remains exclusively in `AI 处理`.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Bun.

---

### Task 1: Remove redundant resource-tab controls

**Files:**
- Modify: `apps/frontend/src/components/ResourceLibrary/CurationWorkbench.tsx`
- Test: `apps/frontend/src/components/ResourceLibrary/CurationWorkbench.test.tsx`

- [ ] **Step 1: Write the failing UI assertions**

Extend the existing curation-tab test to assert that the resource tab does not render `AI 整理用途`, `待整理`, `缺少用途标签`, `技术问题`, `依赖问题`, or the explanatory footer text. Keep assertions that `系统建议`, `已选 2 / 2`, `拒绝建议`, and `批量确认` remain visible.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
bunx vitest run src/components/ResourceLibrary/CurationWorkbench.test.tsx --reporter=dot
```

Expected: the test fails because the current resource tab still renders the summary cards, AI start button, and footer explanation.

- [ ] **Step 3: Implement the minimal render change**

In the `activeTab === 'curation'` branch, remove the summary-card block, the `AI 整理用途` button, and the footer explanation span. Keep the queue list, `系统建议`, selected count, usage-tag chips, `拒绝建议`, and `批量确认`. Do not remove `startSemanticCuration`, the AI tab, or any API method.

- [ ] **Step 4: Run focused tests and the frontend build**

Run:

```bash
bunx vitest run src/services/resourceLibraryApi.test.ts src/components/ResourceLibrary/CurationWorkbench.test.tsx --reporter=dot
bun run --cwd apps/frontend build
```

Expected: all affected tests pass and the production frontend build exits successfully.

- [ ] **Step 5: Audit the diff**

Run:

```bash
git diff --check
```

Confirm the diff only changes the resource curation tab rendering and its UI test, with no changes to the durable job, billing, resource API, or example projects.
