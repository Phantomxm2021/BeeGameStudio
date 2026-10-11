import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDesignHandoff, designDocumentVersion, designRevisionFileDigest,
  designSupportingFileDigest, snapshotDesignDocuments, snapshotDesignRevisionFiles, type DesignFinding } from './design-handoff'
import { designBaselineFixture, sceneLayoutFixture, writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { PROJECT_DOCUMENTS, beginProjectDelivery, advanceProjectDeliveryAfterTurn, readProjectDelivery, projectDeliveryStatePath,
  prepareProjectDesignReview, recordProjectDesignUserDecision, evaluateProjectDeliveryGate, checkProjectDesignBaseline, requestProjectDesignResolution } from './project-delivery'
import { readMilestoneResult } from './milestone-result'
import { checkDesignLayouts } from './design-layout-check'
import { readRuntimeAcceptanceReport } from './runtime-acceptance'

async function fixture(run: (workspace: string) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-design-repair-'))
  try {
    const state = await beginProjectDelivery(workspace, workspace, 'Synthetic original requirements')
    await writeDesignDocumentsFixture(workspace)
    await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, phase: 'implementation', designBaseline: designBaselineFixture(workspace) }))
    await run(workspace)
  } finally { await rm(workspace, { recursive: true, force: true }) }
}
async function requestAffectedReview(workspace: string, findings: DesignFinding[] = []) {
  return requestProjectDesignResolution(workspace, workspace, {
    mode: 'inspect', findings, instruction: 'Synthetic explicit owner direction to inspect and correct this affected scope.',
  })
}
const issue: DesignFinding = { id: 'downstream-layout', owner: 'UI_UX_SPEC.md', severity: 'blocker', action: 'correct', documents: ['UI_UX_SPEC.md'],
  sources: [{ document: 'UI_UX_SPEC.md', section: 'Design' }], impact: 'Reported inconsistency in downstream data',
  closeWhen: 'Check the actual owner source and its affected consumer', neededBefore: 'implementation' }
async function conclude(workspace: string, step: 'inspect' | 'revise' | 'verify', findings: DesignFinding[] = [], resolved: Array<{ id: string; evidence: string }> = [],
  snapshot?: ReturnType<typeof snapshotDesignDocuments>, resumeFrom?: 'content' | 'implementation') {
  return advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'review', status: 'complete', summary: 'Synthetic source-backed impact assessment',
    review: { step, findings, resolved, ...(resumeFrom ? { resumeFrom, resumeReason: 'Synthetic source-backed assessment of changed owner requirements and affected formal content/runtime consumers.' } : {}) } }, undefined, snapshot)
}

test('host rejects a missing affected route without marking semantic repair exhausted or inventing a stage', () => fixture(async workspace => {
  await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'implementation', status: 'blocked', summary: 'Synthetic source conflict', designIssues: [issue] })
  await requestAffectedReview(workspace, [issue])
  await prepareProjectDesignReview(workspace, workspace)
  expect(await conclude(workspace, 'inspect', [issue])).toMatchObject({ shouldContinue: true })
  const revising = (await readProjectDelivery(workspace, workspace))!
  const snapshot = snapshotDesignDocuments(workspace, revising.designReview!.writableDocuments!)
  const path = join(workspace, 'docs/UI_UX_SPEC.md')
  await writeFile(path, (await readFile(path, 'utf8')) + '\nSynthetic corrected source for content mapping.\n')
  expect(await conclude(workspace, 'revise', [issue], [], snapshot)).toMatchObject({ shouldContinue: true })
  const before = await readProjectDelivery(workspace, workspace)
  const closed = [{ id: issue.id, evidence: 'Saved requirement changes content mapping; asset specifications unchanged.' }]
  const denied = await conclude(workspace, 'verify', [], closed)
  expect(denied?.issues.join(' ')).toContain('resumeFrom')
  expect(denied?.shouldContinue).toBe(false)
  expect(await readProjectDelivery(workspace, workspace)).toEqual(before)
  expect(await conclude(workspace, 'verify', [], closed, undefined, 'content')).toMatchObject({ phase: 'content', shouldContinue: true })
}))

