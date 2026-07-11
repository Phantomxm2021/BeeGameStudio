# Resource Pack Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate a Pack's primary category from the concrete element types it contains, then expose the corrected Pack-category select in resource authoring.

**Architecture:** Add a required `primaryCategory` field to the Pack contract and Supabase row, while keeping `categories` as a required, derived list of contained element categories that may be empty before upload. The create dialog writes only `primaryCategory`; element upload/import continues to classify individual files through `ResourceCategory` and `kind`. Existing Pack rows migrate to `mixed` and legacy category values remain readable.

**Tech Stack:** TypeScript, Bun tests, React, Vite, Supabase REST/Postgres schema.

---

## File structure

- Modify `packages/beegame-resource-core/src/types.ts` — define the Pack-only primary-category enum and field.
- Modify `packages/beegame-resource-core/src/validation.ts` — validate the required Pack primary category.
- Modify `packages/beegame-resource-core/src/__tests__/validation.test.ts` — lock in valid and invalid primary-category behavior.
- Modify `docs/beegame-supabase-schema.sql` — make clean installs include `primary_category`.
- Create `docs/beegame-resource-pack-primary-category-migration.sql` — migrate existing Supabase data safely.
- Modify `packages/beegame-resource-server/src/supabase-resource-repository.ts` — read/write `primary_category`.
- Modify `packages/beegame-resource-server/src/import-resource-pack.ts` — derive/import a Pack primary category without treating it as an element category.
- Modify `packages/beegame-resource-server/src/app.ts` — accept `primaryCategory` on Pack creation.
- Modify `packages/beegame-resource-server/src/__tests__/authoring-routes.test.ts` and `packages/beegame-resource-server/src/__tests__/supabase-resource-repository.test.ts` — verify API and repository mappings.
- Modify `apps/frontend/src/services/resourceLibraryApi.ts` — transport `primaryCategory` independently.
- Modify `apps/frontend/src/components/ResourceLibrary/CreateResourcePackDialog.tsx` — preserve the native select and use Pack-category values.
- Modify `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx` — show Pack category separately from element-category navigation.
- Modify `apps/frontend/src/components/ResourceLibrary/CreateResourcePackDialog.test.tsx` and `apps/frontend/src/services/resourceLibraryApi.test.ts` — cover payload and form behavior.

### Task 1: Define and validate Pack primary categories

**Files:**
- Modify: `packages/beegame-resource-core/src/types.ts`
- Modify: `packages/beegame-resource-core/src/validation.ts`
- Test: `packages/beegame-resource-core/src/__tests__/validation.test.ts`

- [ ] **Step 1: Write failing Pack-primary-category tests**

```ts
const validPack = {
  id: 'pack-1', name: 'Example Pack', style: 'Stylized',
  primaryCategory: 'ui-kit' as const, gameTypes: ['adventure'],
  dimension: '2D' as const, categories: ['ui'] as const,
  license: 'internal', version: '1.0.0', status: 'published' as const,
}

test('rejects an unsupported Pack primary category', () => {
  expect(() => validateResourcePack({ ...validPack, primaryCategory: 'characters' }))
    .toThrow(ResourceValidationError)
})

test('rejects a Pack without a primary category', () => {
  const { primaryCategory: _, ...packWithoutPrimaryCategory } = validPack
  expect(() => validateResourcePack(packWithoutPrimaryCategory)).toThrow(ResourceValidationError)
})
```

- [ ] **Step 2: Run the new tests and verify failure**

Run: `bun test packages/beegame-resource-core/src/__tests__/validation.test.ts`

Expected: FAIL because `primaryCategory` is not defined or validated.

- [ ] **Step 3: Add the Pack-only enum and contract field**

```ts
export const RESOURCE_PACK_PRIMARY_CATEGORIES = [
  '2d-art', '3d-assets', 'animation-rig', 'ui-kit', 'vfx',
  'audio', 'fonts', 'world-scene', 'mixed',
] as const
export type ResourcePackPrimaryCategory =
  (typeof RESOURCE_PACK_PRIMARY_CATEGORIES)[number]

export type ResourcePack = {
  id: string
  name: string
  style: string
  primaryCategory: ResourcePackPrimaryCategory
  gameTypes: readonly string[]
  dimension: ResourceDimension
  categories: readonly ResourceCategory[]
  license: string
  version: string
  status: ResourcePackStatus
  coverPath?: string
}
```

In `validateResourcePack`, add:

