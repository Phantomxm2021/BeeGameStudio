import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { AUTHOR_BATCHES } from './project-author'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
import { checkDesignHandoff, designHandoffPath, designSupportingFiles, finalizeDesignDocuments, snapshotDesignDocuments, snapshotDesignRevisionFiles, designRevisionFileDigest, type DesignFinding, type DesignReviewResult } from './design-handoff'
import { designDocumentFixture, designHandoffFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture, prepareLegacyDesignReviewFixture } from './fixtures/layout-fixture'
import { advanceProjectDeliveryAfterTurn, beginProjectDelivery, checkProjectDesignBaseline, prepareProjectDesignReview,
  projectDeliveryStatePath, projectDesignReleaseDiagnostics, readProjectDelivery, requestProjectDesignResolution, recordProjectDesignUserDecision, projectDesignQuestionContext, recordInterruptedDesignRevision } from './project-delivery'

const finding: DesignFinding = { id: 'rule', severity: 'blocker', action: 'correct', owner: 'GDD.md',
  documents: ['GDD.md'], sources: [{ document: 'GDD.md', section: 'Design' }],
  impact: 'Technical author would have to guess outcome precedence', closeWhen: 'One explicit precedence clause with consistent consumers',
  neededBefore: 'TECHNICAL_DESIGN.md' }
async function fixture(run: (workspace: string) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-design-release-'))
  try {
    await beginProjectDelivery(workspace, workspace, 'Fixture brief')
    for (const [batch, documents] of AUTHOR_BATCHES.entries()) {
      await writeDesignDocumentsFixture(workspace, documents)
      await advanceProjectDeliveryAfterTurn(workspace, workspace, batch === 0
        ? { phase: 'author', status: 'complete', summary: '' } : undefined, batch || undefined)
    }
    await prepareLegacyDesignReviewFixture(workspace, workspace)
    await run(workspace)
  } finally { await rm(workspace, { recursive: true, force: true }) }
}
function conclude(workspace: string, review: DesignReviewResult, status: 'complete' | 'blocked' = 'complete') {
  return advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'review', status, summary: JSON.stringify(review), review })
}
const clean = (step: DesignReviewResult['step']): DesignReviewResult => ({ step, findings: [], resolved: [] })

test.each([
  ['BALANCE_DESIGN.md', 'UI_UX_SPEC.md'],
  ['AUDIO_DESIGN.md', 'ART_DIRECTION.md'],
  ['GDD.md', 'ASSET_PLAN.md'],
] as const)('initial revision can synchronize %s consumer %s missed by Inspect; Verify follows actual changes', (owner, consumer) => fixture(async workspace => {
  const issue: DesignFinding = { ...finding, owner, documents: [owner], sources: [{ document: owner, section: 'Design' }] }
  await conclude(workspace, { ...clean('inspect'), findings: [issue] })
  const state = (await readProjectDelivery(workspace, workspace))!
  expect(state.designReview!.writableDocuments).toEqual([...PROJECT_DOCUMENTS])
  expect(state.designReview!.affectedDocuments).not.toContain(consumer)
  const snapshot = snapshotDesignDocuments(workspace, state.designReview!.writableDocuments!)
  for (const name of [owner, consumer]) {
    const path = join(workspace, 'docs', name)
    const original = await readFile(path, 'utf8')
    expect(original).toContain('Fixture decision.')
    await writeFile(path, original.replace('Fixture decision.', 'Synthetic synchronized owner/consumer requirement.'))
  }
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, {
    phase: 'review', status: 'complete', summary: '', review: { ...clean('revise'), findings: [issue] },
  }, undefined, snapshot)).toMatchObject({ shouldContinue: true })
  const verify = (await readProjectDelivery(workspace, workspace))!.designReview!
  expect(verify.step).toBe('verify')
  expect(verify.writableDocuments).toEqual(expect.arrayContaining([owner, consumer]))
  expect(verify.writableDocuments).toHaveLength(2)
  expect(verify.changedSections?.[consumer]).toContain('Design')
  expect(verify.documentVersions?.[consumer]).toBe('1.1')
  expect(verify.documentVersions?.['TECHNICAL_DESIGN.md']).toBe(state.designReview!.documentVersions?.['TECHNICAL_DESIGN.md'])
  expect(await conclude(workspace, { ...clean('verify'), resolved: [{ id: issue.id, evidence: 'Inspected synthetic owner and synchronized consumer clauses.' }] }))
    .toMatchObject({ phase: 'resources', shouldContinue: true })
}))

test('blocked execution retains its actual reason instead of inventing a missing user decision', () => fixture(async workspace => {
  const blockedReason = 'The geometry checker failed to load its runtime dependency; no geometry result exists.'
  const result = await conclude(workspace, { ...clean('inspect'), blockedReason }, 'blocked')
  expect(result?.shouldContinue).toBe(false)
  expect(result?.issues.join(' ')).toContain(blockedReason)
  expect(result?.issues.join(' ')).not.toContain('requires evidence or an owner/user decision')
  const state = (await readProjectDelivery(workspace, workspace))!
  expect(state.designBaseline).toBeUndefined()
  expect(state.lastValidationFailure).toContain(blockedReason)
}))

test('interrupted authorized revision resumes exact bytes and keeps its original version baseline', () => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  const prepared = (await readProjectDelivery(workspace, workspace))!
  const snapshot = snapshotDesignDocuments(workspace, prepared.designReview!.writableDocuments!)
  const before = snapshotDesignRevisionFiles(workspace)
  const path = join(workspace, 'docs/GDD.md')
  await writeFile(path, (await readFile(path, 'utf8')) + '\nAuthorized partial correction.\n')
  await recordInterruptedDesignRevision(workspace, workspace, prepared, snapshot, { before, completed: {} })
  await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('Design changed')
  await recordInterruptedDesignRevision(workspace, workspace, prepared, snapshot,
    { before, completed: { 'docs/GDD.md': designRevisionFileDigest(workspace, 'docs/GDD.md') } })
  const resumed = (await prepareProjectDesignReview(workspace, workspace))!
  expect(resumed.designReview!.revision).toBe(prepared.designReview!.revision)
  expect(resumed.designReview!.step).toBe('revise')
  const saved = await readFile(path, 'utf8')
  await writeFile(path, saved + '\nExternal edit after settlement.\n')
  await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('Design changed')
  await writeFile(path, saved)
  // Layout binding changes are intentionally excluded from the design digest,
  // but interrupted-write attribution must still bind the exact saved bytes.
  const uiPath = join(workspace, 'content/ui/menu.json'), uiSaved = await readFile(uiPath, 'utf8')
  const ui = JSON.parse(uiSaved)
  ui.assetRefs = ['unobserved-binding']
  await writeFile(uiPath, JSON.stringify(ui))
  await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('Design changed')
  await writeFile(uiPath, uiSaved)
  const now = snapshotDesignDocuments(workspace, resumed.designReview!.writableDocuments!)
  // No further edits needed: finalization must still count the earlier partial edit.
  const review = { ...clean('revise'), findings: [finding] }
  expect((await advanceProjectDeliveryAfterTurn(workspace, workspace,
    { phase: 'review', status: 'complete', summary: '', review }, undefined, now))?.shouldContinue).toBe(true)
  expect((await readProjectDelivery(workspace, workspace))?.designReview?.documentVersions?.['GDD.md']).toBe('1.1')
  expect((await readProjectDelivery(workspace, workspace))?.designReview?.interruptedWrite).toBeUndefined()
}))

