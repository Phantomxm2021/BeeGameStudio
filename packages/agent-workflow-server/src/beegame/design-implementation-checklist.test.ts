import { expect, test } from 'bun:test'
import { access, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT_DOCUMENTS } from './project-content-authority'
import { checkDesignHandoff, checkDesignHandoffDraft, designHandoffPath, designImplementationRevisionDocuments, designSupportingFiles, designReviewIndexes,
  finalizeDesignDocuments, readDesignAcceptanceRequirements, readDesignImplementationChecklist, snapshotDesignDocuments } from './design-handoff'
import { designDocumentFixture, designHandoffFixture, designRequirementChecksFixture, writeDesignDocumentFixture,
  writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { readRuntimeAcceptanceReport } from './runtime-acceptance'

// All files are synthetic temp fixtures, never generated game products.
async function fixture(run: (workspace: string) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-implementation-checklist-'))
  try { await writeDesignDocumentsFixture(workspace); await run(workspace) }
  finally { await rm(workspace, { recursive: true, force: true }) }
}

test('eight-document technical design and tasks can finalize before visual/resource/UI/Scene production', () => fixture(async workspace => {
  await rm(join(workspace, 'content'), { recursive: true })
  for (const name of ['UI_UX_SPEC.md', 'LEVEL_SCENE_DESIGN.md'] as const)
    await writeFile(join(workspace, 'docs', name), '# Design\n- Version: v1.0\nFixture requirements; production inputs are planned, not delivered.\n')
  const before = await readFile(join(workspace, designHandoffPath('TECHNICAL_DESIGN.md')), 'utf8')
  expect(checkDesignHandoffDraft(workspace, 'TECHNICAL_DESIGN.md', { finalTechnical: true }))
    .toMatchObject({ valid: true, issues: [] })
  expect(finalizeDesignDocuments(workspace, PROJECT_DOCUMENTS, snapshotDesignDocuments(workspace, PROJECT_DOCUMENTS)))
    .toMatchObject({ issues: [], unsafeIssues: [] })
  expect(checkDesignHandoff(workspace, PROJECT_DOCUMENTS)).toMatchObject({ valid: true, issues: [] })
  expect(readDesignImplementationChecklist(workspace).items.map(item => item.id))
    .toEqual(designHandoffFixture('TECHNICAL_DESIGN.md').implementationItems!.map(item => item.id))
  expect(await readFile(join(workspace, designHandoffPath('TECHNICAL_DESIGN.md')), 'utf8')).toBe(before)
  for (const path of ['assets', 'content']) await expect(access(join(workspace, path))).rejects.toThrow()
}))

test('task view preserves eight owners and both decision and acceptance pointers without copying prose', () => fixture(async workspace => {
  const tech = designHandoffFixture('TECHNICAL_DESIGN.md')
  tech.implementationItems = [{ id: 'task-journey', section: 'Complete player journey',
    requirementRefs: PROJECT_DOCUMENTS.map(document => ({ document, id: document === 'GDD.md' ? 'play' : 'ready' })) }]
  await writeDesignDocumentFixture(workspace, 'TECHNICAL_DESIGN.md', tech,
    designDocumentFixture('TECHNICAL_DESIGN.md') + '\n## Complete player journey\nUse each owner source and actual input.\n')
  const audio = designHandoffFixture('AUDIO_DESIGN.md')
  audio.outputs[0]!.acceptance!.section = 'Listen to actual playback'
  await writeDesignDocumentFixture(workspace, 'AUDIO_DESIGN.md', audio,
    designDocumentFixture('AUDIO_DESIGN.md') + '\n## Listen to actual playback\nSynthetic expected sound.\n')
  const before = await readFile(join(workspace, designHandoffPath('TECHNICAL_DESIGN.md')), 'utf8')
  const checklist = readDesignImplementationChecklist(workspace)
  expect(checklist.items).toHaveLength(1)
  expect(checklist.items[0]).toMatchObject({ id: 'task-journey',
    taskSource: { document: 'docs/TECHNICAL_DESIGN.md', section: 'Complete player journey' } })
  expect(checklist.items[0]!.requirements.map(ref => ref.document)).toEqual([...PROJECT_DOCUMENTS])
  expect(checklist.items[0]!.requirements.find(ref => ref.document === 'AUDIO_DESIGN.md')).toMatchObject({
    sourceSection: 'Design', acceptanceSection: 'Listen to actual playback', method: 'inspection' })
  expect(checklist.globalSources).toHaveLength(8)
  expect(checklist.limitation).toContain('not proof')
  expect(JSON.stringify(checklist)).not.toContain('Synthetic expected sound')
  expect(await readFile(join(workspace, designHandoffPath('TECHNICAL_DESIGN.md')), 'utf8')).toBe(before)
  expect(designReviewIndexes(workspace, ['TECHNICAL_DESIGN.md'])[0]).toMatchObject({ implementationItems: tech.implementationItems })
}))

test.each([
  ['absent', 'implementationItems is missing or empty'],
  ['empty', 'implementationItems is missing or empty'],
  ['duplicate-task', 'duplicate implementation item ID'],
  ['absent-section', 'implementation item fixture-GDD references an absent section'],
  ['unknown-output', 'references missing requirement GDD.md#invented'],
  ['duplicate-ref', 'duplicate requirement GDD.md#play'],
  ['empty-refs', 'implementationItems'],
  ['uncovered', 'GDD.md#play has no implementation item'],
] as const)('final design rejects %s task fault instead of relying on an author Todo', (fault, message) => fixture(async workspace => {
  const tech = designHandoffFixture('TECHNICAL_DESIGN.md')
  if (fault === 'absent') delete tech.implementationItems
  if (fault === 'empty') tech.implementationItems = []
  if (fault === 'duplicate-task') tech.implementationItems!.push(tech.implementationItems![0]!)
  if (fault === 'absent-section') tech.implementationItems![0]!.section = 'Absent'
  if (fault === 'unknown-output') tech.implementationItems![0]!.requirementRefs[0]!.id = 'invented'
  if (fault === 'duplicate-ref') tech.implementationItems![0]!.requirementRefs.push(tech.implementationItems![0]!.requirementRefs[0]!)
  if (fault === 'empty-refs') tech.implementationItems![0]!.requirementRefs = []
  if (fault === 'uncovered') tech.implementationItems!.shift()
  await writeDesignDocumentFixture(workspace, 'TECHNICAL_DESIGN.md', tech)
  const before = await readFile(join(workspace, designHandoffPath('TECHNICAL_DESIGN.md')), 'utf8')
  const check = checkDesignHandoff(workspace, PROJECT_DOCUMENTS)
  expect(check.valid).toBe(false)
  expect(check.issues.join('; ')).toContain(message)
  expect(() => readDesignImplementationChecklist(workspace)).toThrow()
  expect(await readFile(join(workspace, designHandoffPath('TECHNICAL_DESIGN.md')), 'utf8')).toBe(before)
}))

test('a professional requirement without acceptance cannot disappear from the execution checklist', () => fixture(async workspace => {
  const audio = designHandoffFixture('AUDIO_DESIGN.md')
  delete audio.outputs[0]!.acceptance
  await writeDesignDocumentFixture(workspace, 'AUDIO_DESIGN.md', audio)
  const issues = checkDesignHandoff(workspace, PROJECT_DOCUMENTS).issues
  expect(issues.join('; ')).toContain('AUDIO_DESIGN.md: output ready needs an acceptance section')
  expect(issues.join('; ')).toContain('AUDIO_DESIGN.md#ready has no acceptance section')
  expect(() => readDesignAcceptanceRequirements(workspace)).toThrow()
}))

test('only final technical index owns task organization, not a second sibling plan', () => fixture(async workspace => {
  const art = { ...designHandoffFixture('ART_DIRECTION.md'),
    implementationItems: designHandoffFixture('TECHNICAL_DESIGN.md').implementationItems }
  await writeDesignDocumentFixture(workspace, 'ART_DIRECTION.md', art)
  expect(checkDesignHandoff(workspace, PROJECT_DOCUMENTS).issues.join('; '))
    .toContain('ART_DIRECTION.md: implementationItems belongs only')
}))

test.each(['missing', 'self', 'duplicate', 'cycle'] as const)('declared task dependencies reject %s without changing sources', fault => fixture(async workspace => {
  const tech = designHandoffFixture('TECHNICAL_DESIGN.md')
  const [first, second] = tech.implementationItems!
  first!.dependsOn = fault === 'missing' ? ['absent'] : fault === 'self' ? [first!.id]
    : fault === 'duplicate' ? [second!.id, second!.id] : [second!.id]
  if (fault === 'cycle') second!.dependsOn = [first!.id]
  await writeDesignDocumentFixture(workspace, 'TECHNICAL_DESIGN.md', tech)
  const check = checkDesignHandoff(workspace, PROJECT_DOCUMENTS)
  expect(check.valid).toBe(false)
  expect(check.issues.join(' ')).toContain(fault === 'self' ? 'depends on itself' : fault === 'cycle' ? 'dependency cycle' : fault === 'missing' ? 'missing dependency' : 'duplicate dependency')
}))

test('task view preserves explicit dependency order and does not invent legacy independence', () => fixture(async workspace => {
  const tech = designHandoffFixture('TECHNICAL_DESIGN.md')
  const [first, second, legacy] = tech.implementationItems!
  first!.dependsOn = []
  second!.dependsOn = [first!.id]
  await writeDesignDocumentFixture(workspace, 'TECHNICAL_DESIGN.md', tech)
  const view = readDesignImplementationChecklist(workspace)
  expect(view.items.find(item => item.id === first!.id)?.dependsOn).toEqual([])
  expect(view.items.find(item => item.id === second!.id)?.dependsOn).toEqual([first!.id])
  expect(view.items.find(item => item.id === legacy!.id)).not.toHaveProperty('dependsOn')
}))

test('unfinished technical baseline and legacy index remain readable but not final checklist-certified', () => fixture(async workspace => {
  const tech = designHandoffFixture('TECHNICAL_DESIGN.md')
  delete tech.implementationItems
  await writeDesignDocumentFixture(workspace, 'TECHNICAL_DESIGN.md', tech)
  const before = await readFile(join(workspace, designHandoffPath('TECHNICAL_DESIGN.md')), 'utf8')
  expect(checkDesignHandoff(workspace, ['TECHNICAL_DESIGN.md'], { technicalBaseline: true }).valid).toBe(true)
  expect(checkDesignHandoff(workspace, PROJECT_DOCUMENTS, { technicalBaseline: true }).valid).toBe(true)
  expect(checkDesignHandoff(workspace, PROJECT_DOCUMENTS).valid).toBe(false)
  expect(await readFile(join(workspace, designHandoffPath('TECHNICAL_DESIGN.md')), 'utf8')).toBe(before)
}))

test('task IDs and associations participate in existing versions and invalidate old report evidence', () => fixture(async workspace => {
  const reportPath = '.beegame/delivery/acceptance.json'
  const evidencePath = 'synthetic-evidence.txt'
  await writeFile(join(workspace, evidencePath), 'Synthetic result, not actual gameplay evidence')
  // The fixture's handoff writer already created .beegame; create the result parent through Bun's fixture writer.
  await Bun.write(join(workspace, reportPath), JSON.stringify({ scope: 'delivery', status: 'passed',
    summary: 'Synthetic coverage', environment: 'Synthetic test', evidencePaths: [evidencePath], artifactPaths: [evidencePath],
    verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [],
      requirementChecks: designRequirementChecksFixture(workspace, [evidencePath]) } }))
  expect((await readRuntimeAcceptanceReport(workspace, reportPath))?.status).toBe('passed')
  const before = readDesignImplementationChecklist(workspace)
  const snapshot = snapshotDesignDocuments(workspace, ['TECHNICAL_DESIGN.md'])
  const tech = designHandoffFixture('TECHNICAL_DESIGN.md')
  tech.implementationItems![0]!.id = 'renamed-task'
  await writeDesignDocumentFixture(workspace, 'TECHNICAL_DESIGN.md', tech)
  expect(finalizeDesignDocuments(workspace, ['TECHNICAL_DESIGN.md'], snapshot).issues).toEqual([])
  expect(readDesignImplementationChecklist(workspace).designRevision).not.toBe(before.designRevision)
  expect((await readRuntimeAcceptanceReport(workspace, reportPath))?.summary).toContain('Requirement source changed: TECHNICAL_DESIGN.md#ready')
  expect(JSON.parse(await readFile(join(workspace, designHandoffPath('TECHNICAL_DESIGN.md')), 'utf8')).documentVersion).toBe('1.1')
}))