test('staged local corrections retain unrelated findings and allow the next independent group', () => fixture(async workspace => {
  const first: DesignFinding = { ...issue, id: 'scene-source', severity: 'follow-up', owner: 'LEVEL_SCENE_DESIGN.md',
    documents: ['LEVEL_SCENE_DESIGN.md'], sources: [{ document: 'LEVEL_SCENE_DESIGN.md', section: 'Design' }], neededBefore: 'content' }
  const later: DesignFinding = { ...issue, id: 'art-source', severity: 'follow-up', owner: 'ART_DIRECTION.md',
    documents: ['ART_DIRECTION.md'], sources: [{ document: 'ART_DIRECTION.md', section: 'Design' }], neededBefore: 'implementation' }
  const optional: DesignFinding = { ...issue, id: 'optional-ui', severity: 'follow-up', neededBefore: null }
  const discovered: DesignFinding = { ...issue, id: 'audio-source', severity: 'follow-up', owner: 'AUDIO_DESIGN.md',
    documents: ['AUDIO_DESIGN.md'], sources: [{ document: 'AUDIO_DESIGN.md', section: 'Design' }], neededBefore: 'acceptance' }
  let state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, phase: 'content',
    designBaseline: { ...state.designBaseline!, followUps: [first, later, optional] } }))
  const originalArt = await readFile(join(workspace, 'docs/ART_DIRECTION.md'), 'utf8')
  for (const [phase, current, added, expected] of [
    ['content', first, [discovered], [later, optional, discovered]],
    ['implementation', later, [], [optional, discovered]],
  ] as const) {
    state = (await readProjectDelivery(workspace, workspace))!
    // Synthetic later-phase entry, not actual Content/game acceptance.
    await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, phase }))
    const prepared = (await requestAffectedReview(workspace))!
    expect(prepared.designRepair?.status).toBe('pending')
    expect(prepared.designReview?.findings).toEqual([current])
    expect(prepared.designReview?.writableDocuments).not.toContain(optional.owner)
    expect(await conclude(workspace, 'inspect', [current])).toMatchObject({ shouldContinue: true })
    const revising = (await readProjectDelivery(workspace, workspace))!
    const before = snapshotDesignDocuments(workspace, revising.designReview!.writableDocuments!)
    const path = join(workspace, 'docs', current.owner)
    await writeFile(path, (await readFile(path, 'utf8')) + '\nSynthetic authorized source correction.\n')
    expect(await conclude(workspace, 'revise', [current], [], before)).toMatchObject({ shouldContinue: true })
    expect(await conclude(workspace, 'verify', [...added], [{ id: current.id, evidence: 'Synthetic independent closure of only the assigned source' }],
      undefined, phase)).toMatchObject({ phase, shouldContinue: true })
    const released = (await readProjectDelivery(workspace, workspace))!
    expect(released.designBaseline!.followUps).toEqual([...expected])
    expect(released.designRepair?.status).toBe('resolved')
    expect(released.designBaseline!.documentVersions![current.owner]).toBe('1.1')
    expect(checkProjectDesignBaseline(workspace, released)).toEqual([])
    if (phase === 'content') expect(await readFile(join(workspace, 'docs/ART_DIRECTION.md'), 'utf8')).toBe(originalArt)
  }
  const final = (await readProjectDelivery(workspace, workspace))!
  expect(final.designHistory?.filter(h => h.step === 'verify')).toHaveLength(2)
  expect(final.designBaseline!.followUps).toEqual([optional, discovered])
}))

test.each([
  ['resources', 'resources'], ['content', 'resources'], ['implementation', 'content'],
  ['acceptance', 'implementation'], ['complete', 'acceptance'], ['implementation', 'TECHNICAL_DESIGN.md'],
] as const)('baseline and repair agree on due/overdue findings: phase=%s deadline=%s', (phase, neededBefore) => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  const due: DesignFinding = { ...issue, severity: 'follow-up', neededBefore }
  const seeded = { ...state, phase, designBaseline: { ...state.designBaseline!, followUps: [due] } }
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify(seeded))
  expect(checkProjectDesignBaseline(workspace, seeded).join(' ')).toContain(due.id)
  if (phase === 'complete') expect(await evaluateProjectDeliveryGate(workspace, workspace)).toMatchObject({ allowed: false, layer: 'revision' })
  const prepared = (await requestAffectedReview(workspace))!
  expect(prepared.phase).toBe('review')
  expect(prepared.designReview?.findings).toEqual([due])
  expect(prepared.designReview?.step).toBe('inspect')
}))

