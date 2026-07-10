# Resource Pack Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an administrator Pack workspace with real Pack deletion and cover upload, a fixed file explorer/preview layout, format-specific previews, and an on-demand editable Info inspector.

**Architecture:** Resource-service routes own all Supabase Storage mutations and return signed element URLs. The frontend keeps Pack navigation and inspector state locally, while preview renderers receive one signed URL and read only declared `specs`; model metrics are calculated from parsed geometry and saved through the existing element update route. The workspace is viewport-bound; only the explorer scrolls.

**Tech Stack:** TypeScript, Bun, Supabase REST/Storage, React, Vitest, Tailwind, Three.js loaders for GLB/GLTF/OBJ/FBX.

---

## File structure

- Modify `packages/beegame-resource-core/src/repository.ts` — add Pack deletion capability to the repository contract and in-memory implementation.
- Modify `packages/beegame-resource-server/src/app.ts` — add DELETE Pack, cover upload, and signed element URL routes.
- Modify `packages/beegame-resource-server/src/index.ts` — implement Supabase Storage cover replacement, prefix cleanup, safe Pack update mapping, signed URL, and upload specs.
- Modify `packages/beegame-resource-server/src/__tests__/app.test.ts` — verify authorization, delete, cover, and element URL routes.
- Modify `packages/beegame-resource-server/src/__tests__/authoring-routes.test.ts` — verify constrained Pack update payloads.
- Modify `apps/frontend/package.json` — add `three` and its type package.
- Modify `apps/frontend/src/services/resourceLibraryApi.ts` and its test — expose delete, cover upload, resource URL, extended Pack updates, and element URL/spec fields.
- Create `apps/frontend/src/components/ResourceLibrary/ResourcePreview.tsx` — choose safe renderer by MIME/extension.
- Create `apps/frontend/src/components/ResourceLibrary/ModelPreview.tsx` — load GLB/GLTF/OBJ/FBX with Three.js and report serializable metrics.
- Create `apps/frontend/src/components/ResourceLibrary/EditResourcePackDialog.tsx` — edit full Pack metadata, cover, and typed-delete danger zone.
- Modify `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx` — fixed workspace, explorer-only scroll, folder expand state, empty state, toolbar, Info toggle, and edit/delete actions.
- Modify `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx` — workspace interaction and layout regressions.

### Task 1: Add Pack deletion to the core repository

**Files:**
- Modify: `packages/beegame-resource-core/src/repository.ts`
- Test: `packages/beegame-resource-core/src/__tests__/repository.test.ts`

- [ ] **Step 1: Add failing delete tests**

```ts
test('deletes a Pack with its elements and folders', async () => {
  const repository = createInMemoryResourceRepository({ packs: [pack], elements: [element] })
  await repository.createFolder('pack-1', { id: 'folder-1', name: 'models' })
  await expect(repository.deletePack('pack-1')).resolves.toBe(true)
  await expect(repository.getPack('pack-1')).resolves.toBeUndefined()
  await expect(repository.listElements('pack-1')).resolves.toEqual([])
  await expect(repository.listFolders('pack-1')).resolves.toEqual([])
})

test('treats an already deleted Pack as absent', async () => {
  const repository = createInMemoryResourceRepository({ packs: [], elements: [] })
  await expect(repository.deletePack('missing')).resolves.toBe(false)
})
```

- [ ] **Step 2: Run the failing tests**

Run: `conda run -n xrmoddemiurge bun test packages/beegame-resource-core/src/__tests__/repository.test.ts`

Expected: FAIL because `deletePack` is missing.

- [ ] **Step 3: Add the repository method and in-memory cleanup**

