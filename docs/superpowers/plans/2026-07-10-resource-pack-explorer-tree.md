# Resource Pack Explorer Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a virtualized Finder-style Pack explorer that keeps folders non-selectable and files previewable.

**Architecture:** A dedicated adapter converts Pack folders and elements into a nested `ExplorerNode` tree. A dedicated `ResourcePackExplorer` renders those nodes with `react-arborist`; `ResourceLibraryView` only passes data and receives selected files.

**Tech Stack:** React, TypeScript, react-arborist, Vitest, Testing Library, Tailwind CSS.

---

### Task 1: Add the virtual tree dependency

**Files:**
- Modify: `apps/frontend/package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Add `react-arborist` to frontend dependencies**

```json
"dependencies": {
  "react-arborist": "^3.4.3"
}
```

- [ ] **Step 2: Install and verify dependency resolution**

Run: `bun install`

Expected: lockfile changes and `apps/frontend/node_modules/react-arborist` resolves.

- [ ] **Step 3: Commit dependency change**

```bash
git add apps/frontend/package.json bun.lock
git commit -m "chore: add virtual resource explorer dependency"
```

### Task 2: Build the explorer data adapter

**Files:**
- Create: `apps/frontend/src/components/ResourceLibrary/resourcePackExplorerTree.ts`
- Create: `apps/frontend/src/components/ResourceLibrary/resourcePackExplorerTree.test.ts`

- [ ] **Step 1: Write failing placement tests**

```ts
expect(buildExplorerTree(pack, folders, elements)).toEqual(expect.objectContaining({
  id: 'root',
  kind: 'folder',
  children: expect.arrayContaining([
    expect.objectContaining({ id: 'folder:parent' }),
    expect.objectContaining({ id: 'category:models' }),
  ]),
}))
```

- [ ] **Step 2: Run adapter tests to verify failure**

Run: `npm --prefix apps/frontend run test:run -- resourcePackExplorerTree`

Expected: FAIL because the adapter module does not exist.

- [ ] **Step 3: Implement direct-child tree construction**

```ts
export type ExplorerNode = {
  id: string
  kind: 'folder' | 'file'
  name: string
  element?: ResourceElement
  children?: ExplorerNode[]
}

export function buildExplorerTree(pack: ResourcePackSummary, folders: ResourceFolder[], elements: ResourceElement[]): ExplorerNode {
  // create persisted folders by parentId, insert derived category folders,
  // then attach each element only to parentPath(element.path)
}
```

- [ ] **Step 4: Run adapter tests to verify pass**

Run: `npm --prefix apps/frontend run test:run -- resourcePackExplorerTree`

Expected: PASS.

- [ ] **Step 5: Commit adapter and tests**

```bash
git add apps/frontend/src/components/ResourceLibrary/resourcePackExplorerTree.ts apps/frontend/src/components/ResourceLibrary/resourcePackExplorerTree.test.ts
git commit -m "feat: derive resource Pack explorer tree"
```

### Task 3: Render the virtualized explorer

**Files:**
- Create: `apps/frontend/src/components/ResourceLibrary/ResourcePackExplorer.tsx`
- Create: `apps/frontend/src/components/ResourceLibrary/ResourcePackExplorer.test.tsx`

- [ ] **Step 1: Write failing accessibility and selection tests**

```tsx
render(<ResourcePackExplorer tree={tree} selectedElementId={undefined} onElement={onElement} />)
await user.click(screen.getByRole('treeitem', { name: 'Models' }))
expect(onElement).not.toHaveBeenCalled()
await user.click(screen.getByRole('treeitem', { name: 'knight.glb' }))
expect(onElement).toHaveBeenCalledWith(element)
```

- [ ] **Step 2: Run component test to verify failure**

Run: `npm --prefix apps/frontend run test:run -- ResourcePackExplorer`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement custom Arborist node renderer**

```tsx
<Tree data={[tree]} width={236} height={height} rowHeight={30} indent={18} openByDefault={false}>
  {({ node, style }) => (
    <ExplorerRow node={node} style={style} onElement={onElement} selectedElementId={selectedElementId} />
  )}
</Tree>
```

`ExplorerRow` toggles only folder nodes, calls `onElement` only for files, and
renders the 30px dark Finder-style rows, guide line, disclosure chevron, and
muted orange selected-file fill defined in the design specification.

- [ ] **Step 4: Run component tests to verify pass**

Run: `npm --prefix apps/frontend run test:run -- ResourcePackExplorer`

Expected: PASS.

- [ ] **Step 5: Commit explorer component and tests**

```bash
git add apps/frontend/src/components/ResourceLibrary/ResourcePackExplorer.tsx apps/frontend/src/components/ResourceLibrary/ResourcePackExplorer.test.tsx
git commit -m "feat: render virtual resource Pack explorer"
```

### Task 4: Integrate the explorer into the Pack workspace

**Files:**
- Modify: `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx`
- Modify: `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx`

- [ ] **Step 1: Write failing workspace regression test**

```tsx
expect(screen.getByRole('tree')).toBeInTheDocument()
expect(screen.getByRole('treeitem', { name: 'Parent' })).toBeInTheDocument()
expect(screen.queryByRole('treeitem', { name: 'Nested' })).not.toBeInTheDocument()
```

- [ ] **Step 2: Run workspace regression test to verify failure**

Run: `npm --prefix apps/frontend run test:run -- ResourceLibraryView`

Expected: FAIL because the old recursive explorer has no tree role.

- [ ] **Step 3: Replace recursive rows with `ResourcePackExplorer`**

```tsx
<ResourcePackExplorer
  pack={pack}
  folders={folders}
  elements={elements}
  selectedElementId={selectedElement?.id}
  onElement={onElement}
/>
```

Remove `FolderTreeNode`, `TreeRow`, direct category expansion state, and their
related imports after the new explorer is integrated.

- [ ] **Step 4: Run workspace test to verify pass**

Run: `npm --prefix apps/frontend run test:run -- ResourceLibraryView`

Expected: PASS.

- [ ] **Step 5: Run frontend build and commit**

Run: `npm --prefix apps/frontend run build -- --mode test`

Expected: TypeScript and Vite build PASS.

```bash
git add apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx
git commit -m "feat: integrate virtual Pack explorer"
```