test('related task consumer joins an exact revision scope, unrelated documents do not', () => fixture(async workspace => {
  expect(designImplementationRevisionDocuments(workspace, ['AUDIO_DESIGN.md']))
    .toEqual(['AUDIO_DESIGN.md', 'TECHNICAL_DESIGN.md'])
  const tech = designHandoffFixture('TECHNICAL_DESIGN.md')
  tech.implementationItems = tech.implementationItems!.filter(item => item.requirementRefs[0]!.document === 'GDD.md')
  await writeDesignDocumentFixture(workspace, 'TECHNICAL_DESIGN.md', tech)
  expect(designImplementationRevisionDocuments(workspace, ['ART_DIRECTION.md'])).toEqual(['ART_DIRECTION.md'])
  expect(designImplementationRevisionDocuments(workspace, ['GDD.md', 'GDD.md']))
    .toEqual(['GDD.md', 'TECHNICAL_DESIGN.md'])
}))

test('retained calculation scope follows chained inputs but not unrelated or malformed records', () => fixture(async workspace => {
  await mkdir(join(workspace, 'docs/calc'), { recursive: true })
  const retain = async (owner: 'BALANCE_DESIGN.md' | 'AUDIO_DESIGN.md' | 'ART_DIRECTION.md', id: string, input: string) => {
    const model = `docs/calc/${id}.mjs`, output = `docs/calc/${id}.md`, body = '# Synthetic calculation\n'
    await writeFile(join(workspace, model), 'export const fixture = true')
    const record = { outputDigest: createHash('sha256').update(body).digest('hex'), sources: [model, input].map(path =>
      [path, { digest: 'a'.repeat(64), scope: 'exact-bytes' }]) }
    await writeFile(join(workspace, output), body + '\n<!-- bgs-calculation-v1:' + Buffer.from(JSON.stringify(record)).toString('base64') + ' -->\n')
    await writeFile(join(workspace, 'docs', owner), (await readFile(join(workspace, 'docs', owner), 'utf8')) + `\n[Result](calc/${id}.md)\n`)
    return output
  }
  const first = await retain('BALANCE_DESIGN.md', 'first', 'content/scenes/level.json')
  await retain('AUDIO_DESIGN.md', 'second', first)
  const unrelated = await retain('ART_DIRECTION.md', 'unrelated', 'docs/GDD.md')
  const scope = designImplementationRevisionDocuments(workspace, ['LEVEL_SCENE_DESIGN.md'])
  expect(scope).toEqual(['LEVEL_SCENE_DESIGN.md', 'TECHNICAL_DESIGN.md', 'BALANCE_DESIGN.md', 'AUDIO_DESIGN.md'])
  expect(designSupportingFiles(workspace, scope)).toContain('docs/calc/second.mjs')
  expect(designSupportingFiles(workspace, scope)).not.toContain(unrelated)
  // Changed appendix bytes cannot expand permissions using its invalidated record.
  await writeFile(join(workspace, first), 'tampered\n' + await readFile(join(workspace, first), 'utf8'))
  expect(designImplementationRevisionDocuments(workspace, ['LEVEL_SCENE_DESIGN.md']))
    .toEqual(['LEVEL_SCENE_DESIGN.md', 'TECHNICAL_DESIGN.md'])
}))
