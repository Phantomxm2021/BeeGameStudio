import { expect, test } from 'bun:test'
import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT_DOCUMENTS } from './project-content-authority'
import { checkDesignHandoff, checkDesignHandoffDraft, designHandoffPath, designReviewIndexes,
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

test('GDD design and tasks can finalize before UI/Scene production inputs are complete', () => fixture(async workspace => {
  await rm(join(workspace, 'content'), { recursive: true })
  for (const name of ['GDD.md'] as const)
    await writeFile(join(workspace, 'docs', name), '# Design\n- Version: v1.0\nFixture requirements; production inputs are planned, not delivered.\n')
  const before = await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')
  expect(checkDesignHandoffDraft(workspace, 'GDD.md', { includeRequirements: true }))
    .toMatchObject({ valid: true, issues: [] })
  expect(finalizeDesignDocuments(workspace, PROJECT_DOCUMENTS, snapshotDesignDocuments(workspace, PROJECT_DOCUMENTS)))
    .toMatchObject({ issues: [], unsafeIssues: [] })
  expect(checkDesignHandoff(workspace, PROJECT_DOCUMENTS)).toMatchObject({ valid: true, issues: [] })
  expect(readDesignImplementationChecklist(workspace).items.map(item => item.id))
    .toEqual(designHandoffFixture('GDD.md').implementationItems!.map(item => item.id))
  expect(await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')).toBe(before)
  for (const path of ['assets', 'content']) await expect(access(join(workspace, path))).rejects.toThrow()
}))

test('task view preserves the GDD decision and acceptance pointers without copying prose', () => fixture(async workspace => {
  const tech = designHandoffFixture('GDD.md')
  tech.implementationItems = [{ id: 'task-journey', section: 'Complete player journey',
    requirementRefs: [{ document: 'GDD.md', id: 'play' }] }]
  tech.outputs[0]!.acceptance!.section = 'Listen to actual playback'
  await writeDesignDocumentFixture(workspace, 'GDD.md', tech,
    designDocumentFixture('GDD.md') + '\n## Complete player journey\nUse the current GDD source and actual input.\n## Listen to actual playback\nSynthetic expected sound.\n')
  const before = await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')
  const checklist = readDesignImplementationChecklist(workspace)
  expect(checklist.items).toHaveLength(1)
  expect(checklist.items[0]).toMatchObject({ id: 'task-journey',
    taskSource: { document: 'docs/GDD.md', section: 'Complete player journey' } })
  expect(checklist.items[0]!.requirements.map(ref => ref.document)).toEqual(['GDD.md'])
  expect(checklist.items[0]!.requirements.find(ref => ref.document === 'GDD.md')).toMatchObject({
    sourceSection: 'Design', acceptanceSection: 'Listen to actual playback', method: 'test' })
  expect(checklist.globalSources).toEqual(['docs/GDD.md'])
  expect(checklist.limitation).toContain('completeness, implementation and quality remain unverified')
  expect(JSON.stringify(checklist)).not.toContain('Synthetic expected sound')
  expect(await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')).toBe(before)
  expect(designReviewIndexes(workspace, ['GDD.md'])[0]).toMatchObject({ implementationItems: tech.implementationItems })
}))

test.each(['absent', 'empty', 'uncovered'] as const)('optional task mapping remains readable without hiding acceptance sources: %s', kind => fixture(async workspace => {
  const tech = designHandoffFixture('GDD.md')
  if (kind === 'absent') delete tech.implementationItems
  if (kind === 'empty') tech.implementationItems = []
  if (kind === 'uncovered') tech.implementationItems!.shift()
  await writeDesignDocumentFixture(workspace, 'GDD.md', tech)
  const paths = PROJECT_DOCUMENTS.flatMap(name => ['docs/' + name, designHandoffPath(name)])
  const before = await Promise.all(paths.map(path => readFile(join(workspace, path), 'utf8')))
  expect(checkDesignHandoff(workspace, PROJECT_DOCUMENTS)).toMatchObject({ valid: true, issues: [] })
  const checklist = readDesignImplementationChecklist(workspace)
  expect(checklist.globalSources).toEqual(PROJECT_DOCUMENTS.map(name => 'docs/' + name))
  expect(checklist.items.map(item => item.id)).toEqual((tech.implementationItems ?? []).map(item => item.id))
  if (kind === 'uncovered') {
    expect(checklist.items.flatMap(item => item.requirements).some(ref => ref.document === 'GDD.md' && ref.id === 'play')).toBe(false)
  } else {
    expect(checklist.documents).toHaveLength(1)
    const document = checklist.documents![0]!
    expect(document).toMatchObject({ document: 'GDD.md' })
    if (!('sections' in document)) throw Error('Expected readable technical document sections')
    expect(document.sections.length).toBeGreaterThan(0)
    expect(checklist.limitation).toContain('An empty task index does not mean work is complete')
  }
  expect(readDesignAcceptanceRequirements(workspace)).toEqual(expect.arrayContaining([
    expect.objectContaining({ document: 'GDD.md', id: 'play', outputSection: 'Design' }),
  ]))
  expect(await Promise.all(paths.map(path => readFile(join(workspace, path), 'utf8')))).toEqual(before)
}))

test.each([
  ['duplicate-task', 'duplicate implementation item ID'],
  ['absent-section', 'implementation item fixture-GDD references an absent section'],
  ['unknown-output', 'references missing requirement GDD.md#invented'],
  ['duplicate-ref', 'duplicate requirement GDD.md#play'],
  ['empty-refs', 'implementationItems'],
] as const)('final design rejects %s task fault instead of relying on an author Todo', (fault, message) => fixture(async workspace => {
  const tech = designHandoffFixture('GDD.md')
  if (fault === 'duplicate-task') tech.implementationItems!.push(tech.implementationItems![0]!)
  if (fault === 'absent-section') tech.implementationItems![0]!.section = 'Absent'
  if (fault === 'unknown-output') tech.implementationItems![0]!.requirementRefs[0]!.id = 'invented'
  if (fault === 'duplicate-ref') tech.implementationItems![0]!.requirementRefs.push(tech.implementationItems![0]!.requirementRefs[0]!)
  if (fault === 'empty-refs') tech.implementationItems![0]!.requirementRefs = []
  await writeDesignDocumentFixture(workspace, 'GDD.md', tech)
  const before = await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')
  const check = checkDesignHandoff(workspace, PROJECT_DOCUMENTS)
  expect(check.valid).toBe(false)
  expect(check.issues.join('; ')).toContain(message)
  expect(() => readDesignImplementationChecklist(workspace)).toThrow()
  expect(await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')).toBe(before)
}))

test('a task reference to a requirement without acceptance blocks checklist and acceptance reads', () => fixture(async workspace => {
  const audio = designHandoffFixture('GDD.md')
  delete audio.outputs[0]!.acceptance
  await writeDesignDocumentFixture(workspace, 'GDD.md', audio)
  const paths = [designHandoffPath('GDD.md')]
  const before = await Promise.all(paths.map(path => readFile(join(workspace, path), 'utf8')))
  const check = checkDesignHandoff(workspace, PROJECT_DOCUMENTS)
  expect(check.valid).toBe(false)
  expect(check.issues.join('; ')).toContain('GDD.md: implementation item fixture-GDD requirement GDD.md#play has no acceptance section')
  expect(() => readDesignAcceptanceRequirements(workspace)).toThrow('GDD.md#play has no acceptance section')
  expect(() => readDesignImplementationChecklist(workspace)).toThrow('GDD.md#play has no acceptance section')
  expect(await Promise.all(paths.map(path => readFile(join(workspace, path), 'utf8')))).toEqual(before)
}))

test('the single GDD index owns task organization', () => fixture(async workspace => {
  const gdd = { ...designHandoffFixture('GDD.md'),
    implementationItems: designHandoffFixture('GDD.md').implementationItems }
  await writeDesignDocumentFixture(workspace, 'GDD.md', gdd)
  expect(checkDesignHandoff(workspace, PROJECT_DOCUMENTS)).toMatchObject({ valid: true, issues: [] })
  expect(readDesignImplementationChecklist(workspace).items.map(item => item.id)).toEqual(['fixture-GDD'])
}))

test.each(['missing', 'self', 'duplicate', 'cycle'] as const)('declared task dependencies reject %s without changing sources', fault => fixture(async workspace => {
  const tech = designHandoffFixture('GDD.md')
  tech.implementationItems = [
    { id: 'first', section: 'Design', dependsOn: [], requirementRefs: [{ document: 'GDD.md', id: 'play' }] },
    { id: 'second', section: 'Design', dependsOn: [], requirementRefs: [{ document: 'GDD.md', id: 'play' }] },
  ]
  const [first, second] = tech.implementationItems!
  first!.dependsOn = fault === 'missing' ? ['absent'] : fault === 'self' ? [first!.id]
    : fault === 'duplicate' ? [second!.id, second!.id] : [second!.id]
  if (fault === 'cycle') second!.dependsOn = [first!.id]
  await writeDesignDocumentFixture(workspace, 'GDD.md', tech)
  const check = checkDesignHandoff(workspace, PROJECT_DOCUMENTS)
  expect(check.valid).toBe(false)
  expect(check.issues.join(' ')).toContain(fault === 'self' ? 'depends on itself' : fault === 'cycle' ? 'dependency cycle' : fault === 'missing' ? 'missing dependency' : 'duplicate dependency')
}))

test('task view preserves explicit dependency order and does not invent legacy independence', () => fixture(async workspace => {
  const tech = designHandoffFixture('GDD.md')
  tech.implementationItems = [
    { id: 'first', section: 'Design', dependsOn: [], requirementRefs: [{ document: 'GDD.md', id: 'play' }] },
    { id: 'second', section: 'Design', dependsOn: [], requirementRefs: [{ document: 'GDD.md', id: 'play' }] },
  ]
  const [first, second] = tech.implementationItems!
  first!.dependsOn = []
  second!.dependsOn = [first!.id]
  await writeDesignDocumentFixture(workspace, 'GDD.md', tech)
  const view = readDesignImplementationChecklist(workspace)
  expect(view.items.find(item => item.id === first!.id)?.dependsOn).toEqual([])
  expect(view.items.find(item => item.id === second!.id)?.dependsOn).toEqual([first!.id])
  expect(view.items.map(item => item.id)).toEqual(['first', 'second'])
}))

test('a legacy technical index without tasks passes source checks without certifying completeness', () => fixture(async workspace => {
  const tech = designHandoffFixture('GDD.md')
  delete tech.implementationItems
  await writeDesignDocumentFixture(workspace, 'GDD.md', tech)
  const before = await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')
  expect(checkDesignHandoff(workspace, ['GDD.md'], { includeRequirements: true }).valid).toBe(true)
  expect(checkDesignHandoff(workspace, PROJECT_DOCUMENTS, { includeRequirements: true }).valid).toBe(true)
  const check = checkDesignHandoff(workspace, PROJECT_DOCUMENTS)
  expect(check.valid).toBe(true)
  expect(check.note).toContain('do not establish design completeness, semantic quality or acceptance')
  const checklist = readDesignImplementationChecklist(workspace)
  expect(checklist.items).toEqual([])
  expect(checklist.documents![0]).toMatchObject({ document: 'GDD.md' })
  // Optional task metadata does not make missing design sources acceptable.
  await rm(join(workspace, 'docs/GDD.md'))
  const missing = checkDesignHandoff(workspace, PROJECT_DOCUMENTS)
  expect(missing.valid).toBe(false)
  expect(missing.issues.join('; ')).toContain('GDD.md')
  expect(() => readDesignImplementationChecklist(workspace)).toThrow('GDD.md')
  expect(await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')).toBe(before)
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
  const snapshot = snapshotDesignDocuments(workspace, ['GDD.md'])
  const tech = designHandoffFixture('GDD.md')
  tech.implementationItems![0]!.id = 'renamed-task'
  await writeDesignDocumentFixture(workspace, 'GDD.md', tech)
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], snapshot).issues).toEqual([])
  expect(readDesignImplementationChecklist(workspace).designRevision).not.toBe(before.designRevision)
  expect((await readRuntimeAcceptanceReport(workspace, reportPath))?.summary).toContain('Requirement source changed: GDD.md#play')
  expect(JSON.parse(await readFile(join(workspace, designHandoffPath('GDD.md')), 'utf8')).documentVersion).toBe('1.1')
}))