test('interrupted post-release revision does not authorize a changed document outside its recorded scope', () => fixture(async workspace => {
  await conclude(workspace, clean('inspect'))
  await requestProjectDesignResolution(workspace, workspace, { mode: 'revise', instruction: 'Correct only the recorded rule.', findings: [finding] })
  const prepared = (await readProjectDelivery(workspace, workspace))!
  const snapshot = snapshotDesignDocuments(workspace, prepared.designReview!.writableDocuments!)
  const before = snapshotDesignRevisionFiles(workspace)
  const path = join(workspace, 'docs/AUDIO_DESIGN.md')
  await writeFile(path, (await readFile(path, 'utf8')) + '\nUnauthorized change.\n')
  await recordInterruptedDesignRevision(workspace, workspace, prepared, snapshot,
    { before, completed: { 'docs/AUDIO_DESIGN.md': designRevisionFileDigest(workspace, 'docs/AUDIO_DESIGN.md') } })
  await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('Design changed')
}))

test.each(['unobserved-index', 'post-write-edit', 'observed-index'] as const)(
  'interrupted recovery checks individual files and completed bytes: %s', mode => fixture(async workspace => {
    await conclude(workspace, { ...clean('inspect'), findings: [finding] })
    const prepared = (await readProjectDelivery(workspace, workspace))!
    const snapshot = snapshotDesignDocuments(workspace, prepared.designReview!.writableDocuments!)
    const before = snapshotDesignRevisionFiles(workspace)
    const path = join(workspace, 'docs/GDD.md')
    await writeFile(path, (await readFile(path, 'utf8')) + '\nObserved correction.\n')
    const completed: Record<string, string | null> = { 'docs/GDD.md': designRevisionFileDigest(workspace, 'docs/GDD.md') }
    if (mode === 'post-write-edit') {
      await writeFile(path, (await readFile(path, 'utf8')) + '\nUnobserved later change.\n')
    } else {
      const indexPath = designHandoffPath('GDD.md')
      const raw = JSON.parse(await readFile(join(workspace, indexPath), 'utf8'))
      raw.outputs[0].acceptance.method = 'inspection'
      await writeFile(join(workspace, indexPath), JSON.stringify(raw))
      if (mode === 'observed-index') completed[indexPath] = designRevisionFileDigest(workspace, indexPath)
    }
    await recordInterruptedDesignRevision(workspace, workspace, prepared, snapshot, { before, completed })
    if (mode === 'observed-index') {
      expect((await prepareProjectDesignReview(workspace, workspace))?.designReview?.step).toBe('revise')
      // Another interrupted turn with no new writes retains the first version baseline.
      const resumed = (await readProjectDelivery(workspace, workspace))!
      await recordInterruptedDesignRevision(workspace, workspace, resumed,
        snapshotDesignDocuments(workspace, resumed.designReview!.writableDocuments!),
        { before: snapshotDesignRevisionFiles(workspace), completed: {} })
      expect((await readProjectDelivery(workspace, workspace))?.designReview?.interruptedWrite?.before).toEqual(snapshot)
    } else {
      expect((await readProjectDelivery(workspace, workspace))?.designReview?.interruptedWrite).toBeUndefined()
      await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('Design changed')
    }
  }))

test('legacy interrupted checkpoints cannot silently acquire missing file evidence', () => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  const state = (await readProjectDelivery(workspace, workspace))!
  state.designReview!.interruptedWrite = { revision: state.designReview!.revision,
    snapshots: state.designReview!.snapshots, before: snapshotDesignDocuments(workspace, ['GDD.md']) }
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify(state))
  await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('lacks per-file write evidence')
}))

test('an invalid evidence path can be removed without reading outside the revision workspace', () => fixture(async workspace => {
  const indexPath = designHandoffPath('GDD.md')
  const index = JSON.parse(await readFile(join(workspace, indexPath), 'utf8'))
  index.evidence = [{ path: '../outside-revision.json' }]
  await writeFile(join(workspace, indexPath), JSON.stringify(index))
  const snapshot = snapshotDesignRevisionFiles(workspace)
  expect(Object.hasOwn(snapshot, '../outside-revision.json')).toBe(false)
  expect(snapshot[indexPath]).toBe(designRevisionFileDigest(workspace, indexPath))
  expect(() => designRevisionFileDigest(workspace, '../outside-revision.json')).toThrow('inside the workspace')
}))

test('an empty Review cannot release a missing planned Scene; exact owner repair is versioned and then verified', () => fixture(async workspace => {
  const path = join(workspace, 'content/scenes/level.json'), source = await readFile(path, 'utf8')
  const current = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...current, designReview: undefined }))
  await rm(path)
  await prepareLegacyDesignReviewFixture(workspace, workspace)
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ phase: 'review', shouldContinue: true })
  const pending = (await readProjectDelivery(workspace, workspace))!
  expect(pending.designBaseline).toBeUndefined()
  expect(pending.designReview!.affectedDocuments).toEqual(['LEVEL_SCENE_DESIGN.md', 'TECHNICAL_DESIGN.md'])
  expect(pending.designReview!.writableDocuments).toEqual([...PROJECT_DOCUMENTS])
  expect(designSupportingFiles(workspace, pending.designReview!.affectedDocuments!)).toEqual(['content/scenes/level.json'])
  const snapshot = snapshotDesignDocuments(workspace, ['LEVEL_SCENE_DESIGN.md'])
  await writeFile(path, source)
  expect(finalizeDesignDocuments(workspace, ['LEVEL_SCENE_DESIGN.md'], snapshot).issues).toEqual([])
  expect((await conclude(workspace, clean('revise')))?.shouldContinue).toBe(true)
  expect(await conclude(workspace, clean('verify'))).toMatchObject({ phase: 'resources' })
  const released = (await readProjectDelivery(workspace, workspace))!
  expect(released.designBaseline!.documentVersions!['LEVEL_SCENE_DESIGN.md']).toBe('1.1')
  const scene = JSON.parse(source)
  scene.data.nodes[1].transform.position[0] += 10
  await writeFile(path, JSON.stringify(scene))
  expect(checkProjectDesignBaseline(workspace, released).length).toBeGreaterThan(0)
}))

test('live UI evidence forces scoped revision even when the model finds nothing; bindings remain editable after repair', () => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designReview: undefined }))
  const indexPath = join(workspace, '.beegame/design-handoffs/UI_UX_SPEC.json')
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  const uiPath = join(workspace, 'content/ui/menu.json')
  const ui = JSON.parse(await readFile(uiPath, 'utf8'))
  index.evidence = [{ id: 'ui-kind', kind: 'contract', path: 'content/ui/menu.json',
    source: 'Synthetic layout', section: 'Design', pointer: '/kind', expected: 'ui-screen',
    sha256: createHash('sha256').update(await readFile(uiPath)).digest('hex') }]
  await writeFile(indexPath, JSON.stringify(index))
  await prepareLegacyDesignReviewFixture(workspace, workspace)
  expect(projectDesignReleaseDiagnostics(workspace, (await readProjectDelivery(workspace, workspace))!).join(' ')).toContain('Live UI source')
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({ step: 'revise', affectedDocuments: ['UI_UX_SPEC.md', 'TECHNICAL_DESIGN.md'] })
  // Synthetic owner revision, not a manual correction of a paid project.
  const snapshot = snapshotDesignDocuments(workspace, ['UI_UX_SPEC.md'])
  index.evidence = []
  await writeFile(indexPath, JSON.stringify(index))
  expect(finalizeDesignDocuments(workspace, ['UI_UX_SPEC.md'], snapshot).issues).toEqual([])
  expect((await conclude(workspace, clean('revise')))?.shouldContinue).toBe(true)
  expect(await conclude(workspace, clean('verify'))).toMatchObject({ phase: 'resources', shouldContinue: true })
  const released = (await readProjectDelivery(workspace, workspace))!
  expect(released.designBaseline?.documentVersions?.['UI_UX_SPEC.md']).toBe('1.1')
  ui.assetRefs = ['delivered-texture']
  ui.data.nodes[1].actions = { click: 'start' }
  ui.data.nodes[1].bindings = { enabled: 'canStart' }
  ui.data.nodes[1].data = { font: { assetRef: 'delivered-font' } }
  await writeFile(uiPath, JSON.stringify(ui))
  expect(checkProjectDesignBaseline(workspace, released)).toEqual([])
  ui.data.nodes[1].layout.size[1] = 60
  await writeFile(uiPath, JSON.stringify(ui))
  expect(checkProjectDesignBaseline(workspace, released).length).toBeGreaterThan(0)
}))

