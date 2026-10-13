import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { advanceProjectDeliveryAfterTurn, beginProjectDelivery, projectContentAuthority, projectDeliveryStatePath, readProjectDelivery, refreshProjectContentContract } from './project-delivery'
import { prepareLegacyDesignReviewFixture } from './fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { CONTENT_CHECKER_PATH, CONTENT_FORMAT_PATH, DESIGN_CALCULATION_INSTRUCTION, SPATIAL_CALCULATION_INSTRUCTION } from './scene-ui-content-authoring'
import { sharedContentChecker } from './content-checker-runtime'
import { auditBeeGameContentPackage } from './game-content-package'
import { BeeGameSessionManager, type BeeGamePromptInput } from './session-manager'
import { sendProjectConversation } from './project-conversation'
import { BALANCE_CALCULATOR_PATH, materializeBalanceCalculator } from './balance-calculation'
import { designBaselineFixture, designDocumentFixture, designHandoffFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { createHash } from 'node:crypto'
import type { DesignFinding } from './design-handoff'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
import { designHandoffPath } from './design-handoff'

test('simulated native revision repairs retained model/appendix, increases version and reaches read-only verify', async () => {
  const { root, workspace } = await fixture()
  const modelPath = 'docs/calc/model.mjs', appendixPath = 'docs/calc/appendix.md'
  const sidecarPath = '.beegame/design-handoffs/BALANCE_DESIGN.json'
  await mkdir(join(workspace, 'docs/calc'), { recursive: true })
  const model = (value: number) => `export async function calculate({readText}) {
    await readText('docs/BALANCE_DESIGN.md');
    return {tables:[{title:'Synthetic units',columns:['units'],rows:[[${value}]]}],checks:[],limitations:['Synthetic fixture only']};
  }`
  await writeFile(join(workspace, modelPath), model(5))
  await writeDesignDocumentFixture(workspace, 'BALANCE_DESIGN.md', designHandoffFixture('BALANCE_DESIGN.md'),
    designDocumentFixture('BALANCE_DESIGN.md') + '\n[Model](calc/model.mjs)\n[Results](calc/appendix.md)\n')
  await materializeBalanceCalculator(workspace)
  const calculate = async () => {
    const child = Bun.spawn([process.execPath, BALANCE_CALCULATOR_PATH, modelPath, appendixPath], { cwd: workspace, stdout: 'pipe', stderr: 'pipe' })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(exitCode).toBe(0); expect(stderr).toBe('')
  }
  await calculate()
  const originalAppendix = await readFile(join(workspace, appendixPath), 'utf8')
  await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ version: 1, status: 'active', objective: 'Synthetic fixture', phase: 'review', authorBatch: 4 }))
  await prepareLegacyDesignReviewFixture(workspace, root)
  const finding: DesignFinding = { id: 'derived', severity: 'blocker', action: 'correct', owner: 'BALANCE_DESIGN.md',
    documents: ['BALANCE_DESIGN.md'], sources: [{ document: 'BALANCE_DESIGN.md', section: 'Design' }],
    impact: 'Consumer would use an incorrect derived value', closeWhen: 'Model and retained result match the corrected definition', neededBefore: 'UI_UX_SPEC.md' }
  await advanceProjectDeliveryAfterTurn(workspace, root, { phase: 'review', status: 'complete', summary: '', review: { step: 'inspect', findings: [finding], resolved: [] } })
  const steps: string[] = []
  let revisedAppendix = ''
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      const input = turn.projectTurn!
      steps.push(input.reviewStep!)
      const context = await readFile(input.reviewContextPath!, 'utf8')
      expect(context).toContain(finding.closeWhen)
      if (input.reviewStep === 'revise') {
        expect(input.reviewWritableDocuments).toEqual([...PROJECT_DOCUMENTS])
        expect(input.reviewReadScope?.['ART_DIRECTION.md']).toEqual([])
        expect(input.reviewWritableFiles?.sort()).toEqual([
          ...PROJECT_DOCUMENTS.map(designHandoffPath), appendixPath, modelPath, 'content/scenes/level.json', 'content/ui/menu.json',
        ].sort())
        // The native writer corrects the decision; the host owns the version.
        await writeDesignDocumentFixture(workspace, 'BALANCE_DESIGN.md', designHandoffFixture('BALANCE_DESIGN.md'),
          (await readFile(join(workspace, 'docs/BALANCE_DESIGN.md'), 'utf8')) + '\nCorrected synthetic definition.\n')
        await writeFile(join(workspace, modelPath), model(7))
        await calculate()
        revisedAppendix = await readFile(join(workspace, appendixPath), 'utf8')
        expect(revisedAppendix).not.toBe(originalAppendix)
        expect(revisedAppendix).toContain('| 7 |')
        const digest = createHash('sha256').update((await readFile(join(workspace, 'docs/BALANCE_DESIGN.md'), 'utf8'))
          .replace(/^- Version: v1\.0\n/m, '')).digest('hex')
        expect(revisedAppendix).toContain(digest)
        await writeFile(input.reviewResultPath!, 'complete\n' + JSON.stringify({ step: 'revise', findings: [finding], resolved: [] }))
      } else {
        expect(input.reviewStep).toBe('verify')
        expect(input.reviewWritableFiles).toEqual([])
        expect(context).toContain('do not execute project-authored code')
        expect(await readFile(join(workspace, appendixPath), 'utf8')).toBe(revisedAppendix)
        const saved = await readFile(join(workspace, 'docs/BALANCE_DESIGN.md'), 'utf8')
        expect(saved).toContain('- Version: v1.1')
        expect(revisedAppendix).toContain(createHash('sha256').update(saved.replace(/^- Version: v1\.1\n/m, '')).digest('hex'))
        expect((await command(workspace, '--design-handoff', '5')).result.valid).toBe(true)
        await writeFile(input.reviewResultPath!, 'complete\n' + JSON.stringify({ step: 'verify', findings: [], resolved: [{ id: finding.id, evidence: 'Synthetic corrected source/model/result inspected' }] }))
      }
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Synthetic bounded step completed' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    for (const step of ['revise', 'verify']) {
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id, ownerId: 'owner', message: 'Continue', autoContinuation: true })
      await manager.waitForSessionIdle(session.id)
      expect(steps.at(-1)).toBe(step)
    }
    expect((await readProjectDelivery(workspace, root))?.designBaseline?.documentVersions?.['BALANCE_DESIGN.md']).toBe('1.1')
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('resources')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test.each([
  ['LEVEL_SCENE_DESIGN.md', 'content/scenes/level.json'],
  ['UI_UX_SPEC.md', 'content/ui/menu.json'],
  ['GDD.md', 'docs/GDD.md'],
] as const)('revision of %s includes dependent calculation owner and reaches verify', async (owner, sourcePath) => {
  const { root, workspace } = await fixture()
  const modelPath = 'docs/calc/dependent.mjs', appendixPath = 'docs/calc/dependent.md'
  await mkdir(join(workspace, 'docs/calc'), { recursive: true })
  await writeFile(join(workspace, modelPath), `export async function calculate({readText}) {
    const text = await readText(${JSON.stringify(sourcePath)});
    return {tables:[{title:'Synthetic source size',columns:['bytes'],rows:[[text.length]]}],
      checks:[],limitations:['Dependency plumbing only, not game feasibility']}; }`)
  // Only the result is linked; its retained record already identifies the model.
  await writeFile(join(workspace, 'docs/BALANCE_DESIGN.md'),
    (await readFile(join(workspace, 'docs/BALANCE_DESIGN.md'), 'utf8')) + '\n[Result](calc/dependent.md)\n')
  await materializeBalanceCalculator(workspace)
  const calculate = async () => {
    const child = Bun.spawn([process.execPath, BALANCE_CALCULATOR_PATH, modelPath, appendixPath],
      { cwd: workspace, stdout: 'pipe', stderr: 'pipe' })
    const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ code, error }).toEqual({ code: 0, error: '' }); expect(JSON.parse(output).output).toBe(appendixPath)
  }
  await calculate()
  await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ version: 1, status: 'active', objective: 'Synthetic dependency repair', phase: 'review', authorBatch: 4 }))
  await prepareLegacyDesignReviewFixture(workspace, root)
  const finding: DesignFinding = { id: 'source', severity: 'blocker', action: 'correct', owner,
    documents: [owner], sources: [{ document: owner, section: 'Design' }],
    impact: 'Synthetic input correction affects an existing derived result', closeWhen: 'Correct source and refresh dependent result', neededBefore: 'implementation' }
  await advanceProjectDeliveryAfterTurn(workspace, root, { phase: 'review', status: 'complete', summary: '',
    review: { step: 'inspect', findings: [finding], resolved: [] } })
  const steps: string[] = []
  const manager = new BeeGameSessionManager({ async start() { return { stop() {}, async submit(turn) {
    const input = turn.projectTurn!; steps.push(input.reviewStep!)
    if (input.reviewStep === 'revise') {
      expect(input.reviewWritableDocuments).toContain(owner)
      expect(input.reviewWritableDocuments).toContain('BALANCE_DESIGN.md')
      expect(input.reviewReadScope?.['ART_DIRECTION.md']).toEqual([])
      expect(input.reviewWritableFiles).toContain(modelPath)
      expect(input.reviewWritableFiles).toContain(appendixPath)
      const path = join(workspace, sourcePath), source = await readFile(path, 'utf8')
      if (sourcePath.endsWith('.json')) {
        const data = JSON.parse(source); data.data.nodes[1].name = 'Corrected synthetic node'
        await writeFile(path, JSON.stringify(data))
      } else await writeFile(path, source + '\nCorrected synthetic rule.\n')
      expect((await command(workspace, '--design-handoff', '5')).result.issues.join(' ')).toContain('Input changed')
      await calculate()
    } else {
      expect(input.reviewStep).toBe('verify'); expect(input.reviewWritableFiles).toEqual([])
      expect((await command(workspace, '--design-handoff', '5')).result.valid).toBe(true)
      expect(await readFile(join(workspace, 'docs/BALANCE_DESIGN.md'), 'utf8')).toContain('- Version: v1.1')
    }
    await writeFile(input.reviewResultPath!, 'complete\n' + JSON.stringify({ step: input.reviewStep,
      findings: input.reviewStep === 'revise' ? [finding] : [],
      resolved: input.reviewStep === 'verify' ? [{ id: finding.id, evidence: 'Synthetic source and retained result inspected' }] : [] }))
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Synthetic dispatch only' })
  } } } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    for (const step of ['revise', 'verify']) {
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id, ownerId: 'owner', message: 'Continue', autoContinuation: true })
      await manager.waitForSessionIdle(session.id); expect(steps.at(-1)).toBe(step)
    }
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('resources')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bgs-content-handoff-'))
  const workspace = join(root, 'project')
  await mkdir(workspace)
  await beginProjectDelivery(workspace, root, 'Build a game')
  await writeDesignDocumentsFixture(workspace)
  await mkdir(join(workspace, 'assets/runtime/example'), { recursive: true })
  await writeFile(join(workspace, 'assets/runtime/example/resource.json'), '{}')
  await writeBeeGameAssetManifest(workspace, assetManifestAuthoringExamples().canonical)
  return { root, workspace }
}

