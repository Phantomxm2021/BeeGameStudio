import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import type { DesignFinding } from '../beegame/design-handoff'
import { writeDesignDocumentsFixture } from '../beegame/fixtures/layout-fixture'
import { AUTHOR_BATCHES } from '../beegame/project-author'
import { readProjectDelivery } from '../beegame/project-delivery'

test('authenticated owner resolution records the decision, does not mark PASS or launch work by default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-design-resolution-route-'))
  const cleanups: Array<() => void | Promise<void>> = []
  let turns = 0
  const finding: DesignFinding = { id: 'choice', severity: 'blocker', action: 'decide', owner: 'user',
    documents: ['GDD.md'], sources: [{ document: 'GDD.md', section: 'Design' }],
    impact: 'Next author cannot select between conflicting required outcomes', closeWhen: 'User selection recorded in the owning GDD clause', neededBefore: 'TECHNICAL_DESIGN.md' }
  const app = createAgentWorkflowApp({ currentUser: { id: 'owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false, registerCleanup: cleanup => cleanups.push(cleanup),
    sessionRunner: { async start(input) { return { stop() {}, async submit(turn) {
      turns++
      const task = await readFile(join(input.cwd, '.beegame/tmp', input.sessionId, 'context.md'), 'utf8')
      const result = task.match(/\.beegame\/tmp\/[^\s]+\/milestone-[\w-]+\.txt/)?.[0].replace(/:$/, '')
      if (task.includes('milestone: author.')) {
        await mkdir(join(input.cwd, 'docs'), { recursive: true })
        const batch = Number(/Author batch (\d+)\//.exec(task)![1]) - 1
        await writeDesignDocumentsFixture(input.cwd, AUTHOR_BATCHES[batch])
        if (result) await writeFile(join(input.cwd, result), 'complete\n')
      } else await writeFile(join(input.cwd, result!), 'complete\n' + JSON.stringify({ step: 'inspect', findings: [finding], resolved: [] }))
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Step executed' })
    } } } } })
  try {
    const workspace = join(root, 'projects/users/owner/game')
    await mkdir(workspace, { recursive: true })
    expect((await app.request('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'game', name: 'Game', root_path: workspace, created_at: Date.now() }) })).status).toBe(200)
    const ensured = await app.request('/api/projects/game/session/ensure', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const { session } = await ensured.json() as { session: { id: string } }
    expect((await app.request(`/api/beegame-sessions/${session.id}/confirmed-brief`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brief: { idea: 'Game', orientation: 'Landscape', creationMode: 'blueprint', resourceLibraryUsage: 'optional',
        document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en' } }) })).status).toBe(200)
    for (let n = 0; n < 200 && !(await readProjectDelivery(workspace, join(root, 'dashboard')))?.designReview?.stopped; n++) await Bun.sleep(5)
    const get = await app.request('/api/projects/game/design-review')
    expect(get.status).toBe(200)
    expect((await get.json()).review).toMatchObject({ stopped: true, findings: [finding] })
    expect(turns).toBe(AUTHOR_BATCHES.length + 1)
    const resolve = await app.request('/api/projects/game/design-resolution', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'revise', instruction: 'User selects outcome A; record it in GDD before targeted verification.', findings: [finding] }) })
    expect(resolve.status).toBe(200)
    expect(await resolve.json()).toMatchObject({ started: false, review: { step: 'revise', findings: [finding] } })
    expect(turns).toBe(AUTHOR_BATCHES.length + 1)
    expect((await readProjectDelivery(workspace, join(root, 'dashboard')))?.designBaseline).toBeUndefined()
    const invalid = await app.request('/api/projects/game/design-resolution', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'verify', instruction: 'Ignore the issue', findings: [{ ...finding, severity: 'follow-up' }] }) })
    expect(invalid.status).not.toBe(200)
    expect(turns).toBe(AUTHOR_BATCHES.length + 1)
    expect((await app.request('/api/projects/not-owned/design-review')).status).toBe(404)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
