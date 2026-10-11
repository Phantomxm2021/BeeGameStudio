# Resource Library Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render all static frontend Resource Library copy using the active application language.

**Architecture:** Keep `resourceLibrary` as the namespace for every Resource Library string. Components translate labels at render time, preserving stored enum values and authored resource data. All ten locale JSON files provide the same key tree, with English fallback configured by i18next.

**Tech Stack:** React 19, TypeScript, react-i18next, Bun tests.

**Spec:** `docs/superpowers/specs/2026-08-22-resource-library-localization-design.md`

## Global Constraints

- Do not localize resource data, filenames, paths, user-entered values, or backend-originated errors.
- Support exactly `en`, `zh`, `zh-TW`, `ja`, `ko`, `fr`, `de`, `es`, `it`, and `pt`.
- Do not change persisted enum values or API contracts.

---

### Task 1: Establish the Resource Library translation contract

**Files:** `apps/frontend/src/i18n/locales/{en,zh,zh-TW,ja,ko,fr,de,es,it,pt}.json`; test `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx`.

- [ ] Write a failing language-switch test asserting one Resource Library control resolves in English and Simplified Chinese.
- [ ] Run `bun test apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx` and verify failure from literal UI copy.
- [ ] Add matching grouped keys for shared controls, curation, explorer, preview, inspector, bulk edit, and model preview in every locale file; use `{{count}}` and `{{index}}` for dynamic labels.
- [ ] Re-run the test and confirm it still fails at component behavior until Task 2 migrates rendering.

### Task 2: Migrate dialogs, curation, explorer, and preview copy

**Files:** `apps/frontend/src/components/ResourceLibrary/{CreateResourcePackDialog,EditResourcePackDialog,ResourcePackFormDialog,RenameResourceDialog,CurationWorkbench,ResourcePackExplorer,ResourcePreview}.tsx`; delete `useResourceLibraryText.ts`; test `CurationWorkbench.test.tsx` and `ResourcePackExplorer.test.tsx`.

- [ ] Write failing tests that render curation and explorer under a non-default locale and assert translated dialog, tab, and menu labels.
- [ ] Run `bun test apps/frontend/src/components/ResourceLibrary/CurationWorkbench.test.tsx apps/frontend/src/components/ResourceLibrary/ResourcePackExplorer.test.tsx` and verify literal-label failures.
- [ ] Replace static labels, buttons, placeholders, tooltips, ARIA attributes, operation states, and frontend validation strings with namespace lookups; leave raw failure values and authored values unchanged.
- [ ] Re-run the two tests and confirm PASS.

### Task 3: Migrate the main view, inspectors, and model preview

**Files:** `apps/frontend/src/components/ResourceLibrary/{ResourceLibraryView,ModelPreview}.tsx`, `apps/frontend/src/App.tsx`; tests `ResourceLibraryView.test.tsx` and `ResourcePreview.test.tsx`.

- [ ] Write failing tests for a translated filter label, inspector label, and loading ARIA label.
- [ ] Run `bun test apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx apps/frontend/src/components/ResourceLibrary/ResourcePreview.test.tsx` and verify failure from literal text.
- [ ] Translate static copy in the list, filters, inspectors, bulk editor, relations, texture bindings, model preview, media fallback, and ARIA/title attributes; retain dynamic resource values unchanged.
- [ ] Re-run targeted tests and confirm PASS.

### Task 4: Validate coverage and frontend integrity

- [ ] Scan for residual static user-facing copy with `rg -n --glob '*.{ts,tsx}' 'aria-label=|title=|placeholder=|>[[:space:]]*[^<{]+<' apps/frontend/src/components/ResourceLibrary`.
- [ ] Run `bun test apps/frontend/src/components/ResourceLibrary` and confirm PASS.
- [ ] Run `bun run typecheck` and confirm PASS.
- [ ] Review `git diff -- apps/frontend/src/App.tsx apps/frontend/src/components/ResourceLibrary apps/frontend/src/i18n/locales` and confirm it is scoped to this localization migration.