test('optional and genuinely later findings do not trigger or expand repair', () => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  const later: DesignFinding = { ...issue, severity: 'follow-up', neededBefore: 'acceptance' }
  const optional: DesignFinding = { ...later, id: 'optional', neededBefore: null }
  const seeded = { ...state, designBaseline: { ...state.designBaseline!, followUps: [later, optional] } }
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify(seeded))
  expect(checkProjectDesignBaseline(workspace, seeded)).toEqual([])
  expect(await readProjectDelivery(workspace, workspace)).toEqual(seeded)
}))

test.each(['pending', 'stopped'] as const)('an unfinished repair cannot restart automatically: %s', status => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  const due: DesignFinding = { ...issue, severity: 'follow-up' }
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state,
    designBaseline: { ...state.designBaseline!, followUps: [due] },
    designRepair: { turn: 'old', returnPhase: 'implementation', status, reason: 'Unfinished group',
      changedDocuments: [], baselineRevision: state.designBaseline!.revision } }))
  for (let i = 0; i < 2; i++) {
    expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'implementation', status: 'blocked', summary: 'Repeated report', designIssues: [due] }))
      .toMatchObject({ phase: 'implementation', shouldContinue: false })
    const blocked = (await readProjectDelivery(workspace, workspace))!
    expect(blocked.designRepair?.status).toBe(status)
    expect(blocked.designReview).toBeUndefined()
    expect(blocked.lastValidationFailure).toContain('explicit owner direction')
    expect(blocked.lastValidationFailure).toContain(due.id)
  }
}))

test.each(['inspect', 'verify'] as const)('local %s cannot redefine an unassigned baseline finding', step => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  const due: DesignFinding = { ...issue, severity: 'follow-up', neededBefore: 'content' }
  const later: DesignFinding = { ...issue, id: 'later', severity: 'follow-up', owner: 'ART_DIRECTION.md',
    documents: ['ART_DIRECTION.md'], sources: [{ document: 'ART_DIRECTION.md', section: 'Design' }], neededBefore: 'implementation' }
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, phase: 'content',
    designBaseline: { ...state.designBaseline!, followUps: [due, later] } }))
  await requestAffectedReview(workspace)
  if (step === 'verify') {
    await conclude(workspace, 'inspect', [due])
    await conclude(workspace, 'revise', [due])
  }
  expect(await conclude(workspace, step, [due, { ...later, neededBefore: null }])).toMatchObject({
    shouldContinue: false, issues: [expect.stringContaining('unassigned baseline finding')],
  })
  expect((await readProjectDelivery(workspace, workspace))!.designBaseline!.followUps).toEqual([due, later])
}))

test('a downstream report cannot postpone an already recorded deadline', () => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  const due: DesignFinding = { ...issue, severity: 'follow-up', neededBefore: 'content' }
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state,
    designBaseline: { ...state.designBaseline!, followUps: [due] } }))
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'implementation', status: 'blocked',
    summary: 'Synthetic wrong deadline', designIssues: [{ ...due, neededBefore: 'acceptance' }] })).toMatchObject({ shouldContinue: false, phase: 'implementation' })
  expect((await readProjectDelivery(workspace, workspace))!.designBaseline!.followUps).toEqual([due])
}))

test.each(['revise', 'verify'] as const)('explicit %s compares recorded fields, not JSON key order', mode => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  const recorded: DesignFinding = { ...Object.fromEntries(Object.entries(issue).reverse()) as DesignFinding,
    sources: issue.sources.map(source => ({ section: source.section, document: source.document })) }
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state,
    designBaseline: { ...state.designBaseline!, followUps: [recorded] } }))
  await expect(requestProjectDesignResolution(workspace, workspace, { mode,
    instruction: 'Synthetic owner direction', findings: [{ ...issue, neededBefore: 'acceptance' }] }))
    .rejects.toThrow('Do not redefine a recorded finding')
  const requested = await requestProjectDesignResolution(workspace, workspace, { mode,
    instruction: 'Synthetic owner direction for the unchanged recorded issue', findings: [issue] })
  expect(requested.designReview?.step).toBe(mode)
  expect(requested.designReview?.findings).toEqual([issue])
}))

