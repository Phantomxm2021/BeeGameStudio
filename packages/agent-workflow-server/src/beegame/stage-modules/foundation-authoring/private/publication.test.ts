import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FROZEN_DOCUMENTS } from './test-fixtures/frozen-documents'
import { authorDigest, parseAuthorStart } from './contract'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { foundationAuthoringSources } from './domain/foundation-authoring-contract'
import { buildFoundationAuthorAuthorityBlock } from './domain/foundation-authoring-input'
import { commitAuthoredFoundationDocument } from './domain/authored-document-receipt'
import { publishAuthorDocuments } from './publication'

async function fixture() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'author-publication-'))
  const input = { confirmedBrief: 'Fixed publication brief', confirmedBriefDigest: createHash('sha256').update('Fixed publication brief').digest('hex') }
  const start = parseAuthorStart({ protocolVersion: 1, requestId: 'request-1', ownerId: 'owner', projectId: 'project', input, inputDigest: authorDigest({ ownerId: 'owner', projectId: 'project', input }) })
  const acceptedDispatches: Record<string, string> = {}
  while (Object.keys(acceptedDispatches).length < 8) {
    const path = CANONICAL_FOUNDATION_DOCUMENTS.find(path => !acceptedDispatches[path] && foundationAuthoringSources(path).every(source => acceptedDispatches[source.path]))
    if (!path) throw new Error('fixture author dependency cycle')
    const dispatchId = `fixture-${Object.keys(acceptedDispatches).length}`
    await buildFoundationAuthorAuthorityBlock({
      runId: 'fixture', dispatchId, ownerId: 'owner', projectId: 'project', workspacePath,
      workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', revision: 'fixture', taskId: path,
      contract: { documentSet: 'foundation', authoringMode: path === 'docs/GDD.md' ? 'initial' : 'parallel-draft', foundationDocumentPath: path,
        confirmedBriefDigest: input.confirmedBriefDigest, confirmedBriefContext: input.confirmedBrief,
        availableUpstreamPaths: foundationAuthoringSources(path).map(source => source.path) },
    })
    await commitAuthoredFoundationDocument({ workspacePath, dispatchId, targetPath: path,
      authoredBody: FROZEN_DOCUMENTS[path], updatedAt: '2026-09-05T00:00:00.000Z' })
    acceptedDispatches[path] = dispatchId
  }
  return { start, workspacePath, acceptedDispatches }
}
describe('author immutable document publication', () => {
  test('replays the same result and exposes only byte-bound business artifacts', async () => {
    const value = await fixture()
    const result = await publishAuthorDocuments(value)
    expect(await publishAuthorDocuments(value)).toEqual(result)
    expect(result.documents.map(document => document.path)).toEqual([...CANONICAL_FOUNDATION_DOCUMENTS])
    for (const document of result.documents) {
      const bytes = await readFile(join(value.workspacePath, document.artifactPath))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(document.digest)
      expect(bytes.byteLength).toBe(document.byteLength)
    }
    expect(JSON.stringify(result)).not.toContain('fixture-')
    expect(JSON.stringify(result)).not.toContain('terminalResult')
    const artifact = result.documents[0]!
    await writeFile(join(value.workspacePath, artifact.path), 'external change')
    expect(createHash('sha256').update(await readFile(join(value.workspacePath, artifact.artifactPath))).digest('hex')).toBe(artifact.digest)
    await expect(publishAuthorDocuments(value)).rejects.toThrow('binding mismatch')
  })
  test('cannot publish from completed paths without accepted receipts', async () => {
    const value = await fixture()
    delete value.acceptedDispatches['docs/ASSET_PLAN.md']
    await expect(publishAuthorDocuments(value)).rejects.toThrow('accepted receipt missing')
  })
  test('rejects an existing artifact symlink even when its bytes match', async () => {
    const value = await fixture()
    const result = await publishAuthorDocuments(value)
    const artifact = result.documents[0]!
    const destination = join(value.workspacePath, artifact.artifactPath)
    await unlink(destination)
    await symlink(join(value.workspacePath, artifact.path), destination)
    await expect(publishAuthorDocuments(value)).rejects.toThrow('not a regular file')
  })
  test('rejects canonical or workspace changes while freezing artifacts', async () => {
    const value = await fixture()
    await expect(publishAuthorDocuments(value, { afterArtifacts: async () => {
      await writeFile(join(value.workspacePath, 'unexpected-workspace-change.txt'), 'changed')
    } })).rejects.toThrow('revision changed')
    await expect(publishAuthorDocuments(value, { afterArtifacts: async () => {
      await writeFile(join(value.workspacePath, 'docs/GDD.md'), 'changed')
    } })).rejects.toThrow('document changed')
  })
})