```ts
if (!isAllowed(value.primaryCategory, RESOURCE_PACK_PRIMARY_CATEGORIES)) {
  throw new ResourceValidationError('Pack primary category is unsupported')
}
```

Do not add Pack primary categories to `RESOURCE_CATEGORIES`; that list remains
strictly element-level.

- [ ] **Step 4: Run core validation tests**

Run: `bun test packages/beegame-resource-core/src/__tests__/validation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the domain contract**

```bash
git add packages/beegame-resource-core/src/types.ts packages/beegame-resource-core/src/validation.ts packages/beegame-resource-core/src/__tests__/validation.test.ts
git commit -m "feat: add Pack primary category contract"
```

### Task 2: Add the safe Supabase schema migration

**Files:**
- Modify: `docs/beegame-supabase-schema.sql`
- Create: `docs/beegame-resource-pack-primary-category-migration.sql`

- [ ] **Step 1: Add the column to the clean-install schema**

Place the field after `style`:

```sql
primary_category text not null default 'mixed' check (
  primary_category in (
    '2d-art', '3d-assets', 'animation-rig', 'ui-kit', 'vfx',
    'audio', 'fonts', 'world-scene', 'mixed'
  )
),
```

- [ ] **Step 2: Write the incremental migration**

Create `docs/beegame-resource-pack-primary-category-migration.sql`:

```sql
alter table public.beegame_resource_packs
  add column if not exists primary_category text;

update public.beegame_resource_packs
set primary_category = case
  when categories @> '["ui"]'::jsonb and jsonb_array_length(categories) = 1 then 'ui-kit'
  when categories @> '["audio"]'::jsonb and jsonb_array_length(categories) = 1 then 'audio'
  when categories @> '["fonts"]'::jsonb and jsonb_array_length(categories) = 1 then 'fonts'
  when categories @> '["vfx"]'::jsonb and jsonb_array_length(categories) = 1 then 'vfx'
  when categories @> '["scenes"]'::jsonb and jsonb_array_length(categories) = 1 then 'world-scene'
  else 'mixed'
end
where primary_category is null;

alter table public.beegame_resource_packs
  alter column primary_category set default 'mixed',
  alter column primary_category set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'beegame_resource_packs_primary_category_check'
      and conrelid = 'public.beegame_resource_packs'::regclass
  ) then
    alter table public.beegame_resource_packs
      add constraint beegame_resource_packs_primary_category_check check (
        primary_category in (
          '2d-art', '3d-assets', 'animation-rig', 'ui-kit', 'vfx',
          'audio', 'fonts', 'world-scene', 'mixed'
        )
      );
  end if;
end $$;
```

- [ ] **Step 3: Verify SQL formatting and idempotence manually**

Confirm `add column if not exists` is present, existing rows are assigned before
`set not null`, and no operation changes `categories` or element rows.

- [ ] **Step 4: Commit the schema work**

```bash
git add docs/beegame-supabase-schema.sql docs/beegame-resource-pack-primary-category-migration.sql
git commit -m "feat: persist Pack primary categories"
```

### Task 3: Map the new field through resource repositories and import

**Files:**
- Modify: `packages/beegame-resource-server/src/supabase-resource-repository.ts`
- Modify: `packages/beegame-resource-server/src/import-resource-pack.ts`
- Test: `packages/beegame-resource-server/src/__tests__/supabase-resource-repository.test.ts`

- [ ] **Step 1: Extend repository test fixtures**

Add `primary_category: '2d-art'` to the mock Pack row and assert:

```ts
await expect(repository.listPacks()).resolves.toEqual([
  expect.objectContaining({ id: 'pack-1', primaryCategory: '2d-art', elementCount: 2 }),
])
```

Add a create-Package test whose recorded POST body contains
`primary_category: 'ui-kit'` and does not replace `categories`.

- [ ] **Step 2: Run repository tests and verify failure**

Run: `bun test packages/beegame-resource-server/src/__tests__/supabase-resource-repository.test.ts`

Expected: FAIL because row mapping omits `primary_category`.

- [ ] **Step 3: Update repository row mapping and writes**

```ts
type PackRow = Omit<ResourcePack, 'gameTypes' | 'coverPath'> & {
  game_types: string[]
  primary_category: ResourcePack['primaryCategory']
  cover_path?: string | null
  element_count?: number
}

