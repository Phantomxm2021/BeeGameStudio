import { expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectContentAuthority } from './project-content-authority'
import { checkDesignHandoff, designHandoffPath, snapshotDesignDocuments, finalizeDesignDocuments } from './design-handoff'
import { writeDesignDocumentsFixture } from './fixtures/layout-fixture'

test('content authority binds minimal consumer indexes and host-generated revisions without rewriting drafts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'synthetic-content-authority-'))
  try {
    await writeDesignDocumentsFixture(workspace)
    const path = join(workspace, designHandoffPath('GDD.md'))
    const body = await readFile(join(workspace, 'docs/GDD.md'), 'utf8')
    const index = JSON.parse(await readFile(path, 'utf8'))
    const original = projectContentAuthority(workspace)
    const snapshot = snapshotDesignDocuments(workspace, ['GDD.md'])
    index.outputs[0].id = 'current-output'
    await writeFile(path, JSON.stringify(index))
    const changed = projectContentAuthority(workspace)
    expect(changed.documentRevision).not.toBe(original.documentRevision)
    expect(changed.assetManifestRevision).toBe(original.assetManifestRevision)
    expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(body)
    expect(finalizeDesignDocuments(workspace, ['GDD.md'], snapshot).issues).toEqual([])
    const finalized = projectContentAuthority(workspace)
    expect(finalized.documentRevision).not.toBe(changed.documentRevision)
    expect(checkDesignHandoff(workspace, ['GDD.md']).valid).toBe(true)
    expect(finalizeDesignDocuments(workspace, ['GDD.md'], snapshot).issues).toEqual([])
    expect(projectContentAuthority(workspace).documentRevision).toBe(finalized.documentRevision)
    await writeFile(path, '{malformed}')
    const invalidBytes = await readFile(path, 'utf8')
    expect(projectContentAuthority(workspace).documentRevision).not.toBe(finalized.documentRevision)
    expect(checkDesignHandoff(workspace, ['GDD.md']).valid).toBe(false)
    expect(await readFile(path, 'utf8')).toBe(invalidBytes)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})