test.each(['color', 'opacity', 'fontFamily', 'customRule', 'responsive', 'unknownMember', 'fontFrame', 'styleFontAlias'])('UI fingerprint protects %s rather than ignoring all style/data', kind => fixture(async workspace => {
  const path = 'content/ui/menu.json', ui = JSON.parse(await readFile(join(workspace, path), 'utf8'))
  const before = designSupportingFileDigest(workspace, path)
  const node = ui.data.nodes[1]
  if (['color', 'opacity', 'fontFamily'].includes(kind)) node.style = { [kind]: kind === 'opacity' ? 0.2 : 'Changed design' }
  if (kind === 'customRule') node.data = { customRule: { assetRef: 'not-a-binding' } }
  if (kind === 'responsive') node.responsive = { compact: { style: { opacity: 0.2 } } }
  if (kind === 'unknownMember') node.data = { member: 'gameplay-rule-not-an-asset-role' }
  if (kind === 'fontFrame') node.data = { font: { frame: 'not-a-supported-font-selector' } }
  if (kind === 'styleFontAlias') node.style = { font: { assetRef: 'not-the-supported-font-location' } }
  await writeFile(join(workspace, path), JSON.stringify(ui))
  expect(designSupportingFileDigest(workspace, path)).not.toBe(before)
}))

test('supported UI locator completion does not change its design; non-locator image treatment does', () => fixture(async workspace => {
  const path = 'content/ui/menu.json', ui = JSON.parse(await readFile(join(workspace, path), 'utf8'))
  ui.data.nodes.push({ id: 'image', role: 'image', parentId: 'root', layout: { size: [50, 50] } })
  await writeFile(join(workspace, path), JSON.stringify(ui))
  const before = designSupportingFileDigest(workspace, path)
  ui.assetRefs = ['art', 'font']
  Object.assign(ui.data.nodes[2], { assetRef: 'art', data: { member: 'image.png', atlasMember: 'atlas.json', frame: 'image' } })
  ui.data.nodes[1].data = { font: { assetRef: 'font', member: 'font.woff2' } }
  ui.data.nodes[1].style = { texture: { assetRef: 'art', member: 'image.png' } }
  ui.data.nodes[1].bindings = { text: 'score' }
  ui.data.nodes[1].responsive = { compact: { style: { texture: { assetRef: 'art' } } } }
  await writeFile(join(workspace, path), JSON.stringify(ui))
  expect(designSupportingFileDigest(workspace, path)).toBe(before)
  ui.data.nodes[1].style.texture.crop = [0, 0, 10, 10]
  await writeFile(join(workspace, path), JSON.stringify(ui))
  expect(designSupportingFileDigest(workspace, path)).not.toBe(before)
}))

test('a locator placed on the wrong UI role remains a Content validation error, not a design change', () => fixture(async workspace => {
  const path = 'content/ui/menu.json', ui = JSON.parse(await readFile(join(workspace, path), 'utf8'))
  const before = designSupportingFileDigest(workspace, path)
  ui.data.nodes[1].assetRef = 'wrong-locator-on-button'
  await writeFile(join(workspace, path), JSON.stringify(ui))
  expect(designSupportingFileDigest(workspace, path)).toBe(before)
  expect((await readProjectDelivery(workspace, workspace))!.designReview).toBeUndefined()
}))

test('linked Scene visibility failure includes both Scene and UI owners, not only the UI wrapper', () => fixture(async workspace => {
  const uiPath = join(workspace, 'content/ui/menu.json'), ui = JSON.parse(await readFile(uiPath, 'utf8'))
  ui.data.nodes[0].data.layoutCamera = { nodeId: 'game', path: 'content/scenes/level.json' }
  ui.data.nodes.push({ id: 'game', parentId: 'root', role: 'container', layout: { size: [100, 100] } })
  const scene = sceneLayoutFixture() as any
  scene.data.settings.requiredVisibleNodeIds = ['board']
  scene.data.nodes[1].transform.position = [9999, 0, 0]
  scene.data.nodes[1].components = [{ id: 'visual', type: 'sprite-renderer', data: { size: [100, 100] } }]
  await writeFile(uiPath, JSON.stringify(ui))
  await writeFile(join(workspace, 'content/scenes/level.json'), JSON.stringify(scene))
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designBaseline: designBaselineFixture(workspace) }))
  const prepared = (await requestAffectedReview(workspace))!
  expect(prepared.designReview!.step).toBe('revise')
  expect(prepared.designReview!.writableDocuments).toContain('LEVEL_SCENE_DESIGN.md')
  expect(prepared.designReview!.writableDocuments).toContain('UI_UX_SPEC.md')
}))