const toPack = async (row: PackRow): Promise<PackSummary> => ({
  id: row.id,
  name: row.name,
  style: row.style,
  primaryCategory: row.primary_category,
  gameTypes: row.game_types,
  dimension: row.dimension,
  categories: row.categories,
  license: row.license,
  version: row.version,
  status: row.status,
  ...(row.cover_path ? { coverPath: await signPath(`${row.id}/${row.cover_path}`) } : {}),
  elementCount: row.element_count ?? 0,
})
```

In `createPack`, include `primary_category: pack.primaryCategory` in the POST
body.

In `import-resource-pack.ts`, add `primaryCategory` to `toPack`. Use a manifest
value when it is one of the Pack-primary enum values; otherwise derive only
from a single unambiguous contained category (`ui`, `audio`, `fonts`, `vfx`,
`scenes`), falling back to `mixed`. Never derive `characters` or `environment`
as a primary category.

- [ ] **Step 4: Run repository and importer tests**

Run: `bun test packages/beegame-resource-server/src/__tests__/supabase-resource-repository.test.ts packages/beegame-resource-server/src/__tests__/app.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit repository mappings**

```bash
git add packages/beegame-resource-server/src/supabase-resource-repository.ts packages/beegame-resource-server/src/import-resource-pack.ts packages/beegame-resource-server/src/__tests__/supabase-resource-repository.test.ts
git commit -m "feat: map Pack primary categories through repository"
```

### Task 4: Require the field in Pack authoring API

**Files:**
- Modify: `packages/beegame-resource-server/src/app.ts`
- Test: `packages/beegame-resource-server/src/__tests__/authoring-routes.test.ts`

- [ ] **Step 1: Update authoring route tests**

Use this creation body and assert the response:

```ts
body: JSON.stringify({
  id: 'pack-1', name: 'Forest', style: 'Painterly',
  primaryCategory: 'world-scene', dimension: 'agnostic',
  gameTypes: ['adventure'], categories: ['environment'],
})
// response pack matches { primaryCategory: 'world-scene', status: 'draft' }
```

Add a request with `primaryCategory: 'characters'` and expect status 400 plus
`error.code === 'invalid_pack'`.

- [ ] **Step 2: Run authoring route tests and verify failure**

Run: `bun test packages/beegame-resource-server/src/__tests__/authoring-routes.test.ts`

Expected: FAIL because the app does not copy `body.primaryCategory` to the Pack.

- [ ] **Step 3: Pass the field to repository creation**

```ts
primaryCategory: body.primaryCategory,
```

Pass it as unknown only at the request boundary; rely on
`validateResourcePack` in the repository to reject missing or invalid values.

- [ ] **Step 4: Run authoring API tests**

Run: `bun test packages/beegame-resource-server/src/__tests__/authoring-routes.test.ts packages/beegame-resource-server/src/__tests__/app.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit authoring API changes**

```bash
git add packages/beegame-resource-server/src/app.ts packages/beegame-resource-server/src/__tests__/authoring-routes.test.ts
git commit -m "feat: require Pack primary category in authoring API"
```

### Task 5: Send the Pack primary category from the frontend

**Files:**
- Modify: `apps/frontend/src/services/resourceLibraryApi.ts`
- Modify: `apps/frontend/src/services/resourceLibraryApi.test.ts`
- Modify: `apps/frontend/src/components/ResourceLibrary/CreateResourcePackDialog.tsx`
- Test: `apps/frontend/src/components/ResourceLibrary/CreateResourcePackDialog.test.tsx`

- [ ] **Step 1: Add the transport contract and a failing API assertion**

```ts
export type ResourcePackPrimaryCategory =
  | '2d-art' | '3d-assets' | 'animation-rig' | 'ui-kit' | 'vfx'
  | 'audio' | 'fonts' | 'world-scene' | 'mixed'

