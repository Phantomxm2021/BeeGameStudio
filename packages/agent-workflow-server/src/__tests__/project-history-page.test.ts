import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { BeeGameProjectMetadataStore } from '../project-metadata-store'
import { SupabaseDashboardStore } from '../supabase-dashboard-store'
import { createAgentWorkflowApp } from '../app'

test('local project history reads only the requested page and can fetch one older project', () => {
  const directory = mkdtempSync(join(tmpdir(), 'beegame-project-page-'))
  try {
    const store = new BeeGameProjectMetadataStore(join(directory, 'projects.sqlite'))
    for (let index = 0; index < 45; index += 1) {
      store.upsertProject({ id: `project-${index}`, name: `Game ${index}`, created_at: index + 1 })
    }

    expect(store.listProjectsPage(0, 20)).toHaveLength(20)
    expect(store.listProjectsPage(20, 20)[0]?.id).toBe('project-24')
    expect(store.listProjectsPage(40, 20)).toHaveLength(5)
    expect(store.countProjects()).toBe(45)
    expect(store.countProjects('Game 44')).toBe(1)
    expect(store.listProjectsPage(0, 20, 'Game 44').map(project => project.id)).toEqual(['project-44'])
    expect(store.getProject('project-1')?.name).toBe('Game 1')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('remote project history requests a bounded page, not the whole table', async () => {
  const requests: string[] = []
  const store = new SupabaseDashboardStore({
    url: 'https://fixture.supabase.co',
    anonKey: 'fixture',
    authToken: 'fixture-user',
    fetchImpl: async input => {
      requests.push(String(input))
      return Response.json([], { headers: { 'Content-Range': '20-20/100' } })
    },
  })

  expect(await store.listProjectsPage('owner-1', 20, 21, 'Game')).toEqual({ items: [], total: 100 })
  const query = new URL(requests[0]).searchParams
  expect(query.get('offset')).toBe('20')
  expect(query.get('limit')).toBe('21')
  expect(query.get('owner_id')).toBe('eq.owner-1')
  expect(query.get('or')).toContain('name.ilike.*Game*')
})

test('project history API returns pages and a single older project', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'beegame-project-api-page-'))
  const cleanups: Array<() => void | Promise<void>> = []
  try {
    const app = createAgentWorkflowApp({
      currentUser: { id: 'owner', role: 'owner' },
      dashboardDataRoot: join(directory, 'dashboard'),
      defaultWorkspacePath: join(directory, 'projects'),
      modelConfigStore: false,
      skillsConfig: false,
      registerCleanup: cleanup => cleanups.push(cleanup),
    })
    for (let index = 0; index < 25; index += 1) {
      const response = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: `project-${index}`, name: `Game ${index}`, created_at: index + 1 }),
      })
      expect(response.status).toBe(200)
    }

    const first = await app.request('/api/projects/page?offset=0&limit=20')
    const firstPage = await first.json() as { items: Array<{ id: string }>; hasMore: boolean; total: number }
    expect(first.status).toBe(200)
    expect(firstPage.items).toHaveLength(20)
    expect(firstPage.hasMore).toBe(true)
    expect(firstPage.total).toBe(25)
    expect(firstPage.items[0]?.id).toBe('project-24')

    const second = await app.request('/api/projects/page?offset=20&limit=20')
    const secondPage = await second.json() as { items: Array<{ id: string }>; hasMore: boolean; total: number }
    expect(secondPage.items).toHaveLength(5)
    expect(secondPage.hasMore).toBe(false)
    expect(secondPage.total).toBe(25)

    const older = await app.request('/api/projects/project-1/metadata')
    expect((await older.json() as { id: string }).id).toBe('project-1')
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    rmSync(directory, { recursive: true, force: true })
  }
})