test('legacy fingerprint is verified with its own rules, then upgraded only after affected inspection', () => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  const legacy = checkDesignHandoff(workspace, PROJECT_DOCUMENTS, { digestVersion: 1 })
  const baseline = { batch: 4, snapshots: legacy.snapshots, revision: legacy.revision, documentVersions: legacy.documentVersions,
    evidenceHashes: legacy.evidenceHashes, followUps: [] }
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designBaseline: baseline }))
  const prepared = (await requestAffectedReview(workspace))!
  expect(prepared.designBaseline).toEqual(baseline)
  expect(prepared.designReview).toMatchObject({ step: 'inspect', digestVersion: 2, writableDocuments: ['UI_UX_SPEC.md'] })
  expect(prepared.designReview!.findings).toEqual([])
  await prepareProjectDesignReview(workspace, workspace)
  expect(await conclude(workspace, 'inspect')).toMatchObject({ phase: 'implementation', shouldContinue: true })
  const upgraded = (await readProjectDelivery(workspace, workspace))!
  expect(upgraded.designBaseline!.digestVersion).toBe(2)
  expect(upgraded.designBaseline!.documentVersions).toEqual(baseline.documentVersions)
  const path = join(workspace, 'content/ui/menu.json'), ui = JSON.parse(await readFile(path, 'utf8'))
  ui.data.nodes[1].style = { opacity: 0.5 }
  await writeFile(path, JSON.stringify(ui))
  const changed = (await requestAffectedReview(workspace))!
  expect(changed.designRepair!.status).toBe('pending')
  expect(changed.designReview!.step).toBe('inspect')
  expect(changed.designReview!.findings.some(f => f.owner === 'user' && f.action === 'decide')).toBe(true)
}))

test('known geometry failure goes straight to one scoped revision, not another model discovery task', () => fixture(async workspace => {
  const path = join(workspace, 'content/ui/menu.json'), ui = JSON.parse(await readFile(path, 'utf8'))
  ui.data.nodes[1].layout.size[1] = 20
  await writeFile(path, JSON.stringify(ui))
  // Synthetic prior baseline models a previously missed check, not actual approval.
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, designBaseline: designBaselineFixture(workspace) }))
  const prepared = (await requestAffectedReview(workspace))!
  expect(prepared.designReview).toMatchObject({ step: 'revise', writableDocuments: ['UI_UX_SPEC.md', 'TECHNICAL_DESIGN.md'], findings: [] })
  const geometry = checkDesignLayouts(workspace)
  expect(geometry.diagnostics).toContainEqual(expect.objectContaining({ source: 'content/ui/menu.json', owner: 'UI_UX_SPEC.md', node: 'play', viewport: [960, 540],
    kind: 'minimum-control-size', message: 'play: 960x540 resolved control size [200,20] is below root.minimumControlSize.',
    closeWhen: expect.any(String), geometry: expect.any(Object) }))
  expect(geometry.coverage.targets).toHaveLength(1)
  const before = snapshotDesignDocuments(workspace, prepared.designReview!.writableDocuments!)
  ui.data.nodes[1].layout.size[1] = 52
  await writeFile(path, JSON.stringify(ui))
  expect(await conclude(workspace, 'revise', [], [], before)).toMatchObject({ phase: 'review', shouldContinue: true })
  expect(await conclude(workspace, 'verify', [], [], undefined, 'content')).toMatchObject({ phase: 'content', shouldContinue: true })
}))

test('optional observations and genuinely later evidence do not restart review and retain their deadlines', () => fixture(async workspace => {
  const pending: DesignFinding[] = [
    { ...issue, id: 'optional', severity: 'follow-up', neededBefore: null },
    { ...issue, id: 'later-evidence', severity: 'follow-up', action: 'evidence', neededBefore: 'acceptance' },
  ]
  const result = await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'implementation', status: 'blocked',
    summary: 'Other implementation work remains', designIssues: pending })
  expect(result).toMatchObject({ phase: 'implementation', shouldContinue: false, issues: ['Other implementation work remains'] })
  const state = (await readProjectDelivery(workspace, workspace))!
  expect(state.designReview).toBeUndefined()
  expect(state.designBaseline!.followUps).toEqual(pending)
  expect(checkProjectDesignBaseline(workspace, { ...state, phase: 'acceptance' }).join(' ')).toContain('later-evidence is due')
}))