test.each([false, true])('Review enforces UI calculation despite zero model findings; repair=%s', repair => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designReview: undefined }))
  const path = join(workspace, 'content/ui/menu.json')
  const ui = JSON.parse(await readFile(path, 'utf8'))
  ui.data.nodes[1].layout.size[1] = 25
  await writeFile(path, JSON.stringify(ui))
  await prepareLegacyDesignReviewFixture(workspace, workspace)
  expect(projectDesignReleaseDiagnostics(workspace, (await readProjectDelivery(workspace, workspace))!).join(' ')).toContain('minimumControlSize')
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({ step: 'revise', affectedDocuments: ['UI_UX_SPEC.md', 'TECHNICAL_DESIGN.md'] })
  if (repair) {
    const before = snapshotDesignDocuments(workspace, ['UI_UX_SPEC.md'])
    ui.data.nodes[1].layout.size[1] = 52
    await writeFile(path, JSON.stringify(ui))
    // A changed retained input must advance its owner version, even with unchanged prose.
    expect(finalizeDesignDocuments(workspace, ['UI_UX_SPEC.md'], before).issues).toEqual([])
  }
  const revised = await conclude(workspace, clean('revise'))
  if (!repair) {
    expect(revised?.shouldContinue).toBe(false)
    expect(revised?.issues.join(' ')).toContain('minimumControlSize')
    expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
  } else {
    expect(revised?.shouldContinue).toBe(true)
    expect(await conclude(workspace, clean('verify'))).toMatchObject({ phase: 'resources', shouldContinue: true })
    expect((await readProjectDelivery(workspace, workspace))?.designBaseline?.documentVersions?.['UI_UX_SPEC.md']).toBe('1.1')
  }
}))