```ts
export type ResourceRepository = {
  // existing members
  deletePack(packId: string): Promise<boolean>
}

async deletePack(packId) {
  const index = packs.findIndex(item => item.id === packId)
  if (index < 0) return false
  packs.splice(index, 1)
  for (let cursor = elements.length - 1; cursor >= 0; cursor -= 1) {
    if (elements[cursor].packId === packId) elements.splice(cursor, 1)
  }
  for (let cursor = folders.length - 1; cursor >= 0; cursor -= 1) {
    if (folders[cursor].packId === packId) folders.splice(cursor, 1)
  }
  return true
}
```

- [ ] **Step 4: Run the repository test**

Run: `conda run -n xrmoddemiurge bun test packages/beegame-resource-core/src/__tests__/repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/beegame-resource-core/src/repository.ts packages/beegame-resource-core/src/__tests__/repository.test.ts
git commit -m "feat: delete resource Packs from repository"
```

### Task 2: Add administrator storage lifecycle routes

**Files:**
- Modify: `packages/beegame-resource-server/src/app.ts`
- Modify: `packages/beegame-resource-server/src/index.ts`
- Test: `packages/beegame-resource-server/src/__tests__/app.test.ts`

- [ ] **Step 1: Add failing route tests**

```ts
test('deletes an administrator Pack through the DELETE route', async () => {
  const deleted: string[] = []
  const app = createBeeGameResourceServerApp({
    repository,
    currentUser: admin,
    deleteResourcePack: async id => { deleted.push(id); return true },
  })
  const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1', { method: 'DELETE' }))
  expect(response.status).toBe(204)
  expect(deleted).toEqual(['pack-1'])
})

test('uploads a supported cover and rejects an unsupported one', async () => {
  const app = createBeeGameResourceServerApp({ repository, currentUser: admin, uploadPackCover: async () => ({ ...pack, coverPath: 'cover/new.png' }) })
  const good = new FormData(); good.set('file', new File(['x'], 'cover.png', { type: 'image/png' }))
  expect((await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/cover', { method: 'POST', body: good }))).status).toBe(200)
  const bad = new FormData(); bad.set('file', new File(['x'], 'cover.exe'))
  expect((await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/cover', { method: 'POST', body: bad }))).status).toBe(400)
})
```

- [ ] **Step 2: Run route tests and verify failure**

Run: `conda run -n xrmoddemiurge bun test packages/beegame-resource-server/src/__tests__/app.test.ts`

Expected: FAIL with 404 because the routes/options do not exist.

- [ ] **Step 3: Add explicit route options and validation**

```ts
deleteResourcePack?: (packId: string) => Promise<boolean>
uploadPackCover?: (packId: string, request: Request) => Promise<ResourcePack>
getElementResourceUrl?: (packId: string, elementId: string) => Promise<string>
```

Implement the routes before generic `patchMatch` handling:

```ts
if (request.method === 'DELETE' && patchMatch) {
  if (!options.deleteResourcePack) return corsResponse(jsonError(503, 'not_configured', 'Resource deletion is not configured'), options.corsOrigin)
  await options.deleteResourcePack(decodeURIComponent(patchMatch[1]))
  return corsResponse(new Response(null, { status: 204 }), options.corsOrigin)
}
```

For cover uploads, parse one `file`, allow only `jpg`, `jpeg`, `png`, `webp`,
`gif`, `mp4`, `webm`, and return `{ pack }`. Add
`GET /api/resource-packs/:packId/elements/:elementId/resource-url` returning
`{ url }` only after the repository confirms that element belongs to the Pack.

- [ ] **Step 4: Implement configured Supabase mutations**

In `index.ts`, list Storage object names below `${packId}/` through
`/storage/v1/object/list/beegame-resource-packs`, delete each listed object,
then delete the Pack row; the foreign key cascade deletes element/folder rows.
Treat a zero-row DELETE as success.

For cover replacement: upload to `${packId}/cover/${crypto.randomUUID()}-${file.name}`;
PATCH `cover_path`; only after the database response succeeds delete the old
cover object. If PATCH fails delete the newly uploaded cover object.