test('observed production writes do not authorize changing or adopting frozen design', () => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!, old = state.designBaseline
  const path = 'content/ui/menu.json', ui = JSON.parse(await readFile(join(workspace, path), 'utf8'))
  ui.data.nodes[1].style = { color: '#123456' }
  await writeFile(join(workspace, path), JSON.stringify(ui))
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'implementation', status: 'complete', summary: 'Synthetic output' })).toMatchObject({ phase: 'implementation', shouldContinue: false })
  const pending = (await readProjectDelivery(workspace, workspace))!
  expect(pending.designBaseline).toEqual(old)
  expect(pending.designReview).toBeUndefined()
  expect(designDocumentVersion(await readFile(join(workspace, 'docs/UI_UX_SPEC.md'), 'utf8'))).toBe('1.0')
}))

test('false downstream allegation is closed read-only without revision; renaming it after restart does not rearm paid repair', () => fixture(async workspace => {
  const source = await readFile(join(workspace, 'docs/UI_UX_SPEC.md'), 'utf8')
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'implementation', status: 'blocked', summary: 'Alleged design issue', designIssues: [issue] }))
    .toMatchObject({ phase: 'implementation', shouldContinue: false })
  await requestAffectedReview(workspace, [issue])
  expect(await conclude(workspace, 'inspect', [], [{ id: issue.id, evidence: 'Synthetic independent source read rejects allegation; no change necessary.' }]))
    .toMatchObject({ phase: 'implementation', shouldContinue: true })
  expect(await readFile(join(workspace, 'docs/UI_UX_SPEC.md'), 'utf8')).toBe(source)
  // Reload from disk, as on service restart; a changed issue ID is not new authority.
  const state = (await readProjectDelivery(workspace, workspace))!
  const baseline = state.designBaseline
  expect(state.designRepair?.findings).toEqual([issue])
  expect(state.designRepair?.resolvedRevision).toBe(baseline!.revision)
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'implementation', status: 'blocked', summary: 'Repeated allegation', designIssues: [{ ...issue, id: 'renamed' }] }))
    .toMatchObject({ phase: 'implementation', shouldContinue: false })
  expect((await readProjectDelivery(workspace, workspace))!.designBaseline).toEqual(baseline)
  expect((await readProjectDelivery(workspace, workspace))!.designRepair!.status).toBe('resolved')
}))

test.each(['independent', 'changed-source'] as const)('a resolved report does not block %s work', mode => fixture(async workspace => {
  await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'implementation', status: 'blocked',
    summary: 'Synthetic allegation', designIssues: [issue] })
  await requestAffectedReview(workspace, [issue])
  await conclude(workspace, 'inspect', [], [{ id: issue.id, evidence: 'Synthetic source inspection rejects this report.' }])
  const next = mode === 'independent' ? { ...issue, id: 'new-report',
    impact: 'Different source-backed outcome', closeWhen: 'Check the different affected outcome' } : issue
  if (mode === 'changed-source') {
    const path = join(workspace, 'docs/UI_UX_SPEC.md')
    await writeFile(path, (await readFile(path, 'utf8')) + '\nChanged source needs a fresh ownership review.\n')
  }
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace, { phase: 'implementation', status: 'blocked',
    summary: 'Synthetic new report', designIssues: [next] })).toMatchObject({ phase: 'implementation', shouldContinue: false })
  await requestAffectedReview(workspace, [next])
  const prepared = (await readProjectDelivery(workspace, workspace))!
  expect(prepared.designRepair?.status).toBe('pending')
  expect(prepared.designReview?.findings).toContainEqual(next)
  if (mode === 'changed-source') expect(prepared.designReview?.findings.some(f => f.owner === 'user' && f.action === 'decide')).toBe(true)
}))

