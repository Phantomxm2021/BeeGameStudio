# Create Pack Dialog Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Create Pack dialog metadata-first and visually tighter without changing its data contract, controls, modal size, or Tag dimensions.

**Architecture:** Keep `CreateResourcePackDialog` as one component. Replace only its name-plus-metadata layout with a responsive three-column metadata group; retain the existing header, native selects, Tag groups, custom-value rows, footer, and submission behavior.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest, Testing Library.

---

## File structure

- Modify `apps/frontend/src/components/ResourceLibrary/CreateResourcePackDialog.tsx` — move the name input into the metadata group and add the responsive grid class.
- Modify `apps/frontend/src/components/ResourceLibrary/CreateResourcePackDialog.test.tsx` — assert the grouped layout marker while retaining submission behavior coverage.

### Task 1: Implement the metadata-first dialog layout

**Files:**
- Modify: `apps/frontend/src/components/ResourceLibrary/CreateResourcePackDialog.tsx`
- Test: `apps/frontend/src/components/ResourceLibrary/CreateResourcePackDialog.test.tsx`

- [ ] **Step 1: Write the failing layout regression test**

Render the dialog and assert that the name input, dimension select, and primary
category select share the new metadata-group test id:

```tsx
render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={vi.fn()} />)

const metadataGroup = screen.getByTestId('create-pack-metadata')
expect(metadataGroup).toContainElement(screen.getByPlaceholderText('例如：Painterly Forest'))
expect(metadataGroup).toContainElement(screen.getByLabelText('维度'))
expect(metadataGroup).toContainElement(screen.getByLabelText('主分类'))
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm --prefix apps/frontend run test:run -- src/components/ResourceLibrary/CreateResourcePackDialog.test.tsx`

Expected: FAIL because `create-pack-metadata` does not exist.

- [ ] **Step 3: Replace the two old metadata blocks with one responsive group**

Use the following shape immediately after the dialog header:

```tsx
<div
  data-testid="create-pack-metadata"
  className="grid gap-4 border-b border-white/10 pb-5 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)_minmax(0,0.85fr)]"
>
  <label className="type-callout grid gap-2 text-zinc-300">
    名称
    <input className="glass-control type-input h-11 rounded-xl px-3" />
  </label>
  <label className="type-callout grid gap-2 text-zinc-300">
    维度
    <select className="glass-control type-input h-11 rounded-xl px-3" />
  </label>
  <label className="type-callout grid gap-2 text-zinc-300">
    主分类
    <select className="glass-control type-input h-11 rounded-xl px-3" />
  </label>
</div>
```

Keep each existing control's value, onChange, options, and test-visible label.
Do not change the form `max-w-lg`, modal scrolling behavior, Tag `px-3 py-1.5`,
input/select `h-11`, custom-row `h-10`, or footer button `h-10` classes.

- [ ] **Step 4: Run component tests**

Run: `npm --prefix apps/frontend run test:run -- src/components/ResourceLibrary/CreateResourcePackDialog.test.tsx`

Expected: PASS, including existing required-field and `primaryCategory` payload tests.

- [ ] **Step 5: Build the frontend**

Run: `npm --prefix apps/frontend run build -- --mode test`

Expected: TypeScript and Vite build succeed. Existing chunk-size warnings are
non-blocking if there is no new type or build error.

- [ ] **Step 6: Commit the layout change**

```bash
git add apps/frontend/src/components/ResourceLibrary/CreateResourcePackDialog.tsx apps/frontend/src/components/ResourceLibrary/CreateResourcePackDialog.test.tsx
git commit -m "style: prioritize Pack metadata in create dialog"
```