Sign an element resource with the existing Storage signed URL helper after
looking up `pack_id` and `path` through Supabase.

For element upload, persist:

```ts
specs: {
  size: file.size,
  mimeType: file.type || 'application/octet-stream',
  extension: extensionFromName(file.name),
}
```

Infer kind as `model`, `audio`, `video`, `font`, `document`, or `image` from
extension/MIME; retain the supplied element category.

- [ ] **Step 5: Run resource server tests**

Run: `conda run -n xrmoddemiurge bun test packages/beegame-resource-server/src/__tests__`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/beegame-resource-server/src/app.ts packages/beegame-resource-server/src/index.ts packages/beegame-resource-server/src/__tests__/app.test.ts
git commit -m "feat: manage Pack covers and deletion"
```

### Task 3: Extend the frontend resource client

**Files:**
- Modify: `apps/frontend/src/services/resourceLibraryApi.ts`
- Test: `apps/frontend/src/services/resourceLibraryApi.test.ts`

- [ ] **Step 1: Add failing API-client tests**

```ts
await api.deletePack('pack-1')
expect(requests.at(-1)?.url).toContain('/api/resource-packs/pack-1')
expect(requests.at(-1)?.method).toBe('DELETE')

await api.uploadPackCover('pack-1', new File(['cover'], 'cover.png', { type: 'image/png' }))
expect(requests.at(-1)?.url).toContain('/api/resource-packs/pack-1/cover')

await expect(api.getElementResourceUrl('pack-1', 'element-1')).resolves.toBe('https://signed.example/file')
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm --prefix apps/frontend run test:run -- src/services/resourceLibraryApi.test.ts`

Expected: FAIL because the methods do not exist.

- [ ] **Step 3: Add client methods**

```ts
async deletePack(packId: string): Promise<void> { /* DELETE and throw API error on non-204 */ }
async uploadPackCover(packId: string, file: File): Promise<ResourcePackSummary> { /* multipart POST */ }
async getElementResourceUrl(packId: string, elementId: string): Promise<string> { /* GET { url } */ }
```

Extend `ResourceElement.specs` value typing to support nullable metadata only
through known `string | number | boolean`, and do not expose storage credentials.

- [ ] **Step 4: Run frontend API tests**

Run: `npm --prefix apps/frontend run test:run -- src/services/resourceLibraryApi.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/services/resourceLibraryApi.ts apps/frontend/src/services/resourceLibraryApi.test.ts
git commit -m "feat: expose Pack lifecycle resource APIs"
```

### Task 4: Build safe format-specific preview renderers

**Files:**
- Modify: `apps/frontend/package.json`
- Create: `apps/frontend/src/components/ResourceLibrary/ResourcePreview.tsx`
- Create: `apps/frontend/src/components/ResourceLibrary/ModelPreview.tsx`
- Create: `apps/frontend/src/components/ResourceLibrary/ResourcePreview.test.tsx`

- [ ] **Step 1: Add renderer-selection tests**

```tsx
expect(renderPreview({ name: 'image.png', kind: 'image' })).toBe('image')
expect(renderPreview({ name: 'sound.ogg', kind: 'audio' })).toBe('audio')
expect(renderPreview({ name: 'world.glb', kind: 'model' })).toBe('model')
expect(renderPreview({ name: 'manual.pdf', kind: 'document' })).toBe('pdf')
expect(renderPreview({ name: 'office.docx', kind: 'document' })).toBe('document-card')
```

- [ ] **Step 2: Run the preview test and verify failure**

Run: `npm --prefix apps/frontend run test:run -- src/components/ResourceLibrary/ResourcePreview.test.tsx`

Expected: FAIL because the renderer selection module does not exist.

- [ ] **Step 3: Install and implement renderers**

Add `three` and `@types/three` to the frontend dependencies. Implement
`ResourcePreview` with a signed URL state and these safe branches:

```tsx
if (kind === 'image') return <img src={url} alt={element.name} className="max-h-full max-w-full object-contain" />
if (kind === 'audio') return <audio controls src={url} />
if (kind === 'video') return <video controls src={url} className="max-h-full max-w-full" />
if (kind === 'font') return <FontPreview url={url} element={element} />
if (kind === 'pdf') return <iframe title={element.name} src={url} sandbox="allow-same-origin" />
if (kind === 'text') return <SafeTextPreview url={url} />
if (kind === 'model') return <ModelPreview url={url} extension={extension} onMetrics={onMetrics} />
return <DocumentCard element={element} url={url} />
```

`ModelPreview` uses `GLTFLoader`, `FBXLoader`, and `OBJLoader` with
`OrbitControls`; it disposes geometries/materials/textures on unmount. Traverse
loaded meshes to calculate `triangles`, `vertices`, `materialCount`, and
`bounds`; call `onMetrics` only with serializable number values. Never execute
document HTML or embed arbitrary Office binaries.

- [ ] **Step 4: Run renderer tests**

Run: `npm --prefix apps/frontend run test:run -- src/components/ResourceLibrary/ResourcePreview.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/package.json apps/frontend/src/components/ResourceLibrary/ResourcePreview.tsx apps/frontend/src/components/ResourceLibrary/ModelPreview.tsx apps/frontend/src/components/ResourceLibrary/ResourcePreview.test.tsx
git commit -m "feat: preview resource files by format"
```

### Task 5: Add Pack editing, cover upload, and typed deletion UI

**Files:**
- Create: `apps/frontend/src/components/ResourceLibrary/EditResourcePackDialog.tsx`
- Modify: `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx`
- Test: `apps/frontend/src/components/ResourceLibrary/EditResourcePackDialog.test.tsx`

- [ ] **Step 1: Write dialog tests**

```tsx
render(<EditResourcePackDialog open pack={pack} onSave={onSave} onDelete={onDelete} onClose={vi.fn()} />)
await user.clear(screen.getByLabelText('名称'))
await user.type(screen.getByLabelText('名称'), 'Renamed')
await user.selectOptions(screen.getByLabelText('主分类'), 'ui-kit')
await user.click(screen.getByRole('button', { name: '保存 Pack 设置' }))
expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed', primaryCategory: 'ui-kit' }))