test('unattributed edits require a genuine Question answer and cannot reuse old acceptance', () => fixture(async workspace => {
  const state = (await readProjectDelivery(workspace, workspace))!
  const accepted = { source: 'report' as const, revision: '0'.repeat(64), reportPath: '.beegame/delivery/acceptance.json', reportSha256: '0'.repeat(64), reports: [] }
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, accepted }))
  const path = join(workspace, 'docs/GDD.md')
  await writeFile(path, (await readFile(path, 'utf8')) + '\nUnattributed changed rule.\n')
  let pending = (await requestAffectedReview(workspace))!
  const questionFinding = pending.designReview!.findings[0]!
  expect(questionFinding.owner).toBe('user')
  expect((await evaluateProjectDeliveryGate(workspace, workspace, false))!.allowed).toBe(false)
  expect(pending.accepted).toEqual(accepted)
  expect(await conclude(workspace, 'inspect', [questionFinding])).toMatchObject({ phase: 'review', shouldContinue: true })
  pending = (await readProjectDelivery(workspace, workspace))!
  const question = 'May these saved changes be professionally reviewed and revised?'
  await expect(recordProjectDesignUserDecision(workspace, workspace, pending.designReview!.revision, 'actual-question', { questions: [{ header: questionFinding.id, question }], answers: {} }))
    .rejects.toThrow('Answer every question')
  await recordProjectDesignUserDecision(workspace, workspace, pending.designReview!.revision, 'actual-question', { questions: [{ header: questionFinding.id, question }], answers: { [question]: 'Proceed with review; not a quality approval.' } })
  const snapshot = snapshotDesignDocuments(workspace, pending.designReview!.writableDocuments!)
  expect(await conclude(workspace, 'revise', [questionFinding], [], snapshot)).toMatchObject({ phase: 'review', shouldContinue: true })
  expect(await conclude(workspace, 'verify', [], [{ id: questionFinding.id, evidence: 'Checked retained permission and actual corrected source.' }], undefined, 'implementation'))
    .toMatchObject({ phase: 'implementation', shouldContinue: true })
  expect((await readProjectDelivery(workspace, workspace))!.accepted).toEqual(accepted)
}))

test('Inspect cannot fabricate closure of an unattributed change without a human answer', () => fixture(async workspace => {
  const path = join(workspace, 'docs/GDD.md')
  await writeFile(path, (await readFile(path, 'utf8')) + '\nUnknown source change.\n')
  const pending = (await requestAffectedReview(workspace))!
  const f = pending.designReview!.findings[0]!
  expect(await conclude(workspace, 'inspect', [], [{ id: f.id, evidence: 'Model says approved' }])).toMatchObject({ shouldContinue: false })
  expect((await readProjectDelivery(workspace, workspace))!.designRepair!.status).toBe('stopped')
}))

test('production receipts and acceptance reuse the same optional source-backed designIssues', () => fixture(async workspace => {
  const receipt = join(workspace, 'receipt.txt')
  for (const phase of ['resources', 'content', 'implementation'] as const) {
    await writeFile(receipt, 'blocked\n' + JSON.stringify({ summary: 'Needs owner decision', designIssues: [issue] }))
    expect(await readMilestoneResult(receipt, phase)).toMatchObject({ phase, status: 'blocked', designIssues: [issue] })
  }
  await writeFile(receipt, 'complete\n' + JSON.stringify({ summary: 'Bad issue', designIssues: [{ ...issue, documents: ['invented.md'] }] }))
  expect(await readMilestoneResult(receipt, 'content')).toMatchObject({ status: 'invalid' })
  await writeFile(receipt, 'blocked\n{"error":"Legacy plain reason"}')
  expect(await readMilestoneResult(receipt, 'content')).toMatchObject({ status: 'blocked', summary: '{"error":"Legacy plain reason"}' })
  const report = '.beegame/delivery/acceptance.json'
  await writeFile(join(workspace, report), JSON.stringify({ scope: 'delivery', status: 'blocked', summary: 'Needs owner decision', environment: 'Synthetic fixture', evidencePaths: [], designIssues: [issue] }))
  expect(await readRuntimeAcceptanceReport(workspace, report)).toMatchObject({ status: 'blocked', designIssues: [issue] })
  const state = (await readProjectDelivery(workspace, workspace))!
  await writeFile(projectDeliveryStatePath(workspace, workspace), JSON.stringify({ ...state, phase: 'acceptance' }))
  expect(await advanceProjectDeliveryAfterTurn(workspace, workspace)).toMatchObject({ phase: 'acceptance', shouldContinue: false })
  expect((await readProjectDelivery(workspace, workspace))!.designReview).toBeUndefined()
}))
