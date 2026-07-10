import { describe, expect, test } from 'bun:test'
import { zipSync } from 'fflate'
import { createSupabaseResourcePackImporter } from '../import-resource-pack'

describe('supabase resource pack importer', () => {
  test('uploads archive files through the configured storage bucket', async () => {
    const requests: string[] = []
    const fetchImpl = (async (input: URL | RequestInfo) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('/rest/v1/')) return new Response(null, { status: 201 })
      return new Response(null, { status: 200 })
    }) as typeof fetch
    const importer = createSupabaseResourcePackImporter({
      baseUrl: 'https://project.supabase.co',
      serviceRoleKey: 'service-key',
      fetchImpl,
    })
    const archive = zipSync({
      'preview.png': new Uint8Array([1, 2, 3]),
      'models/prop.glb': new Uint8Array([4, 5, 6]),
    })
    const form = new FormData()
    form.set('file', new File([archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer], 'kenney_food-kit.zip', { type: 'application/zip' }))

    const pack = await importer(new Request('http://resource.test/import', { method: 'POST', body: form }))

    expect(pack.primaryCategory).toBe('mixed')
    expect(requests).toContain('https://project.supabase.co/storage/v1/object/beegame-resource-packs/kenney-food-kit/models/prop.glb')
    expect(requests).toContain('https://project.supabase.co/storage/v1/object/beegame-resource-packs/kenney-food-kit/preview.png')
  })

  test('derives a Pack primary category from an unambiguous element category', async () => {
    const importer = createSupabaseResourcePackImporter({
      baseUrl: 'https://project.supabase.co',
      serviceRoleKey: 'service-key',
      fetchImpl: (async (input: URL | RequestInfo) => new Response(null, { status: String(input).includes('/rest/v1/') ? 201 : 200 })) as typeof fetch,
    })
    const archive = zipSync({ 'ui/button.png': new Uint8Array([1, 2, 3]) })
    const form = new FormData()
    form.set('file', new File([archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer], 'ui-pack.zip', { type: 'application/zip' }))

    await expect(importer(new Request('http://resource.test/import', { method: 'POST', body: form }))).resolves.toMatchObject({ primaryCategory: 'ui-kit' })
  })
})
