import { test, expect } from 'bun:test'
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeDesignDocumentsFixture, uiLayoutFixture } from '../fixtures/layout-fixture'
import { createRun, type AgentTurn } from './state'
import { createLocalWorkflowStore, assertCommit } from './store'
import { designInputRevision, designHandoffPath } from '../design-handoff'

test('design identity covers optional index lifecycle and unregistered saved content drafts', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-design-identity-')))
  try {
    await writeDesignDocumentsFixture(root)
    const path = join(root, designHandoffPath('GDD.md')), content = await readFile(path, 'utf8')
    const original = designInputRevision(root)
    await rm(path)
    const absent = designInputRevision(root)
    expect(absent).not.toBe(original)
    await writeFile(path, content)
    expect(designInputRevision(root)).toBe(original)
    await writeFile(path, content + '\n ')
    expect(designInputRevision(root)).not.toBe(original)
    const indexed = designInputRevision(root), ui = uiLayoutFixture(); ui.id = 'settings'
    await writeFile(join(root, 'content/ui/settings.json'), JSON.stringify(ui))
    const added = designInputRevision(root)
    expect(added).not.toBe(indexed)
    ui.data.nodes[1]!.layout!.size![0] += 10
    await writeFile(join(root, 'content/ui/settings.json'), JSON.stringify(ui))
    expect(designInputRevision(root)).not.toBe(added)
    await rm(join(root, 'content/ui/settings.json'))
    expect(designInputRevision(root)).toBe(indexed)
  } finally { await rm(root, { recursive: true, force: true }) }
})