await user.click(screen.getByRole('button', { name: '删除 Pack' }))
await user.type(screen.getByLabelText('确认 Pack 名称'), pack.name)
await user.click(screen.getByRole('button', { name: '确认删除' }))
expect(onDelete).toHaveBeenCalledWith()
```

- [ ] **Step 2: Run the dialog test and verify failure**

Run: `npm --prefix apps/frontend run test:run -- src/components/ResourceLibrary/EditResourcePackDialog.test.tsx`

Expected: FAIL because the dialog does not exist.

- [ ] **Step 3: Implement the dialog and view wiring**

Reuse Create Pack control styles and primary-category options. The edit dialog
accepts a selected cover file, uploads it first through `uploadPackCover`, then
saves text metadata through `updatePack`. It has an inline error region and a
danger zone that disables confirmation until the typed name exactly matches.

In the workspace toolbar render:

```tsx
<div className="secondary-button-group">
  <button onClick={openEdit}>编辑 Pack</button>
  <button onClick={publish}>发布</button>
</div>
<label className="primary-pill">＋ 添加文件<input type="file" multiple /></label>
```

After deletion, remove the Pack from `packs`, clear selection, close the route,
and return to the Pack list.

- [ ] **Step 4: Run dialog and view tests**

Run: `npm --prefix apps/frontend run test:run -- src/components/ResourceLibrary/EditResourcePackDialog.test.tsx src/components/ResourceLibrary/ResourceLibraryView.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/ResourceLibrary/EditResourcePackDialog.tsx apps/frontend/src/components/ResourceLibrary/EditResourcePackDialog.test.tsx apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx
git commit -m "feat: edit and delete resource Packs"
```

### Task 6: Convert the Pack browser to the fixed workspace

**Files:**
- Modify: `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx`
- Test: `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx`

- [ ] **Step 1: Add failing workspace interaction tests**

```tsx
await user.click(screen.getByRole('button', { name: '模型' }))
expect(screen.getByText('尚未选择文件')).toBeInTheDocument()
expect(screen.queryByRole('complementary', { name: '元素属性' })).not.toBeInTheDocument()

