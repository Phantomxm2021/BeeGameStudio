import { describe, expect, test } from 'bun:test'

const migrationPath = `${import.meta.dir}/../../../../supabase/migrations/20260808010000_remove_resource_semantic_suggestion.sql`
const schemaPath = `${import.meta.dir}/../../../../docs/beegame-supabase-schema.sql`

describe('resource semantic suggestion removal migration', () => {
  test('rebuilds the catalog view before dropping the retired column', async () => {
    const migration = await Bun.file(migrationPath).text()
    const dropView = migration.indexOf('drop view if exists public.beegame_resource_pack_catalog;')
    const dropColumn = migration.indexOf('drop column if exists semantic_suggestion;')
    const createView = migration.indexOf('create view public.beegame_resource_pack_catalog')

    expect(dropView).toBeGreaterThanOrEqual(0)
    expect(dropColumn).toBeGreaterThan(dropView)
    expect(createView).toBeGreaterThan(dropColumn)
    expect(migration.toLowerCase()).not.toContain('cascade')
  })

  test('keeps the canonical catalog view independent of retired table columns', async () => {
    const schema = await Bun.file(schemaPath).text()
    const viewStart = schema.indexOf('create view public.beegame_resource_pack_catalog')
    const viewEnd = schema.indexOf('alter table public.beegame_resource_elements', viewStart)
    const viewDefinition = schema.slice(viewStart, viewEnd)

    expect(viewStart).toBeGreaterThanOrEqual(0)
    expect(viewDefinition).not.toContain('select e.*')
    expect(viewDefinition).not.toContain('semantic_suggestion')
  })
})