test('missing UI calculation input cannot be released by an empty Review result', () => fixture(async workspace => {
  await rm(join(workspace, 'content/ui/menu.json'))
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designReview: undefined }))
  await prepareLegacyDesignReviewFixture(workspace, workspace)
  const result = await conclude(workspace, clean('inspect'))
  expect(result?.phase).toBe('review')
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
  expect((await readProjectDelivery(workspace, workspace))?.designReview?.writableDocuments).toContain('UI_UX_SPEC.md')
  expect(designSupportingFiles(workspace, ['UI_UX_SPEC.md'])).toEqual(['content/ui/menu.json'])
  const snapshot = snapshotDesignDocuments(workspace, ['UI_UX_SPEC.md'])
  await writeDesignDocumentFixture(workspace, 'UI_UX_SPEC.md')
  expect(finalizeDesignDocuments(workspace, ['UI_UX_SPEC.md'], snapshot).issues).toEqual([])
  expect((await conclude(workspace, clean('revise')))?.shouldContinue).toBe(true)
  expect(await conclude(workspace, clean('verify'))).toMatchObject({ phase: 'resources', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline?.documentVersions?.['UI_UX_SPEC.md']).toBe('1.1')
}))
test.each([false, true])('independent diagnostics reach one bounded revision; partial repair=%s', partial => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designReview: undefined }))
  const invalid = { ...designHandoffFixture('GDD.md'), outputs: [{ id: 'ready', section: 'Missing section' }] }
  await writeDesignDocumentFixture(workspace, 'GDD.md', invalid)
  await prepareLegacyDesignReviewFixture(workspace, workspace)
  const inspected = (await readProjectDelivery(workspace, workspace))!
  const diagnostics = projectDesignReleaseDiagnostics(workspace, inspected).join('; ')
  expect(diagnostics).toContain('output ready references an absent section')
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({ step: 'revise', affectedDocuments: ['GDD.md', 'TECHNICAL_DESIGN.md'] })
  await writeDesignDocumentFixture(workspace, 'GDD.md', partial
    ? { ...invalid, documentVersion: '1.1' }
    : { ...designHandoffFixture('GDD.md'), documentVersion: '1.1' })
  expect(await conclude(workspace, clean('revise'))).toMatchObject({ shouldContinue: !partial })
  if (partial) {
    expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({ step: 'revise', stopped: true })
    expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
  } else {
    expect((await readProjectDelivery(workspace, workspace))?.designReview?.step).toBe('verify')
    expect(await conclude(workspace, clean('verify'))).toMatchObject({ phase: 'resources', shouldContinue: true })
    expect((await readProjectDelivery(workspace, workspace))?.designHistory?.map(x => x.step)).toEqual(['inspect', 'revise', 'verify'])
  }
}))
test.each([false, true])('deterministic failures get one scoped revision independently of model findings, follow-up=%s', followUp => fixture(async workspace => {
  // Synthetic documents only: reproduce a forbidden role table without
  // using or modifying the paid project's products or expected prose.
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designReview: undefined }))
  await writeDesignDocumentFixture(workspace, 'GDD.md', { ...designHandoffFixture('GDD.md'),
    outputs: [{ id: 'ready', section: 'Missing section' }] })
  await prepareLegacyDesignReviewFixture(workspace, workspace)
  const findings: DesignFinding[] = followUp ? [{ ...finding, id: 'format', severity: 'follow-up', neededBefore: null }] : []
  expect(await conclude(workspace, { ...clean('inspect'), findings })).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({
    step: 'revise', affectedDocuments: ['GDD.md', 'TECHNICAL_DESIGN.md'], findings,
  })
  await writeDesignDocumentFixture(workspace, 'GDD.md', { ...designHandoffFixture('GDD.md'), documentVersion: '1.1' })
  expect(await conclude(workspace, { ...clean('revise'), findings })).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designReview?.step).toBe('verify')
  expect(await conclude(workspace, { ...clean('verify'), findings })).toMatchObject({ phase: 'resources', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designHistory?.map(x => x.step)).toEqual(['inspect', 'revise', 'verify'])
}))
test('an uncorrected deterministic-only revision stops rather than relaunching or passing', () => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designReview: undefined }))
  await writeFile(join(workspace, '.beegame/design-handoffs/GDD.json'), '{broken}')
  await prepareLegacyDesignReviewFixture(workspace, workspace)
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ shouldContinue: true })
  expect(await conclude(workspace, clean('revise'))).toMatchObject({ shouldContinue: false })
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({ step: 'revise', stopped: true })
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
  await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('stopped')
}))
test('a saved index failure labels original semantic findings as unverified, not newly failed', () => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  const state = (await readProjectDelivery(workspace, workspace))!
  const snapshot = snapshotDesignDocuments(workspace, state.designReview!.writableDocuments!)
  await writeFile(join(workspace, 'docs/GDD.md'), (await readFile(join(workspace, 'docs/GDD.md'), 'utf8')) + '\nSource correction saved; not yet independently verified.\n')
  await writeFile(join(workspace, designHandoffPath('GDD.md')), JSON.stringify({ ...designHandoffFixture('GDD.md'), document: 'Unexpected field' }))
  const result = await advanceProjectDeliveryAfterTurn(workspace, workspace,
    { phase: 'review', status: 'complete', summary: '', review: { ...clean('revise'), findings: [finding] } }, undefined, snapshot)
  expect(result?.shouldContinue).toBe(false)
  expect(result?.issues[0]).toContain('fails saved handoff checks')
  expect(result?.issues[0]).toContain('document')
  expect(result?.issues[0]).not.toContain(finding.impact)
  expect(result?.issues[1]).toContain('awaiting targeted verification')
  expect(result?.issues[1]).toContain('not revalidated by this failure')
  expect(result?.issues[2]).toContain(finding.id + ': owner')
  const stopped = (await readProjectDelivery(workspace, workspace))!
  expect(stopped.designReview).toMatchObject({ step: 'revise', stopped: true, findings: [finding] })
  expect(stopped.lastValidationFailure).toBe(result?.issues[0])
  expect(stopped.designBaseline).toBeUndefined()
}))
test('deterministic repair cannot skip its version increase', () => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designReview: undefined }))
  await writeDesignDocumentFixture(workspace, 'GDD.md', { ...designHandoffFixture('GDD.md'), outputs: [{ id: 'ready', section: 'Missing section' }] })
  await prepareLegacyDesignReviewFixture(workspace, workspace)
  await conclude(workspace, clean('inspect'))
  // Even a sidecar-only correction is versioned; an empty finding list is
  // not permission to silently change the inspected baseline.
  await writeDesignDocumentFixture(workspace, 'GDD.md')
  const result = await conclude(workspace, clean('revise'))
  expect(result?.shouldContinue).toBe(false)
  expect(result?.issues.join(' ')).toContain('version must increase')
}))
test('host reports receipt field errors and never releases an invalid review', () => fixture(async workspace => {
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'review', status: 'complete', summary: '',
    validationIssues: ['Review receipt findings.2.sources.0.document: invalid document'] })).toMatchObject({
      shouldContinue: false, issues: ['Review has no valid version-bound result for its current step.',
        'Review receipt findings.2.sources.0.document: invalid document'] })
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
}))
test('clean inspect releases a byte-bound baseline without needless revision', () => fixture(async workspace => {
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ phase: 'resources', shouldContinue: true })
  const state = (await readProjectDelivery(workspace, workspace))!
  expect(state.authorBatch).toBe(AUTHOR_BATCHES.length - 1)
  expect(state.designBaseline?.snapshots['GDD.md']).toHaveLength(64)
  expect(state.designHistory).toHaveLength(1)
}))
test('inspect → one grouped revise → independent targeted verify; closures retained', () => fixture(async workspace => {
  expect(await conclude(workspace, { ...clean('inspect'), findings: [finding] })).toMatchObject({ shouldContinue: true, phase: 'review' })
  expect((await prepareProjectDesignReview(workspace, workspace))?.designReview?.step).toBe('revise')
  const file = join(workspace, 'docs/GDD.md')
  await writeDesignDocumentFixture(workspace, 'GDD.md', { ...designHandoffFixture('GDD.md'), documentVersion: '1.1' }, (await readFile(file, 'utf8')).replace('v1.0', 'v1.1') + '\nPrecedence explicitly corrected.\n')
  expect(await conclude(workspace, { ...clean('revise'), findings: [finding] })).toMatchObject({ shouldContinue: true })
  expect((await prepareProjectDesignReview(workspace, workspace))?.designReview?.step).toBe('verify')
  expect(await conclude(workspace, { ...clean('verify'), resolved: [{ id: finding.id, evidence: 'Checked corrected Design clause against original required rule.' }] })).toMatchObject({ phase: 'resources', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designHistory?.map(event => event.step)).toEqual(['inspect', 'revise', 'verify'])
}))
test('host rejects an invalid saved revision even when the reviser submits without calling a checker', () => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  // Isolated fixture: no agent checker was invoked. The host must run its
  // own saved-byte validation rather than trusting the revision receipt.
  await writeDesignDocumentFixture(workspace, 'GDD.md', {
    ...designHandoffFixture('GDD.md'), documentVersion: '1.1', outputs: [{ id: 'ready', section: 'Missing section' }],
  })
  const result = await conclude(workspace, { ...clean('revise'), findings: [finding] })
  expect(result).toMatchObject({ phase: 'review', shouldContinue: false })
  expect(result?.issues.join(' ')).toContain('still fails deterministic checks')
  const state = (await readProjectDelivery(workspace, workspace))!
  expect(state.designReview).toMatchObject({ step: 'revise', stopped: true })
  expect(state.designBaseline).toBeUndefined()
}))
test.each(['1.0', '0.9'])('revision cannot change prose or machine handoff while keeping/decreasing version to %s', version => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  await writeDesignDocumentFixture(workspace, 'GDD.md', { ...designHandoffFixture('GDD.md'), documentVersion: version, limits: ['Revised limit'] },
    designDocumentFixture('GDD.md', { documentVersion: version }) + '\nCorrected rule\n')
  const result = await conclude(workspace, { ...clean('revise'), findings: [finding] })
  expect(result?.shouldContinue).toBe(false)
  expect(result?.issues.join(' ')).toContain('version must increase from 1.0')
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
}))
test('explicit owner verification cannot bypass version increases', () => fixture(async workspace => {
  await conclude(workspace, clean('inspect'))
  await writeFile(join(workspace, 'docs/GDD.md'), designDocumentFixture('GDD.md') + '\nCorrected rule\n')
  await expect(requestProjectDesignResolution(workspace, workspace, { mode: 'verify', instruction: 'Verify the corrected rule.', findings: [finding] }))
    .rejects.toThrow('version must increase from 1.0')
}))
test('a retained calculation-only correction requires its document version to increase', () => fixture(async workspace => {
  await mkdir(join(workspace, 'docs/calc'), { recursive: true })
  await writeFile(join(workspace, 'docs/calc/model.mjs'), 'export default {}')
  await writeFile(join(workspace, 'docs/GDD.md'), designDocumentFixture('GDD.md') + '\n[Model](calc/model.mjs)\n')
  // Restart this synthetic fixture's initial handoff before inspecting the new citation.
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designReview: undefined }))
  await prepareLegacyDesignReviewFixture(workspace, workspace)
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  await writeFile(join(workspace, 'docs/calc/model.mjs'), 'export default { corrected: true }')
  const result = await conclude(workspace, { ...clean('revise'), findings: [finding] })
  expect(result?.shouldContinue).toBe(false)
  expect(result?.issues.join(' ')).toContain('version must increase from 1.0')
}))
test('available source-backed evidence repair enters one scoped revision, then read-only verification', () => fixture(async workspace => {
  // Synthetic saved-record error, not a model classification test or a paid
  // project repair. The decision/input already exists; no new fact is chosen.
  await mkdir(join(workspace, 'docs/calc'), { recursive: true })
  await writeFile(join(workspace, 'docs/calc/input.json'), '{"value":7}')
  await writeFile(join(workspace, 'docs/calc/result.md'), 'Required check failed: invalid invocation.\n')
  const body = designDocumentFixture('GDD.md') + '\n[Input](calc/input.json)\n[Result](calc/result.md)\n'
  await writeFile(join(workspace, 'docs/GDD.md'), body)
  const initial = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...initial, designReview: undefined }))
  await prepareLegacyDesignReviewFixture(workspace, workspace)
  const savedEvidence: DesignFinding = { ...finding, id: 'saved-evidence',
    impact: 'Saved result reports failure despite available source-backed input and a successful authorized check',
    closeWhen: 'Regenerate the saved result from the unchanged input, preserving check scope and increasing the owning document version' }
  expect(await conclude(workspace, { ...clean('inspect'), findings: [savedEvidence] })).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({ step: 'revise', affectedDocuments: ['GDD.md', 'TECHNICAL_DESIGN.md'] })
  expect(await readFile(join(workspace, 'docs/calc/result.md'), 'utf8')).toContain('check failed')
  await writeFile(join(workspace, 'docs/calc/result.md'), 'Synthetic successful check: value 7; runtime not verified.\n')
  await writeDesignDocumentFixture(workspace, 'GDD.md', { ...designHandoffFixture('GDD.md'), documentVersion: '1.1' }, body.replace('v1.0', 'v1.1'))
  expect(await conclude(workspace, { ...clean('revise'), findings: [savedEvidence] })).toMatchObject({ shouldContinue: true })
  const verification = (await prepareProjectDesignReview(workspace, workspace))!
  expect(verification.designReview?.step).toBe('verify')
  const savedBytes = await readFile(join(workspace, 'docs/calc/result.md'), 'utf8')
  expect(await conclude(workspace, { ...clean('verify'), resolved: [{ id: savedEvidence.id, evidence: savedBytes }] })).toMatchObject({ phase: 'resources', shouldContinue: true })
  expect(await readFile(join(workspace, 'docs/calc/input.json'), 'utf8')).toBe('{"value":7}')
  expect(await readFile(join(workspace, 'docs/calc/result.md'), 'utf8')).toBe(savedBytes)
  const final = (await readProjectDelivery(workspace, workspace))!
  expect(final.designHistory?.map(event => event.step)).toEqual(['inspect', 'revise', 'verify'])
  expect(final.designBaseline?.documentVersions?.['GDD.md']).toBe('1.1')
}))
test('shrinking real layout failures continues the existing revision; unchanged failures stop', () => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  const path = join(workspace, 'content/ui/menu.json')
  const ui = JSON.parse(await readFile(path, 'utf8'))
  ui.data.nodes[1].layout.size[1] = 20
  ui.data.nodes.push({ ...structuredClone(ui.data.nodes[1]), id: 'second-action', layout: { anchor: 'top-left', size: [200, 20] } })
  await writeFile(path, JSON.stringify(ui))
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designReview: undefined }))
  await prepareLegacyDesignReviewFixture(workspace, workspace)
  await conclude(workspace, clean('inspect'))
  const before = snapshotDesignDocuments(workspace, PROJECT_DOCUMENTS)
  ui.data.nodes[1].layout.size[1] = 52
  await writeFile(path, JSON.stringify(ui))
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace,
    { phase: 'review', status: 'complete', summary: '', review: clean('revise') }, undefined, before))
    .toMatchObject({ shouldContinue: true })
  const resumed = (await prepareProjectDesignReview(workspace, workspace))!
  expect(resumed.designReview!.step).toBe('revise')
  expect(resumed.designReview!.pendingCheckIssues!.join(' ')).toContain('second-action')
  expect(resumed.designBaseline).toBeUndefined()
  expect(await conclude(workspace, clean('revise'))).toMatchObject({ shouldContinue: false })
  expect((await readProjectDelivery(workspace, workspace))!.lastValidationFailure).toContain('without confirmed progress')
}))