export type CreateResourcePackInput = {
  name: string
  style: string
  primaryCategory: ResourcePackPrimaryCategory
  dimension: '2D' | '3D' | 'agnostic'
  gameTypes: string[]
  categories: string[]
}
```

Test that `createPack` serializes `primaryCategory: 'ui-kit'` separately from
an empty/derived `categories` array.

- [ ] **Step 2: Run the frontend API test and verify failure**

Run: `npm --prefix apps/frontend run test:run -- src/services/resourceLibraryApi.test.ts`

Expected: FAIL because the input and returned summary omit `primaryCategory`.

- [ ] **Step 3: Update API types and create dialog select values**

Add `primaryCategory` to `ResourcePackSummary`; keep `categories` required as
the derived list of contained element categories, allowing `[]` before upload.

Replace the dialog's current `categoryOptions` with:

```ts
const primaryCategoryOptions = [
  ['2d-art', '2D 美术包'], ['3d-assets', '3D 资产包'],
  ['animation-rig', '动画与骨骼包'], ['ui-kit', 'UI Kit'],
  ['vfx', 'VFX 包'], ['audio', '音频包'], ['fonts', '字体包'],
  ['world-scene', '世界与场景包'], ['mixed', '综合资源包'],
] as const
```

Keep `主分类` as the same native `<select>`, preserve its existing dimensions,
and store its value in `primaryCategory`. On submit send
`{ primaryCategory, categories: [] }`; uploaded elements later populate the
contained categories.

- [ ] **Step 4: Update dialog tests**

Add a test that selects `UI Kit`, completes existing mandatory fields, submits,
and expects:

```ts
expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
  primaryCategory: 'ui-kit', categories: [],
}))
```

- [ ] **Step 5: Run frontend tests**

Run: `npm --prefix apps/frontend run test:run -- src/services/resourceLibraryApi.test.ts src/components/ResourceLibrary/CreateResourcePackDialog.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit frontend authoring contract**

```bash
git add apps/frontend/src/services/resourceLibraryApi.ts apps/frontend/src/services/resourceLibraryApi.test.ts apps/frontend/src/components/ResourceLibrary/CreateResourcePackDialog.tsx apps/frontend/src/components/ResourceLibrary/CreateResourcePackDialog.test.tsx
git commit -m "feat: classify new Packs by primary purpose"
```

### Task 6: Separate Pack presentation from element navigation

**Files:**
- Modify: `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx`
- Test: `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx`

- [ ] **Step 1: Write the Pack-detail regression test**

Create a Pack fixture with:

```ts
primaryCategory: 'world-scene',
categories: ['models', 'materials', 'textures'],
```

Assert the Pack card/detail displays `世界与场景包`, while the left file tree
continues to render `模型`, `材质`, and `贴图` as element-level navigation
nodes.

- [ ] **Step 2: Run the view test and verify failure**

Run: `npm --prefix apps/frontend run test:run -- src/components/ResourceLibrary/ResourceLibraryView.test.tsx`

Expected: FAIL because the view only labels `categories` and has no
`primaryCategory` label map.

- [ ] **Step 3: Add a separate Pack-category label map**

```ts
const primaryCategoryLabels: Record<ResourcePackPrimaryCategory, string> = {
  '2d-art': '2D 美术包', '3d-assets': '3D 资产包',
  'animation-rig': '动画与骨骼包', 'ui-kit': 'UI Kit',
  vfx: 'VFX 包', audio: '音频包', fonts: '字体包',
  'world-scene': '世界与场景包', mixed: '综合资源包',
}
```

Use this map only for Pack metadata. Leave `categoryLabels` and the folder
tree bound to element categories; do not call `listElements` with a primary
category.

- [ ] **Step 4: Run the resource-library view test**

Run: `npm --prefix apps/frontend run test:run -- src/components/ResourceLibrary/ResourceLibraryView.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the display separation**

```bash
git add apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx
git commit -m "feat: separate Pack and element category display"
```

### Task 7: Verify the complete change set

**Files:**
- No source changes expected.

- [ ] **Step 1: Run all resource-domain tests**

Run: `bun test packages/beegame-resource-core/src/__tests__ packages/beegame-resource-server/src/__tests__`

Expected: PASS.

- [ ] **Step 2: Run focused frontend tests**

Run: `npm --prefix apps/frontend run test:run -- src/services/resourceLibraryApi.test.ts src/components/ResourceLibrary/CreateResourcePackDialog.test.tsx src/components/ResourceLibrary/ResourceLibraryView.test.tsx`

Expected: PASS.

- [ ] **Step 3: Build the frontend**

Run: `npm --prefix apps/frontend run build -- --mode test`

Expected: TypeScript and Vite build complete successfully. Existing chunk-size
warnings are non-blocking if no new type or build error is present.

- [ ] **Step 4: Review migration before handoff**

Run: `git diff HEAD~6..HEAD -- docs/beegame-resource-pack-primary-category-migration.sql docs/beegame-supabase-schema.sql`

Expected: only the `primary_category` column, migration default/backfill, and
constraint are included.