await user.click(screen.getByRole('button', { name: '文件 Character Idle' }))
expect(screen.queryByText('尚未选择文件')).not.toBeInTheDocument()
expect(screen.getByRole('button', { name: '显示元素信息' })).toBeInTheDocument()
await user.click(screen.getByRole('button', { name: '显示元素信息' }))
expect(screen.getByRole('complementary', { name: '元素属性' })).toBeInTheDocument()
expect(screen.queryByRole('button', { name: '显示元素信息' })).not.toBeInTheDocument()
```

Add assertions that the workspace root uses `h-[calc(100vh-...)] overflow-hidden`,
the explorer has `overflow-y-auto`, and the stage does not render grid/list
buttons or a breadcrumb/folder label.

- [ ] **Step 2: Run the workspace test and verify failure**

Run: `npm --prefix apps/frontend run test:run -- src/components/ResourceLibrary/ResourceLibraryView.test.tsx`

Expected: FAIL because folders select assets, inspector is always visible, and
the old preview toolbar remains.

- [ ] **Step 3: Implement fixed explorer, empty state, overlays, and inspector**

Keep expanded folder paths in `Set<string>`. Folder and Pack root controls only
toggle membership in that set. File controls call `onElement`.

Use a fixed root and split layout:

```tsx
<section className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col overflow-hidden bg-zinc-950">
  <header className="shrink-0">{/* toolbar */}</header>
  <div className="grid min-h-0 flex-1 grid-cols-[236px_minmax(0,1fr)]">
    <aside className="min-h-0 overflow-y-auto border-r border-white/10">{/* explorer */}</aside>
    <main className="min-h-0 overflow-hidden p-4">{/* preview stage */}</main>
  </div>
</section>
```

Render an empty state until a file is selected. When selected, render
`ResourcePreview`, a top-left one-field-per-line `FileInfoOverlay`, and a
top-right Info button. `ResourceInspectorOverlay` opens only after the button
is clicked, closes with its close button, and exposes `保存更改`.

The stage Info overlay uses filename, extension, size, and model triangle count
from `specs`; each value is its own line. Persist new model metrics with
`updateElement` only when the value differs from stored specs.

- [ ] **Step 4: Run the workspace test**

Run: `npm --prefix apps/frontend run test:run -- src/components/ResourceLibrary/ResourceLibraryView.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx
git commit -m "feat: build fixed resource Pack workspace"
```

### Task 7: Verify the complete workspace

**Files:**
- No source changes expected.

- [ ] **Step 1: Run core and resource-service tests**

Run: `conda run -n xrmoddemiurge bun test packages/beegame-resource-core/src/__tests__ packages/beegame-resource-server/src/__tests__`

Expected: PASS.

- [ ] **Step 2: Run focused frontend tests**

Run: `npm --prefix apps/frontend run test:run -- src/services/resourceLibraryApi.test.ts src/components/ResourceLibrary/ResourcePreview.test.tsx src/components/ResourceLibrary/EditResourcePackDialog.test.tsx src/components/ResourceLibrary/ResourceLibraryView.test.tsx`

Expected: PASS.

- [ ] **Step 3: Build the frontend**

Run: `npm --prefix apps/frontend run build -- --mode test`

Expected: TypeScript and Vite build succeed without new errors.

- [ ] **Step 4: Inspect the final change set**

Run: `git diff --check HEAD~6..HEAD`

Expected: no whitespace errors.