test('verification without confirmed progress stops; no silent retry or reset', () => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  await conclude(workspace, { ...clean('revise'), findings: [finding] })
  expect(await conclude(workspace, { ...clean('verify'), findings: [finding] })).toMatchObject({ shouldContinue: false })
  await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('stopped')
  expect(await conclude(workspace, clean('verify'))).toMatchObject({ shouldContinue: false })
  const state = await requestProjectDesignResolution(workspace, workspace, { mode: 'revise', instruction: 'Owner decides outcome A takes precedence; correct only related clauses.', findings: [finding] })
  expect(state.designReview).toMatchObject({ step: 'revise', findings: [finding] })
  expect(state.designBaseline).toBeUndefined()
}))
test('verified partial closure resumes only remaining corrections and releases only after independent closure', () => fixture(async workspace => {
  const uiIssue: DesignFinding = { ...finding, id: 'ui-rule', owner: 'UI_UX_SPEC.md', documents: ['UI_UX_SPEC.md'],
    sources: [{ document: 'UI_UX_SPEC.md', section: 'Design' }] }
  await conclude(workspace, { ...clean('inspect'), findings: [finding, uiIssue] })
  await writeDesignDocumentFixture(workspace, 'GDD.md', { ...designHandoffFixture('GDD.md'), documentVersion: '1.1' },
    designDocumentFixture('GDD.md', { documentVersion: '1.1' }) + '\nCorrected rule.\n')
  await conclude(workspace, { ...clean('revise'), findings: [finding, uiIssue] })
  expect(await conclude(workspace, { ...clean('verify'), findings: [uiIssue],
    resolved: [{ id: finding.id, evidence: 'Checked the corrected rule against the confirmed requirement.' }] }))
    .toMatchObject({ phase: 'review', shouldContinue: true })
  const resumed = (await prepareProjectDesignReview(workspace, workspace))!
  expect(resumed.designReview!.step).toBe('revise')
  expect(resumed.designReview!.findings).toEqual([uiIssue])
  expect(resumed.designReview!.affectedDocuments).not.toContain('GDD.md')
  expect(resumed.designBaseline).toBeUndefined()
  await writeDesignDocumentFixture(workspace, 'UI_UX_SPEC.md', { ...designHandoffFixture('UI_UX_SPEC.md'), documentVersion: '1.1' })
  await conclude(workspace, { ...clean('revise'), findings: [uiIssue] })
  expect(await conclude(workspace, { ...clean('verify'), resolved: [{ id: uiIssue.id, evidence: 'Checked corrected UI clause and consumer.' }] }))
    .toMatchObject({ phase: 'resources', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))!.designHistory!.map(event => event.step))
    .toEqual(['inspect', 'revise', 'verify', 'revise', 'verify'])
}))

test('new factual evidence gaps stop even when another issue was closed', () => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  await conclude(workspace, { ...clean('revise'), findings: [finding] })
  const evidence: DesignFinding = { ...finding, id: 'fact', action: 'evidence' }
  expect(await conclude(workspace, { ...clean('verify'), findings: [evidence],
    resolved: [{ id: finding.id, evidence: 'Checked actual rule.' }] })).toMatchObject({ shouldContinue: false })
  expect((await readProjectDelivery(workspace, workspace))!.lastValidationFailure).toContain('factual evidence is unavailable')
}))