async function command(workspace: string, ...args: string[]) {
  const checker = await sharedContentChecker()
  const child = Bun.spawn([process.execPath, CONTENT_CHECKER_PATH, ...args], {
    cwd: workspace, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: checker.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect(stderr).toBe('')
  return { code, result: JSON.parse(stdout) }
}

test('spatial author and review turns receive and can execute the same calculator in one native session', async () => {
  const { root, workspace } = await fixture()
  const prompts: string[] = []
  const contexts: string[] = []
  const calculations: unknown[] = []
  let starts = 0
  // Drafts have no resources, content index or full-game implementation.
  const ui = { schema: 'beegame-content.v1', kind: 'ui-hud', id: 'draft', assetRefs: [], data: {
    rootId: 'root', nodes: [
      { id: 'root', role: 'hud-root', layout: { container: { direction: 'column', align: 'stretch' } } },
      { id: 'hud', role: 'container', parentId: 'root', layout: { item: { basis: 48 } } },
      { id: 'game-view', role: 'container', parentId: 'root', layout: { item: { grow: 1 } } },
    ],
  } }
  await writeFile(join(workspace, 'layout-draft.json'), JSON.stringify(ui))
  await writeFile(join(workspace, 'camera-draft.json'), JSON.stringify({ orthographic: false,
    fieldOfView: 60, viewport: { width: 960, height: 540 }, framing: 'expand' }))
  const manager = new BeeGameSessionManager({ async start(start) {
    starts++
    return { stop() {}, async submit(turn) {
      prompts.push(JSON.stringify(turn.prompt))
      contexts.push(await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'context.md'), 'utf8'))
      const layout = await command(workspace, '--layout-draft', 'layout-draft.json', '390', '844', '--details')
      calculations.push(layout)
      const bounds = layout.result.nodes.find((node: any) => node.id === 'game-view').bounds
      calculations.push(await command(workspace, '--camera-draft', 'camera-draft.json',
        String(bounds.right - bounds.left), String(bounds.bottom - bounds.top)))
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Calculation checked' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    for (const [phase, authorBatch] of [['author', 1], ['author', 2], ['review', 4]] as const) {
      await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ version: 1,
        status: 'active', objective: 'Build a game', phase, authorBatch }))
      if (phase === 'review') await prepareLegacyDesignReviewFixture(workspace, root)
      // Resumed pre-update projects must receive the command too.
      await rm(join(workspace, CONTENT_CHECKER_PATH))
      await rm(join(workspace, CONTENT_FORMAT_PATH))
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
        sessionId: session.id, ownerId: 'owner', message: 'Continue', autoContinuation: true })
      await manager.waitForSessionIdle(session.id)
    }
    expect(starts).toBe(1)
    expect(prompts).toHaveLength(3)
    expect(prompts[0]).toContain('--format coordinates runtimeConsumption')
    expect(prompts[0]).not.toContain('Design calculations:')
    for (const prompt of prompts.slice(1)) {
      expect(prompt).toContain('check-content.mjs --help includes commands')
      expect(prompt).toContain('Eight-document author/review delivers planning documents and owner-linked content/scenes and content/ui layout files')
      expect(prompt).not.toContain('Missing complete Scene/UI previews remain unresolved')
      expect(prompt).not.toContain(JSON.stringify(SPATIAL_CALCULATION_INSTRUCTION).slice(1, -1))
      expect(prompt).not.toContain('Arrange an independent check')
      expect(prompt).not.toContain('As a document becomes ready')
    }
    for (const context of contexts.slice(1)) {
      expect(context).toContain(DESIGN_CALCULATION_INSTRUCTION)
      expect(context).not.toContain(SPATIAL_CALCULATION_INSTRUCTION)
    }
    expect(calculations).toHaveLength(6)
    for (let i = 0; i < calculations.length; i += 2) {
      expect(calculations[i]).toMatchObject({ code: 0, result: { runtimeVerified: false, nodes: [
        { id: 'root' }, { id: 'hud', bounds: { left: 0, top: 0, right: 390, bottom: 48 } },
        { id: 'game-view', bounds: { left: 0, top: 48, right: 390, bottom: 844 } },
      ] } })
      expect(calculations[i + 1]).toMatchObject({ code: 0, result: {
        scope: 'camera-framing-draft-inspection', runtimeVerified: false, view: { projection: 'perspective' },
      } })
    }
    expect(await Bun.file(join(workspace, 'content/index.json')).exists()).toBe(false)
    expect(existsSync(join(workspace, 'content/ui/menu.json'))).toBe(true)
    expect(await readFile(join(workspace, 'layout-draft.json'), 'utf8')).toBe(JSON.stringify(ui))
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('design-time format is not a fake authority; standalone checker and host agree without changing game files', async () => {
  const { root, workspace } = await fixture()
  try {
    const format = JSON.parse(await readFile(join(workspace, CONTENT_FORMAT_PATH), 'utf8'))
    // The shared format example is a placeholder, never an approval/hash.
    // This legacy materializer still supplies actual identity in its contract.
    expect(format.index.documentRevision).toContain('<required compatibility field:')
    expect(format.index.documentRevision).toContain('--package-metadata')
    expect(format.index.documentRevision).not.toMatch(/^[a-f0-9]{64}$/)
    expect(format.revisionFields).toContain('BGS-supplied')
    expect(format.revisionFields).toContain('none are available at design time')
    expect(format.runtimeConsumption.responsive).toContain('not permission to replace authored layout')
    expect(format.uiLayoutContract.textStyle).toContain('logical-pixel lengths, not unitless CSS multipliers')
    expect(format.runtimeConsumption.checks['ui-layout'].outcome).toContain('text alone is not layout verification')
    expect(await Bun.file(join(workspace, '.beegame/delivery/content-contract.json')).exists()).toBe(false)
    const inputs = await refreshProjectContentContract(workspace)
    const contract = JSON.parse(await readFile(join(workspace, '.beegame/delivery/content-contract.json'), 'utf8'))
    expect(Object.keys(contract).sort()).toEqual(['formatReference', 'index', 'inputs'])
    expect(contract.formatReference).toBe(CONTENT_FORMAT_PATH)
    expect(contract.inputs).toEqual(inputs)
    expect(contract.index.documentRevision).toBe(inputs.documentRevision)
    expect(contract.index.assetManifestRevision).toBe(inputs.assetManifestRevision)
    expect(await readFile(join(workspace, CONTENT_FORMAT_PATH), 'utf8')).toContain('sceneVocabulary')
    expect(Buffer.byteLength(JSON.stringify(contract))).toBeLessThan(Buffer.byteLength(JSON.stringify(format)) / 4)
    expect(inputs.validationCommand).toBe(`bun ${CONTENT_CHECKER_PATH}`)
    expect(inputs.layoutInspectionCommand).toBe(`bun ${CONTENT_CHECKER_PATH} --design-layouts --report`)
    expect(inputs.inspectionCommand).toContain('bind-content.mjs --inspect')
    expect(format.sceneLayoutBatchInspectionCommand).toBe(`bun ${CONTENT_CHECKER_PATH} --scene-layouts --report`)
    expect(format.sceneVocabulary.requiredData.camera.orthographicSize).toContain('pixelsPerUnit')
    expect(format.rules.join('\n')).toContain('requires node.assetRef')
    expect(format.rules.join('\n')).toContain('Shared gameplay tuning or other project-specific data')
    const authority = projectContentAuthority(workspace)
    expect((await command(workspace, '--authority')).result).toMatchObject({
      ok: true, documentRevision: authority.documentRevision, assetManifestRevision: authority.assetManifestRevision,
    })
    expect((await command(workspace)).result.issues).toEqual(auditBeeGameContentPackage(workspace, authority).issues)
    await mkdir(join(workspace, 'content/scenes'), { recursive: true })
    const index = { schema: 'beegame-content-package.v2', id: 'game', dimension: '2d',
      documentRevision: authority.documentRevision, assetManifestRevision: authority.assetManifestRevision,
      sceneModel: 'game-object-v2', entryScene: 'scene', files: ['scenes/main.json'] }
    const scene = { schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: [],
      data: { settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels', width: 960, height: 540, pixelsPerUnit: 100 } },
        nodes: [{ id: 'root', components: [] }] } }
    const sceneBytes = JSON.stringify(scene)
    await writeFile(join(workspace, 'content/scenes/main.json'), sceneBytes)
    for (const candidate of [index, { ...index, documentRevision: 'a'.repeat(64) }, { ...index, dimension: '2D' }]) {
      const indexBytes = JSON.stringify(candidate)
      await writeFile(join(workspace, 'content/index.json'), indexBytes)
      const host = auditBeeGameContentPackage(workspace, authority)
      const local = await command(workspace)
      expect(local.result.issues).toEqual(host.issues)
      expect(local.code).toBe(host.valid ? 0 : 1)
      expect(await readFile(join(workspace, 'content/index.json'), 'utf8')).toBe(indexBytes)
      expect(await readFile(join(workspace, 'content/scenes/main.json'), 'utf8')).toBe(sceneBytes)
    }
    await mkdir(join(workspace, 'content/ui'), { recursive: true })
    await writeFile(join(workspace, 'content/ui/menu.json'), JSON.stringify({ kind: 'ui-screen', data: {
      rootId: 'root', nodes: [{ id: 'root', layout: { size: [960, 540] } },
        { id: 'button', parentId: 'root', layout: { anchor: 'middle-center', size: [200, 40] } }],
    } }))
    await writeFile(join(workspace, 'content/index.json'), JSON.stringify({ ...index, files: [...index.files, 'ui/menu.json'] }))
    expect((await command(workspace, '--layout', 'ui/menu.json', '640', '360', '--details')).result).toMatchObject({
      scope: 'layout-inspection', runtimeVerified: false,
      nodes: [{ id: 'root' }, { id: 'button', bounds: { left: 220, top: 160, right: 420, bottom: 200 } }],
    })
    await writeFile(join(workspace, 'docs/GDD.md'), '# Changed design\n')
    const current = (await command(workspace, '--authority')).result
    expect(current.documentRevision).toBe(projectContentAuthority(workspace).documentRevision)
    expect(current.documentRevision).not.toBe(inputs.documentRevision)
    const handoffPath = join(workspace, '.beegame/design-handoffs/GDD.json')
    const handoff = JSON.parse(await readFile(handoffPath, 'utf8'))
    const sourceBytes = await readFile(join(workspace, 'docs/GDD.md'), 'utf8')
    await writeFile(handoffPath, JSON.stringify({ ...handoff,
      outputs: handoff.outputs.map((output: { id: string }) => ({ ...output, id: output.id + '-revised' })) }))
    const sidecarChanged = (await command(workspace, '--authority')).result
    expect(sidecarChanged.documentRevision).not.toBe(current.documentRevision)
    expect(sidecarChanged.documentRevision).toBe(projectContentAuthority(workspace).documentRevision)
    expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(sourceBytes)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('numerical authors generate evidence; read-only review inspects it without executing project code', async () => {
  const { root, workspace } = await fixture()
  const calculations: number[] = []
  const helpers: boolean[] = []
  await writeFile(join(workspace, 'formula.mjs'), `export async function calculate() {
    return {tables:[{title:'Derived',columns:['value'],rows:[[6 * 7]]}],
      observations:[{before:5,requested:9,actual:5,after:0}],
      checks:[{name:'sequence',passed:true,details:'fixture only'}],limitations:['Not gameplay evidence']};
  }`)
  let generated = ''
  let inspected = false
  const manager = new BeeGameSessionManager({ async start(start) {
    return { stop() {}, async submit(turn) {
      helpers.push(await Bun.file(join(workspace, '.beegame/delivery/content-consumer.mjs')).exists())
      expect(JSON.stringify(turn.prompt)).toContain('check-content.mjs --help includes commands')
      expect(await readFile(join(workspace, '.beegame/delivery/content-consumer.mjs'), 'utf8')).toContain('inspectUiLayoutInBrowser')
      if (turn.directionAuthors?.responsibilities['BALANCE_DESIGN.md']) {
        const child = Bun.spawn([process.execPath, BALANCE_CALCULATOR_PATH, 'formula.mjs', 'calculated.md'],
          { cwd: workspace, stdout: 'pipe', stderr: 'pipe' })
        const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
        calculations.push(code)
        expect(stderr).toBe('')
        generated = await readFile(join(workspace, 'calculated.md'), 'utf8')
        expect(generated).toContain('| 42 |')
        expect(generated).toContain('Independent verification was not run')
      } else if (turn.projectTurn?.reviewStep === 'inspect') {
        expect(turn.projectTurn?.reviewStep).toBe('inspect')
        expect(JSON.stringify(turn.prompt)).toContain('do not execute project-authored code')
        expect(await readFile(join(workspace, 'calculated.md'), 'utf8')).toBe(generated)
        expect((await command(workspace, '--design-handoff', '5')).result.valid).toBe(true)
        inspected = true
      }
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Tool availability checked' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    for (const [phase, authorBatch] of [['author', 2], ['author', 3], ['review', 4]] as const) {
      await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ version: 1,
        status: 'active', objective: 'Build a game', phase, authorBatch }))
      if (phase === 'review') await prepareLegacyDesignReviewFixture(workspace, root)
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
        sessionId: session.id, ownerId: 'owner', message: 'Continue', autoContinuation: true })
      await manager.waitForSessionIdle(session.id)
    }
    expect(calculations).toEqual([0])
    expect(inspected).toBe(true)
    expect(helpers).toEqual([true, true, true])
    expect(await Bun.file(join(workspace, '.beegame/tmp', session.id, 'content-consumer.mjs')).exists()).toBe(false)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('actual native turns receive fresh phase, revision inputs and resource entry without reading the context file', async () => {
  const { root, workspace } = await fixture()
  const prompts: BeeGamePromptInput[] = []
  const resourceScripts: string[] = []
  const contentHelpers: boolean[] = []
  let starts = 0
  const manager = new BeeGameSessionManager({ async start(start) {
    starts++
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
      resourceScripts.push(await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'assets.mjs'), 'utf8'))
      contentHelpers.push(await Bun.file(join(workspace, '.beegame/delivery/content-consumer.mjs')).exists())
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    const send = async (phase: string, origin: string) => {
      // Explicit authority test double: this tests transport of changing inputs,
      // not design release or authorization to rebaseline a live project.
      await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ version: 1, status: 'active', objective: 'Build a game', phase,
        ...(phase === 'author' ? {} : { designBaseline: designBaselineFixture(workspace) }) }))
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id, ownerId: 'owner',
        message: 'Continue', autoContinuation: true,
        openCapabilities: () => ({ instruction: 'Optional assets', resourceTools: { libraryBaseUrl: origin }, close: async () => {} }) })
      await manager.waitForSessionIdle(session.id)
    }
    await send('author', 'http://127.0.0.1:11111')
    const firstAuthority = projectContentAuthority(workspace)
    await send('content', 'http://127.0.0.1:22222')
    await writeFile(join(workspace, 'docs/GDD.md'), designDocumentFixture('GDD.md') + '\n# Revised\n')
    await send('content', 'http://127.0.0.1:33333')
    await send('implementation', 'http://127.0.0.1:44444')
    expect(starts).toBe(1)
    expect(JSON.stringify(prompts[0])).toContain('milestone: author')
    // The native Agent receives the assignment without a compulsory context-file
    // read. This runner deliberately never reads context.md.
    expect(JSON.stringify(prompts[0])).toContain('GDD.md')
    expect(JSON.stringify(prompts[0])).toContain('Build a game')
    expect(JSON.stringify(prompts[1])).toContain('Bind delivered resources and runtime interfaces into the existing reviewed Scene/UI sources')
    expect(JSON.stringify(prompts[1])).not.toContain('Do not start runtime implementation')
    expect(JSON.stringify(prompts[1])).toContain(firstAuthority.documentRevision)
    expect(JSON.stringify(prompts[1])).toContain('check-content.mjs')
    expect(JSON.stringify(prompts[2])).toContain(projectContentAuthority(workspace).documentRevision)
    expect(JSON.stringify(prompts[2])).not.toContain(firstAuthority.documentRevision)
    expect(JSON.stringify(prompts[2])).toContain('assets.mjs help')
    expect(resourceScripts[2]).toContain('33333')
    expect(resourceScripts[2]).not.toContain('22222')
    expect(contentHelpers).toEqual([true, true, true, true])
    expect(JSON.stringify(prompts[3])).toContain('content-consumer.mjs')
    expect(JSON.stringify(prompts[3])).not.toContain('Publish reads')
    expect(await Bun.file(join(workspace, '.beegame/tmp', session.id, 'content-consumer.mjs')).exists()).toBe(false)
    expect(manager.events(session.id).filter(e => e.type === 'user.message').map(e => e.text))
      .toEqual(['Continue', 'Continue', 'Continue', 'Continue'])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})
