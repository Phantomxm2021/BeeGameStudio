import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { AUTHOR_BATCHES } from './project-author'
import { checkDesignHandoff, designSupportingFiles, finalizeDesignDocuments, snapshotDesignDocuments, type DesignFinding, type DesignReviewResult } from './design-handoff'
import { designDocumentFixture, designHandoffFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { advanceProjectDeliveryAfterTurn, beginProjectDelivery, checkProjectDesignBaseline, prepareProjectDesignReview,
  projectDeliveryStatePath, projectDesignReleaseDiagnostics, readProjectDelivery, requestProjectDesignResolution } from './project-delivery'

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
    await prepareProjectDesignReview(workspace, workspace)
    await run(workspace)
  } finally { await rm(workspace, { recursive: true, force: true }) }
}
function conclude(workspace: string, review: DesignReviewResult, status: 'complete' | 'blocked' = 'complete') {
  return advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'review', status, summary: JSON.stringify(review), review })
}
const clean = (step: DesignReviewResult['step']): DesignReviewResult => ({ step, findings: [], resolved: [] })

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
  await prepareProjectDesignReview(workspace, workspace)
  expect(projectDesignReleaseDiagnostics(workspace, (await readProjectDelivery(workspace, workspace))!).join(' ')).toContain('Live UI source')
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({ step: 'revise', writableDocuments: ['UI_UX_SPEC.md'] })
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
  ui.data.nodes[1].style = { fontFamily: 'delivered-font' }
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
  await prepareProjectDesignReview(workspace, workspace)
  expect(projectDesignReleaseDiagnostics(workspace, (await readProjectDelivery(workspace, workspace))!).join(' ')).toContain('minimumControlSize')
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({ step: 'revise', writableDocuments: ['UI_UX_SPEC.md'] })
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
  await prepareProjectDesignReview(workspace, workspace)
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
  await prepareProjectDesignReview(workspace, workspace)
  const inspected = (await readProjectDelivery(workspace, workspace))!
  const diagnostics = projectDesignReleaseDiagnostics(workspace, inspected).join('; ')
  expect(diagnostics).toContain('output ready references an absent section')
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({ step: 'revise', writableDocuments: ['GDD.md'] })
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
  await prepareProjectDesignReview(workspace, workspace)
  const findings: DesignFinding[] = followUp ? [{ ...finding, id: 'format', severity: 'follow-up', neededBefore: 'implementation' }] : []
  expect(await conclude(workspace, { ...clean('inspect'), findings })).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({
    step: 'revise', writableDocuments: ['GDD.md'], findings,
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
  await prepareProjectDesignReview(workspace, workspace)
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ shouldContinue: true })
  expect(await conclude(workspace, clean('revise'))).toMatchObject({ shouldContinue: false })
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({ step: 'revise', stopped: true })
  expect((await readProjectDelivery(workspace, workspace))?.designBaseline).toBeUndefined()
  await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('stopped')
}))
test('deterministic repair cannot skip its version increase', () => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designReview: undefined }))
  await writeDesignDocumentFixture(workspace, 'GDD.md', { ...designHandoffFixture('GDD.md'), outputs: [{ id: 'ready', section: 'Missing section' }] })
  await prepareProjectDesignReview(workspace, workspace)
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
  await prepareProjectDesignReview(workspace, workspace)
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
  await prepareProjectDesignReview(workspace, workspace)
  const savedEvidence: DesignFinding = { ...finding, id: 'saved-evidence',
    impact: 'Saved result reports failure despite available source-backed input and a successful authorized check',
    closeWhen: 'Regenerate the saved result from the unchanged input, preserving check scope and increasing the owning document version' }
  expect(await conclude(workspace, { ...clean('inspect'), findings: [savedEvidence] })).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))?.designReview).toMatchObject({ step: 'revise', writableDocuments: ['GDD.md'] })
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
test('verification blockers stop; no silent retry, reset or second correction', () => fixture(async workspace => {
  await conclude(workspace, { ...clean('inspect'), findings: [finding] })
  await conclude(workspace, { ...clean('revise'), findings: [finding] })
  expect(await conclude(workspace, { ...clean('verify'), findings: [finding] })).toMatchObject({ shouldContinue: false })
  await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('stopped')
  expect(await conclude(workspace, clean('verify'))).toMatchObject({ shouldContinue: false })
  const state = await requestProjectDesignResolution(workspace, workspace, { mode: 'revise', instruction: 'Owner decides outcome A takes precedence; correct only related clauses.', findings: [finding] })
  expect(state.designReview).toMatchObject({ step: 'revise', findings: [finding] })
  expect(state.designBaseline).toBeUndefined()
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
test.each(['decide', 'evidence'] as const)('unavailable %s stops without automatic correction or retry', action => fixture(async workspace => {
  const unresolved: DesignFinding = { ...finding, action,
    impact: action === 'decide' ? 'Required owner decision is disputed' : 'Required platform fact cannot be established from available sources or authorized checks',
    closeWhen: action === 'decide' ? 'Owner supplies the required decision' : 'Owner supplies authoritative evidence or an authorized capability result' }
  expect(await conclude(workspace, { ...clean('inspect'), findings: [unresolved] })).toMatchObject({ shouldContinue: false })
  const stopped = (await readProjectDelivery(workspace, workspace))!
  expect(stopped.designReview).toMatchObject({ step: 'inspect', stopped: true, findings: [unresolved] })
  expect(stopped.designBaseline).toBeUndefined()
  await expect(prepareProjectDesignReview(workspace, workspace)).rejects.toThrow('stopped')
  expect(await conclude(workspace, clean('inspect'))).toMatchObject({ shouldContinue: false })
  expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(designDocumentFixture('GDD.md'))
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
  expect(await conclude(workspace, { ...clean('inspect'), findings: [{ ...finding, severity: 'follow-up' }] })).toMatchObject({ shouldContinue: false })
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
  expect(await conclude(workspace, { ...clean('verify'), resolved: [{ id: finding.id, evidence: 'Read corrected clause and affected implementation requirement.' }] })).toMatchObject({ phase: 'content', shouldContinue: true })
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
  ui.data.nodes[1].style = { background: 'delivered-style' }
  await writeFile(path, JSON.stringify(ui))
  expect(checkProjectDesignBaseline(workspace, state)).toEqual([])
  const before = snapshotDesignDocuments(workspace, ['UI_UX_SPEC.md'])
  ui.data.nodes[1].layout.size[1] = 60
  await writeFile(path, JSON.stringify(ui))
  expect(checkProjectDesignBaseline(workspace, state).join(' ')).toContain('affected design-resolution')
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'implementation', status: 'complete', summary: '' }))
    .toMatchObject({ phase: 'implementation', shouldContinue: false })
  const uiFinding: DesignFinding = { ...finding, id: 'layout-change', owner: 'UI_UX_SPEC.md',
    documents: ['UI_UX_SPEC.md'], sources: [{ document: 'UI_UX_SPEC.md', section: 'Design' }],
    impact: 'The saved layout changed without an owner revision', closeWhen: 'Owner-authorized layout is versioned and rechecked', neededBefore: 'content' }
  expect(finalizeDesignDocuments(workspace, ['UI_UX_SPEC.md'], before).issues).toEqual([])
  const requested = await requestProjectDesignResolution(workspace, workspace, { mode: 'verify',
    instruction: 'UI owner authorizes the adjusted layout; verify this source and its consumers.', findings: [uiFinding] })
  expect(requested.designReview?.changedDocuments).toEqual(['UI_UX_SPEC.md'])
  expect(await conclude(workspace, { ...clean('verify'), resolved: [{ id: uiFinding.id, evidence: 'Recomputed the saved UI geometry and checked the owner requirement.' }] }))
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
  expect(requested.designReview?.writableDocuments).toEqual(['GDD.md'])
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
  await expect(requestProjectDesignResolution(workspace, workspace, { instruction: 'Inspect again', mode: 'inspect', findings: [] })).rejects.toThrow('affected revise/verify')
}))

test('malformed handoff reaches review and can be corrected once before release', () => fixture(async workspace => {
  // Replace the original fixture before capturing a new author handoff.
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, phase: 'author', designReview: undefined, designDrafts: undefined }))
  await writeFile(join(workspace, '.beegame/design-handoffs/GDD.json'), '{broken}')
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, undefined, AUTHOR_BATCHES.length - 1)).toMatchObject({ phase: 'review', shouldContinue: true })
  await prepareProjectDesignReview(workspace, workspace)
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