test('a continuing published revision cannot expand its original grant to a newly found consumer', () => fixture(async workspace => {
  await conclude(workspace, clean('inspect'))
  await requestProjectDesignResolution(workspace, workspace, { mode: 'revise', instruction: 'Correct only the reported rule.', findings: [finding] })
  await writeDesignDocumentFixture(workspace, 'GDD.md', { ...designHandoffFixture('GDD.md'), documentVersion: '1.1' })
  await conclude(workspace, { ...clean('revise'), findings: [finding] })
  const newIssue: DesignFinding = { ...finding, id: 'new-ui', owner: 'UI_UX_SPEC.md', documents: ['UI_UX_SPEC.md'],
    sources: [{ document: 'UI_UX_SPEC.md', section: 'Design' }] }
  const result = await conclude(workspace, { ...clean('verify'), findings: [newIssue], resumeFrom: 'implementation',
    resolved: [{ id: finding.id, evidence: 'Corrected rule invalidates its implementation, not assets or content bindings.' }] })
  expect(result?.shouldContinue).toBe(false)
  expect(result?.issues.join(' ')).toContain('authorized published-design change scope')
}))
test('updated remaining impact in verification is accepted as a blocker, not a formatting failure or PASS', () => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  await conclude(workspace, { ...clean('revise'), findings: [finding] })
  const result = await conclude(workspace, { ...clean('verify'), findings: [{ ...finding, impact: 'Source partly corrected, consumer still has conflicting requirement' }] })
  expect(result?.shouldContinue).toBe(false)
  expect(result?.issues.join(' ')).toContain('Targeted verification still has blockers')
  expect(result?.issues.join(' ')).not.toContain('cannot be redefined')
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
}))
test.each(['evidence'] as const)('unavailable %s stops without automatic correction or retry', action => fixture(async workspace => {
  const unresolved: DesignFinding = { ...finding, action,
    impact: 'Required platform fact cannot be established from available sources or authorized checks',
    closeWhen: 'Owner supplies authoritative evidence or an authorized capability result' }
  expect(await conclude(workspace, { ...clean('inspect'), findings: [unresolved] })).toMatchObject({ shouldContinue: false })
  const stopped = (await readProjectDelivery(workspace, workspace))!
  expect(stopped.designReview).toMatchObject({ step: 'inspect', stopped: true, findings: [unresolved] })
  expect(stopped.designBaseline).toBeUndefined()
  await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('stopped')
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ shouldContinue: false })
  expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(designDocumentFixture('GDD.md'))
}))
test('professional decide enters scoped Revision and requires independent verification', () => fixture(async workspace => {
  const choice: DesignFinding = { ...finding, action: 'decide', owner: 'LEVEL_SCENE_DESIGN.md', documents: ['LEVEL_SCENE_DESIGN.md', 'BALANCE_DESIGN.md'],
    sources: [{ document: 'LEVEL_SCENE_DESIGN.md', section: 'Design' }], impact: 'A professional route and its tuning reference disagree', closeWhen: 'Owner selects and aligns a legal route within the agreed rules' }
  expect(await conclude(workspace, { ...clean('inspect'), findings: [choice] })).toMatchObject({ shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({ step: 'revise',
    affectedDocuments: ['LEVEL_SCENE_DESIGN.md', 'BALANCE_DESIGN.md', 'TECHNICAL_DESIGN.md'] })
  expect(await conclude(workspace, { ...clean('revise'), findings: [choice] })).toMatchObject({ shouldContinue: true, phase: 'review' })
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
  expect(await conclude(workspace, { ...clean('verify'), resolved: [{ id: choice.id, evidence: 'Checked actual source and consumers' }] })).toMatchObject({ phase: 'resources' })
}))

const userChoice: DesignFinding = { ...finding, action: 'decide', owner: 'user', impact: 'Proposed correction changes a confirmed requirement', closeWhen: 'User selects a direction, sources align and independent verification checks the correction' }
test('missing user answer cannot complete Revision or be invented in its receipt', () => fixture(async workspace => {
  expect(await conclude(workspace, { ...clean('inspect'), findings: [userChoice] })).toMatchObject({ shouldContinue: true })
  const result = await conclude(workspace, { ...clean('revise'), findings: [userChoice] })
  expect(result?.issues.join(' ')).toContain('no validated answer')
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
}))
test('human answer is version-bound, survives preparation and authorizes revision, not closure', () => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [userChoice] })
  const revision = (await readProjectDelivery(workspace, workspace))!.designReview!.revision
  const input = { questions: [{ header: userChoice.id, question: 'Keep the confirmed feature?' }], answers: { 'Keep the confirmed feature?': 'Keep it' } }
  await expect(recordProjectDesignUserDecision(workspace, workspace, 'stale', 'question', input)).rejects.toThrow('stale')
  await expect(recordProjectDesignUserDecision(workspace, workspace, revision, 'question', { ...input, answers: {} })).rejects.toThrow('Answer every question')
  await recordProjectDesignUserDecision(workspace, workspace, revision, 'question', input)
  const resumed = await prepareProjectDesignReview(workspace, workspace)
  expect(resumed?.designReview?.userDecisions).toEqual([{ id: userChoice.id, revision, toolUseID: 'question', question: 'Keep the confirmed feature?', answer: 'Keep it' }])
  await expect(recordProjectDesignUserDecision(workspace, workspace, revision, 'question', input)).rejects.toThrow('already answered')
  expect(resumed?.designBaseline).toBeUndefined()
  await conclude(workspace, { ...clean('revise'), findings: [userChoice] })
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
  expect(await conclude(workspace, { ...clean('verify'), findings: [userChoice] })).toMatchObject({ shouldContinue: false })
  expect((await readProjectDelivery(workspace, workspace))?.designHistory?.find(h => h.step === 'revise')?.userDecisions?.[0]?.answer).toBe('Keep it')
}))
test('Revision registers a newly discovered decision after edits and retains it for independent verification', () => fixture(async workspace => {
  const newChoice = { ...userChoice, id: 'new-choice' }
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  const revision = (await readProjectDelivery(workspace, workspace))!.designReview!.revision
  const path = join(workspace, 'docs/GDD.md')
  const snapshot = snapshotDesignDocuments(workspace, ['GDD.md'])
  await writeFile(path, (await readFile(path, 'utf8')) + '\nSource correction before discovering the choice.\n')
  const context = await projectDesignQuestionContext(workspace, workspace, revision)
  expect(context.sourceRevision).not.toBe(revision)
  const input = { questions: [{ header: newChoice.id, question: 'Keep the confirmed feature?' }],
    metadata: { designFindings: [newChoice] }, answers: { 'Keep the confirmed feature?': 'Keep it' } }
  await recordProjectDesignUserDecision(workspace, workspace, revision, 'new-q', input, context.sourceRevision)
  const saved = (await readProjectDelivery(workspace, workspace))!
  expect(saved.designReview!.findings).toEqual([finding, newChoice])
  expect(saved.designReview!.userDecisions![0]).toMatchObject({ id: newChoice.id, revision, sourceRevision: context.sourceRevision })
  expect(saved.designReview!.affectedDocuments).not.toContain('ART_DIRECTION.md')
  expect(finalizeDesignDocuments(workspace, ['GDD.md'], snapshot).issues).toEqual([])
  expect(await conclude(workspace, { ...clean('revise'), findings: [finding, newChoice] })).toMatchObject({ shouldContinue: true })
  const verifying = (await readProjectDelivery(workspace, workspace))!.designReview!
  expect(verifying.findings).toEqual([finding, newChoice])
  expect((await readProjectDelivery(workspace, workspace))!.designBaseline).toBeUndefined()
  expect(await conclude(workspace, { ...clean('verify'), resolved: [finding, newChoice].map(f => ({ id: f.id, evidence: 'Synthetic independently checked correction' })) })).toMatchObject({ phase: 'resources' })
}))

test('new blocked findings survive Revision without silently entering another automatic loop', () => fixture(async workspace => {
  const newChoice = { ...userChoice, id: 'new-choice' }
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  const result = await conclude(workspace, { ...clean('revise'), findings: [finding, newChoice] }, 'blocked')
  expect(result?.shouldContinue).toBe(false)
  expect((await readProjectDelivery(workspace, workspace))!.designReview).toMatchObject({ stopped: true, findings: [finding, newChoice] })
}))

test('new decision answers bind the source at question time, not an already edited or later changed source', () => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  const revision = (await readProjectDelivery(workspace, workspace))!.designReview!.revision
  const path = join(workspace, 'docs/GDD.md')
  await writeFile(path, (await readFile(path, 'utf8')) + '\nAuthorized correction.\n')
  const context = await projectDesignQuestionContext(workspace, workspace, revision)
  const choice = { ...userChoice, id: 'new-choice' }
  const input = { questions: [{ header: choice.id, question: 'Keep the feature?' }], metadata: { designFindings: [choice] }, answers: { 'Keep the feature?': 'Keep' } }
  await writeFile(path, (await readFile(path, 'utf8')) + '\nChanged while the question was pending.\n')
  await expect(recordProjectDesignUserDecision(workspace, workspace, revision, 'q', input, context.sourceRevision)).rejects.toThrow('stale')
  const review = (await readProjectDelivery(workspace, workspace))!.designReview!
  expect(review.findings).toEqual([finding])
  expect(review.userDecisions).toBeUndefined()
}))

