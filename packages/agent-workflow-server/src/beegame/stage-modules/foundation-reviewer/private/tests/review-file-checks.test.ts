import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildReviewFileChecks } from '../review-file-checks'
import { fileReviewPrompt, prepareReviewFiles } from '../native-files'
import { REVIEW_DOCUMENT_PATHS, reviewHash, type SingleReviewInput } from '../single-agent-contract'

function fixture(content: string): SingleReviewInput {
  return { subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: reviewHash('source'), confirmedBriefDigest: reviewHash('Brief') },
    requirements: { status: 'available', content: 'Brief', digest: reviewHash('Brief') },
    documents: REVIEW_DOCUMENT_PATHS.map((path, index) => ({ path, content: index === 0 ? content : '# Document' })) }
}

test('file facts resolve source-relative links, definitions, encoded paths and fragments without inventing semantic verdicts', () => {
  const source = fixture('[Requirements](../requirements.md)\n[Balance](./BALANCE%5FDESIGN.md#rule)\n[Here](#heading)\n[Audio][a]\n\n[a]: AUDIO_DESIGN.md "Audio"\n\n![Art](ART_DIRECTION.md)')
  const original = JSON.stringify(source)
  const facts = buildReviewFileChecks(source)
  expect(facts.files).toHaveLength(9)
  expect(facts.files.at(-1)).toEqual({ path: 'requirements.md', role: 'host_evidence' })
  expect(facts.links.map(link => link.targetPath)).toEqual(['requirements.md', 'docs/BALANCE_DESIGN.md', 'docs/GDD.md', 'docs/AUDIO_DESIGN.md', 'docs/ART_DIRECTION.md'])
  expect(facts.links.every(link => link.status === 'present')).toBe(true)
  expect(facts.links[0]!.line).toBe(1)
  expect(facts).not.toHaveProperty('findings')
  expect(facts).not.toHaveProperty('passed')
  expect(JSON.stringify(source)).toBe(original)
})

test('absent document paths remain distinct from unprovided assets, external URLs and unsupported paths', () => {
  const facts = buildReviewFileChecks(fixture('[Typo](BALANC_DESIGN.md)\n[Wrong relative path](requirements.md)\n[Old host name](../requirements)\n[Asset](../assets/bee.png)\n[Outside](../../../secrets.md)\n[Web](https://example.com/a.md)\n[Mail](mailto:a@example.com)\n[Root URL](/docs/GDD.md)\n[Invalid](bad%ZZ.md)\n[Null](bad%00.md)'))
  expect(facts.links.map(link => link.status)).toEqual(['absent_from_document_set', 'absent_from_document_set', 'absent_from_document_set',
    'outside_snapshot', 'outside_snapshot', 'external', 'external', 'outside_snapshot', 'unsupported', 'unsupported'])
  expect(facts.scope).toContain('Unprovided resources are not proven missing')
})

test('code, plain-text filenames and unused definitions do not become invented links', () => {
  const source = fixture('requirements.md\n\n`[example](MISSING.md)`\n\n```md\n[example](MISSING.md)\n```\n\n[unused]: MISSING.md')
  expect(buildReviewFileChecks(source).links).toEqual([])
})

test('Reviewer prompt uses a compact direct-review instruction', () => {
  const prompt = fileReviewPrompt()
  expect(prompt).toContain('Review all eight documents')
  expect(prompt).toContain('substantive omissions, contradictions')
  expect(prompt).toContain('Choose the investigation and editing approach yourself')
  expect(prompt).not.toContain('severity')
  expect(prompt).not.toContain('blocker')
  for (const label of ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']) expect(prompt).not.toContain(label)
})

test('Reviewer carries the response language without translating identifiers or source text', () => {
  expect(fileReviewPrompt('zh')).toContain('User response language: zh')
  expect(fileReviewPrompt('zh')).toContain('thinking/reasoning summaries')
  expect(fileReviewPrompt('en')).toContain('User response language: en')
  expect(fileReviewPrompt('zh')).toContain('do not translate those')
  expect(fileReviewPrompt()).not.toContain('User response language:')
})

test('Reviewer materializes exact source bytes and read-only requirements.md plus file facts, including unavailable requirements', async () => {
  for (const available of [true, false]) {
    const root = await mkdtemp(join(tmpdir(), 'review-source-paths-'))
    try {
      const source = fixture('[Brief](../requirements.md)')
      if (!available) source.requirements = { status: 'unavailable', reason: 'Not supplied' }
      const prepared = await prepareReviewFiles(root, source)
      expect(await readdir(prepared.workspacePath)).not.toContain('requirements')
      expect(await readFile(join(prepared.workspacePath, 'requirements.md'), 'utf8')).toBe(available ? 'Brief' : 'Requirements unavailable: Not supplied')
      for (const document of source.documents)
        expect(await readFile(join(prepared.workspacePath, document.path), 'utf8')).toBe(document.content)
      const checkPath = join(prepared.workspacePath, 'review-context/file-checks.json')
      const facts = JSON.parse(await readFile(checkPath, 'utf8'))
      expect(facts.requirementsStatus).toBe(available ? 'available' : 'unavailable')
      expect(facts.links[0].status).toBe('present')
      expect((await stat(checkPath)).mode & 0o222).toBe(0)
      expect((await stat(join(prepared.workspacePath, 'requirements.md'))).mode & 0o222).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})
