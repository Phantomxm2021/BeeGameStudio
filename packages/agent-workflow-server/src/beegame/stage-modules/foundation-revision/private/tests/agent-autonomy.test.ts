import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareRevisionFiles } from '../native-files'
import { revisionDigest } from '../json-digest'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'
import { fileReviewPrompt } from '../../../foundation-reviewer/private/native-files'

test('review prompt provides task and context without prescribing an audit strategy or design authority', () => {
  for (const comparison of [false, true]) {
    const prompt = fileReviewPrompt(comparison)
    expect(prompt).toContain('Audit the documentation in docs/')
    expect(prompt.includes('review-context/manifest.json')).toBe(comparison)
    for (const restriction of ['reading order', 'no problems remain', 'rather than asking',
      'Do not write files', 'delegate', 'external resources', 'comparison table', 'line-number'])
      expect(prompt).not.toContain(restriction)
  }
})

test('revision can fix unlisted problems and keep working artifacts without publishing them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'revision-autonomy-'))
  try {
    const source = buildSingleReviewFixture({ documents: reviewFixtureDocuments(),
      identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
      subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
    const prepared = await prepareRevisionFiles(join(root, 'attempt'), {
      ownerId: 'owner', projectId: 'project', requestId: 'revision', sourceResult: source,
      sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: source.resultId, resultDigest: revisionDigest(source) },
    })
    expect(prepared.prompt).toContain('not a limit on which problems')
    expect(prepared.prompt).toContain('verify the resulting document set')
    for (const restriction of ['preserve unrelated content', 'delegates internal design',
      'delegate,', 'external resources', 'Do not output', 'reviewer will independently check'])
      expect(prepared.prompt).not.toContain(restriction)
    const unlisted = source.documents.find(document => !source.issues.some(entry => entry.issue.source.documentPath === document.path))!
    const content = unlisted.content + '\nA related correction outside the previous issue list.\n'
    await writeFile(join(prepared.cwd, unlisted.path), content)
    await writeFile(join(prepared.cwd, 'notes.md'), 'Private working notes')
    await mkdir(join(prepared.cwd, 'scratch'))
    await writeFile(join(prepared.cwd, 'scratch/check.json'), '{}')
    await writeFile(join(prepared.cwd, 'docs/working-notes.md'), 'Not a deliverable')
    const snapshot = await prepared.snapshot({ summary: 'Fixed independently identified problems.' })
    expect(snapshot.documents).toHaveLength(8)
    expect(snapshot.documents.find(document => document.path === unlisted.path)?.content).toBe(content)
    expect(JSON.stringify(snapshot)).not.toContain('Private working notes')
    await chmod(join(prepared.cwd, 'review.json'), 0o600)
    await writeFile(join(prepared.cwd, 'review.json'), '{}')
    await expect(prepared.snapshot({ summary: 'Changed evidence' })).rejects.toThrow('read-only evidence')
  } finally { await rm(root, { recursive: true, force: true }) }
})