test('source changes while a question is pending invalidate the answer', () => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [userChoice] })
  const revision = (await readProjectDelivery(workspace, workspace))!.designReview!.revision
  const path = join(workspace, 'docs/GDD.md')
  await writeFile(path, (await readFile(path, 'utf8')) + '\nChanged while waiting\n')
  await expect(recordProjectDesignUserDecision(workspace, workspace, revision, 'question', {
    questions: [{ header: userChoice.id, question: 'Direction?' }], answers: { 'Direction?': 'Keep' },
  })).rejects.toThrow('stale')
  expect((await readProjectDelivery(workspace, workspace))?.designReview?.userDecisions).toBeUndefined()
}))
test.each(['drop', 'downgrade', 'self-close'] as const)('rejects %s closure shortcut', mode => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  if (mode === 'self-close') {
    expect(await conclude(workspace, { ...clean('revise'), findings: [finding], resolved: [{ id: finding.id, evidence: 'I fixed it' }] })).toMatchObject({ shouldContinue: false })
  } else {
    await conclude(workspace, { ...clean('revise'), findings: [finding] })
    expect(await conclude(workspace, { ...clean('verify'), findings: mode === 'drop' ? [] : [{ ...finding, severity: 'follow-up', neededBefore: null }] })).toMatchObject({ shouldContinue: false })
  }
}))
test('read-only source drift and unknown finding source cannot release', () => fixture(async workspace => {
  expect(await conclude(workspace, { ...clean('inspect'), findings: [{ ...finding, sources: [{ document: 'GDD.md', section: 'Invented' }] }] })).toMatchObject({ shouldContinue: false })
  const file = join(workspace, 'docs/GDD.md')
  await writeFile(file, (await readFile(file, 'utf8')) + '\nUnexpected mutation\n')
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ shouldContinue: false })
}))
test('follow-up cannot defer a decision the next consumer already needs', () => fixture(async workspace => {
  const due: DesignFinding = { ...finding, severity: 'follow-up', neededBefore: 'resources' }
  expect(await conclude(workspace, { ...clean('inspect'), findings: [due] })).toMatchObject({ shouldContinue: true })
  const state = (await readProjectDelivery(workspace, workspace))!
  expect(state.designReview).toMatchObject({ step: 'revise', findings: [due] })
  expect(state.designReview!.writableDocuments).toContain('GDD.md')
  expect(await conclude(workspace, { ...clean('revise'), findings: [due] })).toMatchObject({ shouldContinue: true })
  const failed = await conclude(workspace, { ...clean('verify'), findings: [due] })
  expect(failed).toMatchObject({ shouldContinue: false })
  expect(failed!.issues.join(' ')).toContain(due.id)
  expect((await readProjectDelivery(workspace, workspace))!.designBaseline).toBeUndefined()
}))

test('a blocking product choice cannot be deferred by a later deadline or bypass a retained human answer', () => fixture(async workspace => {
  const choice: DesignFinding = { ...finding, id: 'future-choice', severity: 'blocker',
    action: 'decide', owner: 'user', neededBefore: 'implementation' }
  expect(await conclude(workspace, { ...clean('inspect'), findings: [choice] })).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))!.designReview!.writableDocuments).toContain('GDD.md')
  const result = await conclude(workspace, { ...clean('revise'), findings: [choice] })
  expect(result?.shouldContinue).toBe(false)
  expect(result?.issues.join(' ')).toContain('no validated answer')
  expect((await readProjectDelivery(workspace, workspace))!.designBaseline).toBeUndefined()
}))

test.each(['correct', 'decide', 'evidence'] as const)('due UI decision enters revision; later %s stays pending', action => fixture(async workspace => {
  const due: DesignFinding = { ...finding, id: 'due-ui', severity: 'follow-up', owner: 'UI_UX_SPEC.md',
    documents: ['UI_UX_SPEC.md'], sources: [{ document: 'UI_UX_SPEC.md', section: 'Design' }], neededBefore: 'resources' }
  const later: DesignFinding = { ...finding, id: 'later-art', severity: 'follow-up', action, owner: 'ART_DIRECTION.md',
    documents: ['ART_DIRECTION.md'], sources: [{ document: 'ART_DIRECTION.md', section: 'Design' }], neededBefore: 'implementation' }
  expect(await conclude(workspace, { ...clean('inspect'), findings: [finding, due, later] })).toMatchObject({ shouldContinue: true })
  const revision = (await readProjectDelivery(workspace, workspace))!.designReview!
  expect(revision.writableDocuments).toContain('UI_UX_SPEC.md')
  expect(revision.affectedDocuments).not.toContain('ART_DIRECTION.md')
  expect(designSupportingFiles(workspace, revision.writableDocuments!)).toContain('content/ui/menu.json')
  const snapshot = snapshotDesignDocuments(workspace, revision.writableDocuments!)
  const path = join(workspace, 'docs/UI_UX_SPEC.md')
  await writeFile(path, (await readFile(path, 'utf8')) + '\nSynthetic authorized correction.\n')
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'review', status: 'complete', summary: '',
    review: { ...clean('revise'), findings: [finding, due, later] } }, undefined, snapshot)).toMatchObject({ shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))!.designReview!.documentVersions!['UI_UX_SPEC.md']).toBe('1.1')
  expect(await conclude(workspace, { ...clean('verify'), findings: [later],
    resolved: [finding, due].map(f => ({ id: f.id, evidence: 'Synthetic independent fixture closure' })) }))
    .toMatchObject({ phase: 'resources', shouldContinue: true })
  const released = (await readProjectDelivery(workspace, workspace))!
  expect(released.designBaseline!.followUps).toEqual([later])
  expect(released.designHistory!.find(h => h.step === 'revise')!.findings).toEqual([finding, due, later])
}))
test('follow-ups remain protected when an explicit owner verification is requested', () => fixture(async workspace => {
  const followUp: DesignFinding = { ...finding, severity: 'follow-up', neededBefore: 'implementation' }
  await conclude(workspace, { ...clean('inspect'), findings: [followUp] })
  const requested = await requestProjectDesignResolution(workspace, workspace, {
    mode: 'verify', instruction: 'Verify the recorded pending requirement.', findings: [followUp],
  })
  expect(requested.designReview?.findings).toEqual([followUp])
  const result = await conclude(workspace, { ...clean('verify'), findings: [{ ...followUp, neededBefore: null }] })
  expect(result?.shouldContinue).toBe(false)
  expect(result?.issues.join(' ')).toContain('cannot be redefined')
}))

test('five writing batches produce eight drafts and only one joint inspection', () => fixture(async workspace => {
  const drafted = (await readProjectDelivery(workspace, workspace))!
  expect(drafted.phase).toBe('review')
  expect(drafted.designBaseline).toBeUndefined()
  expect(Object.keys(drafted.designDrafts!.snapshots)).toHaveLength(8)
  expect(drafted.designHistory).toBeUndefined()
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ phase: 'resources', shouldContinue: true })
  const released = (await readProjectDelivery(workspace, workspace))!
  expect(Object.keys(released.designBaseline!.snapshots)).toHaveLength(8)
  expect(released.designDrafts).toBeUndefined()
  expect(released.designHistory?.map(x => x.step)).toEqual(['inspect'])
}))

test('explicit affected baseline revision refreshes content bindings, not all eight authors', () => fixture(async workspace => {
  await conclude(workspace, clean('inspect'))
  let state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, phase: 'implementation' }))
  state = (await readProjectDelivery(workspace, workspace))!
  expect(checkProjectDesignBaseline(workspace, state)).toEqual([])
  const file = join(workspace, 'docs/GDD.md')
  await writeDesignDocumentFixture(workspace, 'GDD.md', { ...designHandoffFixture('GDD.md'), documentVersion: '1.1' },
    (await readFile(file, 'utf8')).replace('v1.0', 'v1.1') + '\nOwner supplied corrected rule\n')
  expect(checkProjectDesignBaseline(workspace, state).join(' ')).toContain('affected design-resolution')
  const requested = await requestProjectDesignResolution(workspace, workspace, { mode: 'verify', instruction: 'Owner corrected the rule; verify its affected consumers.', findings: [finding] })
  expect(requested.designReview).toMatchObject({ step: 'verify', returnPhase: 'implementation', changedDocuments: ['GDD.md'] })
  expect(await conclude(workspace, { ...clean('verify'), resumeFrom: 'content', resolved: [{ id: finding.id, evidence: 'Read corrected clause and affected implementation requirement.' }] })).toMatchObject({ phase: 'content', shouldContinue: true })
  expect(checkProjectDesignBaseline(workspace, (await readProjectDelivery(workspace, workspace))!)).toEqual([])
}))

test('Content binding completion preserves baseline; a fitting UI redesign needs scoped owner revision', () => fixture(async workspace => {
  await conclude(workspace, clean('inspect'))
  const released = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...released, phase: 'implementation' }))
  const state = (await readProjectDelivery(workspace, workspace))!
  const path = join(workspace, 'content/ui/menu.json')
  const ui = JSON.parse(await readFile(path, 'utf8'))
  ui.data.nodes[1].bindings = { enabled: 'canStart' }
  ui.data.nodes[1].style = { texture: { assetRef: 'delivered-style' } }
  await writeFile(path, JSON.stringify(ui))
  expect(checkProjectDesignBaseline(workspace, state)).toEqual([])
  const before = snapshotDesignDocuments(workspace, ['UI_UX_SPEC.md'])
  ui.data.nodes[1].layout.size[1] = 60
  await writeFile(path, JSON.stringify(ui))
  expect(checkProjectDesignBaseline(workspace, state).join(' ')).toContain('affected design-resolution')
  expect(checkProjectDesignBaseline(workspace, state)).toContain('Changed design owners: UI_UX_SPEC.md.')
  expect(checkProjectDesignBaseline(workspace, state)).toContain('Changed design sources/evidence: content/ui/menu.json.')
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'implementation', status: 'complete', summary: '' }))
    .toMatchObject({ phase: 'implementation', shouldContinue: false })
  const uiFinding: DesignFinding = { ...finding, id: 'layout-change', owner: 'UI_UX_SPEC.md',
    documents: ['UI_UX_SPEC.md'], sources: [{ document: 'UI_UX_SPEC.md', section: 'Design' }],
    impact: 'The saved layout changed without an owner revision', closeWhen: 'Owner-authorized layout is versioned and rechecked', neededBefore: 'content' }
  expect(finalizeDesignDocuments(workspace, ['UI_UX_SPEC.md'], before).issues).toEqual([])
  expect((await readProjectDelivery(workspace, workspace))!.designReview).toBeUndefined()
  const provenance: DesignFinding[] = []
  const requested = await requestProjectDesignResolution(workspace, workspace, { mode: 'verify',
    instruction: 'I confirm these saved changes may be adopted; verify this source and its consumers.', findings: [uiFinding, ...provenance] })
  expect(requested.designReview?.changedDocuments).toEqual(['UI_UX_SPEC.md'])
  expect(await conclude(workspace, { ...clean('verify'), resumeFrom: 'content', resolved: [uiFinding, ...provenance].map(f => ({ id: f.id, evidence: 'Checked retained direction, saved UI geometry and owner requirement.' })) }))
    .toMatchObject({ phase: 'content', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline?.documentVersions?.['UI_UX_SPEC.md']).toBe('1.1')
}))
test('an explicit local correction preserves unrelated follow-ups without granting their edit scope', () => fixture(async workspace => {
  await conclude(workspace, clean('inspect'))
  const optional: DesignFinding = { ...finding, id: 'optional-art', severity: 'follow-up', neededBefore: null,
    owner: 'ART_DIRECTION.md', documents: ['ART_DIRECTION.md'], sources: [{ document: 'ART_DIRECTION.md', section: 'Design' }] }
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, phase: 'implementation',
    designBaseline: { ...state.designBaseline, followUps: [optional] } }))
  const requested = await requestProjectDesignResolution(workspace, workspace, { mode: 'revise', instruction: 'Correct only the GDD rule.', findings: [finding] })
  expect(requested.designReview?.writableDocuments).toEqual(['GDD.md', 'TECHNICAL_DESIGN.md'])
  expect(requested.designReview?.findings).toEqual([optional, finding])
  const file = join(workspace, 'docs/ART_DIRECTION.md')
  await writeFile(file, (await readFile(file, 'utf8')) + '\nUnrequested art polish.\n')
  expect(await conclude(workspace, { ...clean('revise'), findings: [optional, finding] })).toMatchObject({ shouldContinue: false })
}))
test('legacy delivery requires explicit inspect; it does not acquire a baseline just by migration', () => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, phase: 'implementation', designReview: undefined }))
  await writeDesignDocumentsFixture(workspace)
  const migrated = await requestProjectDesignResolution(workspace, workspace, { instruction: 'Inspect existing eight documents under consumer-ready criteria.', mode: 'inspect', findings: [] })
  expect(migrated.designReview).toMatchObject({ step: 'inspect', returnPhase: 'implementation' })
  expect(migrated.designBaseline).toBeUndefined()
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ phase: 'resources', shouldContinue: true })
  await expect(requestProjectDesignResolution(workspace, workspace, { instruction: 'Inspect again', mode: 'inspect', findings: [] })).rejects.toThrow('do not re-review a clean baseline')
}))

test('malformed handoff reaches review and can be corrected once before release', () => fixture(async workspace => {
  // Replace the original fixture before capturing a new author handoff.
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, phase: 'author', designReview: undefined, designDrafts: undefined }))
  await writeFile(join(workspace, '.beegame/design-handoffs/GDD.json'), '{broken}')
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, undefined, AUTHOR_BATCHES.length - 1)).toMatchObject({ phase: 'review', shouldContinue: true })
  await prepareLegacyDesignReviewFixture(workspace, workspace)
  const dataFinding: DesignFinding = { ...finding, id: 'state-table', impact: 'Technical author cannot consume the declared state targets', closeWhen: 'Valid state rows match the actual Design clause' }
  await conclude(workspace, { ...clean('inspect'), findings: [dataFinding] })
  await writeDesignDocumentFixture(workspace, 'GDD.md', { ...designHandoffFixture('GDD.md'), documentVersion: '1.1' })
  expect(await conclude(workspace, { ...clean('revise'), findings: [dataFinding] })).toMatchObject({ shouldContinue: true })
  expect(await conclude(workspace, { ...clean('verify'), resolved: [{ id: dataFinding.id, evidence: 'Saved data parses, state targets exist and agree with Design.' }] })).toMatchObject({ phase: 'resources', shouldContinue: true })
}))

test('saved draft protection rejects another author changing previously delivered work', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-draft-protection-'))
  try {
    await beginProjectDelivery(workspace, workspace, 'Synthetic draft protection')
    await writeDesignDocumentFixture(workspace, 'GDD.md')
    expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'author', status: 'complete', summary: '' }))
      .toMatchObject({ phase: 'author', shouldContinue: true })
    const state = (await readProjectDelivery(workspace, workspace))!
    expect(state.authorBatch).toBe(1)
    expect(state.designBaseline).toBeUndefined()
    await writeDesignDocumentsFixture(workspace, AUTHOR_BATCHES[1])
    await writeFile(join(workspace, 'docs/GDD.md'), designDocumentFixture('GDD.md') + '\nUnauthorized rule change\n')
    expect(checkProjectDesignBaseline(workspace, state).join(' ')).toContain('outside scheduled owner scope')
    expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, undefined, 1)).toMatchObject({ phase: 'author', shouldContinue: false })
    expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('legacy intermediate reviews stop explicitly without rewriting their saved state', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-legacy-middle-review-'))
  try {
    const state = await beginProjectDelivery(workspace, workspace, 'Legacy fixture')
    await writeDesignDocumentsFixture(workspace, ['GDD.md'])
    await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, phase: 'review', authorBatch: 0 }))
    const saved = await readFile(projectDeliveryStatePath(workspace, workspace), 'utf8')
    await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('earlier per-batch review')
    expect(await conclude(workspace, clean('inspect'))).toMatchObject({ phase: 'review', shouldContinue: false })
    expect(await readFile(projectDeliveryStatePath(workspace, workspace), 'utf8')).toBe(saved)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})
