import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { BEEGAME_SCENE_MODEL } from './game-content-package'
import { readRuntimeAcceptanceReport } from './runtime-acceptance'
import { AUTHOR_BATCHES } from './project-author'
import { designDocumentFixture, designRequirementChecksFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture, writeUiLayoutFixture } from './fixtures/layout-fixture'
import {
  advanceProjectDeliveryAfterTurn,
  beginProjectDelivery,
  captureProjectDeliveryAcceptance,
  evaluateProjectDeliveryGate,
  pauseProjectDelivery,
  prepareProjectDesignReview,
  PROJECT_DOCUMENTS,
  PROJECT_DELIVERY_REPORT_PATH,
  projectDeliveryStatePath,
  projectContentAuthority,
  projectDeliveryPhaseInstruction,
  readProjectDelivery,
  resumeProjectDelivery,
  refreshProjectContentContract,
} from './project-delivery'

async function completeReview(workspace: string, root: string) {
  await prepareProjectDesignReview(workspace, root)
  return advanceProjectDeliveryAfterTurn(workspace, root, { phase: 'review', status: 'complete', summary: '',
    review: { step: 'inspect', findings: [], resolved: [] } })
}

async function enterContentFixture(workspace: string, dataRoot: string, height = 52) {
  await writeDesignDocumentsFixture(workspace)
  await mkdir(join(workspace, 'assets/runtime/example'), { recursive: true })
  await writeFile(join(workspace, 'assets/runtime/example/resource.json'), '{}')
  await writeBeeGameAssetManifest(workspace, assetManifestAuthoringExamples().canonical)
  const state = await readProjectDelivery(workspace, dataRoot)
  await writeFile(projectDeliveryStatePath(workspace, dataRoot), JSON.stringify({ ...state, phase: 'content' }))
  await refreshProjectContentContract(workspace)
  await writeUiLayoutFixture(workspace, height)
  const authority = projectContentAuthority(workspace)
  await mkdir(join(workspace, 'content/scenes'), { recursive: true })
  await writeFile(join(workspace, 'content/index.json'), JSON.stringify({
    schema: 'beegame-content-package.v2', id: 'game', dimension: '2d',
    documentRevision: authority.documentRevision, assetManifestRevision: authority.assetManifestRevision,
    entryScene: 'scene', sceneModel: BEEGAME_SCENE_MODEL, files: ['scenes/main.json', 'ui/menu.json'],
  }))
  await writeFile(join(workspace, 'content/scenes/main.json'), JSON.stringify({
    schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: [],
    data: { settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels',
      width: 1280, height: 720, pixelsPerUnit: 1 } }, nodes: [{ id: 'root', components: [] }] },
  }))
}

async function enterAcceptanceFixture(workspace: string, dataRoot: string): Promise<void> {
  const state = await readProjectDelivery(workspace, dataRoot)
  await writeFile(projectDeliveryStatePath(workspace, dataRoot), JSON.stringify({ ...state, phase: 'acceptance' }))
}

test.each(['author', 'review', 'implementation'] as const)('%s advances only on the Agent current milestone conclusion', async phase => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-milestone-conclusion-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Build a game')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase }))
    if (phase === 'author') {
      await mkdir(join(workspace, 'docs'))
      await writeFile(join(workspace, 'docs/GDD.md'), '# Existing draft is not a completion signal')
    }
    expect(await advanceProjectDeliveryAfterTurn(workspace, root)).toMatchObject({ phase, shouldContinue: false })
    expect(await advanceProjectDeliveryAfterTurn(workspace, root, {
      phase, status: 'blocked', summary: 'Design decision unresolved',
    })).toMatchObject({ phase, shouldContinue: false, ...(phase === 'review' ? {} : { issues: ['Design decision unresolved'] }) })
    expect(await advanceProjectDeliveryAfterTurn(workspace, root, {
      phase: phase === 'review' ? 'implementation' : 'review', status: 'complete', summary: '',
    })).toMatchObject({ phase, shouldContinue: false })
    if (phase === 'review') {
      expect((await advanceProjectDeliveryAfterTurn(workspace, root, { phase, status: 'complete', summary: '' }))?.issues)
        .toContain('Review has no valid version-bound result for its current step.')
      await writeDesignDocumentsFixture(workspace)
    }
    if (phase === 'author') await writeDesignDocumentFixture(workspace, 'GDD.md')
    expect(phase === 'review' ? await completeReview(workspace, root) : await advanceProjectDeliveryAfterTurn(workspace, root, { phase, status: 'complete', summary: '' }))
      .toMatchObject({ phase: phase === 'author' ? 'author' : phase === 'review' ? 'resources' : 'acceptance', shouldContinue: true })
    expect(existsSync(join(workspace, 'content/index.json'))).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('writing keeps real dependency groups and one independent review after all eight drafts', () => {
  expect(AUTHOR_BATCHES).toEqual([
    ['GDD.md'],
    ['TECHNICAL_DESIGN.md', 'ART_DIRECTION.md', 'AUDIO_DESIGN.md'],
    ['LEVEL_SCENE_DESIGN.md', 'BALANCE_DESIGN.md'],
    ['UI_UX_SPEC.md'],
    ['TECHNICAL_DESIGN.md', 'ASSET_PLAN.md'],
  ])
  expect([...new Set(AUTHOR_BATCHES.flat())].sort()).toEqual([...PROJECT_DOCUMENTS].sort())
  const earlyTech = projectDeliveryPhaseInstruction('author', 1)
  const finalTech = projectDeliveryPhaseInstruction('author', 4)
  expect(earlyTech).toContain('saved prior drafts')
  expect(earlyTech).toContain('not reviewed quality guarantees')
  expect(earlyTech).toContain('technical baseline')
  expect(earlyTech).not.toContain('including initialization, important transitions, restart and cleanup')
  expect(finalTech).toContain('including initialization, important transitions, restart and cleanup')
  for (const [batch, documents] of AUTHOR_BATCHES.entries()) {
    const author = projectDeliveryPhaseInstruction('author', batch)
    for (const document of documents) expect(author).toContain(document)
    expect(author).toContain('no fixed review occurs between writing groups')
    expect(author).toContain('one independent joint Review follows completion of all eight documents')
  }
  const review = projectDeliveryPhaseInstruction('review')
  for (const document of PROJECT_DOCUMENTS) expect(review).toContain(document)
  expect(review).toContain('fresh native bgs-design-review subagent')
  expect(review).toContain('game-design-check Skill')
  expect(review).toContain('Author reasoning, expected findings and expected verdicts are not review inputs')
  expect(review).toContain('Remaining blockers after verify stop automatic work')
})

test('production keeps reviewed design authority and actual runtime acceptance', () => {
  const implementation = projectDeliveryPhaseInstruction('implementation')
  expect(implementation).toContain('no fixed step sequence')
  expect(implementation).toContain('do not maintain a separate substitute layout')
  expect(implementation).toContain('Do not edit them during implementation')
  expect(implementation).toContain('Implementation self-checks do not replace subsequent acceptance')
  expect(implementation).toContain('target-runtime observation for rendering')
  expect(projectDeliveryPhaseInstruction('content')).toContain('do not choose a new layout or interaction design')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('actual target runtime')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('Do not edit the reviewed design')
})

test('Review diagnoses the actual UI data without creating a full package or modifying it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-review-documents-only-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Build a game')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'review' }))
    await writeDesignDocumentsFixture(workspace)
    await writeUiLayoutFixture(workspace, 28)
    const path = join(workspace, 'content/ui/menu.json')
    const before = await readFile(path, 'utf8')
    expect(await completeReview(workspace, root))
      .toMatchObject({ phase: 'review', shouldContinue: true, issues: [] })
    expect((await readProjectDelivery(workspace, root))?.designReview).toMatchObject({ step: 'revise', writableDocuments: ['UI_UX_SPEC.md'] })
    expect(existsSync(join(workspace, 'content/index.json'))).toBe(false)
    expect(await readFile(path, 'utf8')).toBe(before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Content cannot advance broken geometry and does not repeatedly dispatch an unchanged failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-content-geometry-gate-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, JSON.stringify({ settings: { orientation: 'Landscape' } }))
    await enterContentFixture(workspace, root, 28)
    for (let i = 0; i < 2; i++) {
      const result = await advanceProjectDeliveryAfterTurn(workspace, root)
      expect(result).toMatchObject({ phase: 'content', shouldContinue: i === 0 })
      expect(result!.issues.join(' ')).toContain('minimumControlSize')
    }
    await writeUiLayoutFixture(workspace, 52)
    expect(await advanceProjectDeliveryAfterTurn(workspace, root))
      .toMatchObject({ phase: 'implementation', shouldContinue: true, issues: [] })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Content completion cannot bypass ignored layout fields or declared clearance violations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-content-layout-contract-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Build a game')
    await enterContentFixture(workspace, root)
    const path = join(workspace, 'content/ui/menu.json')
    const ui = JSON.parse(await readFile(path, 'utf8'))
    ui.data.nodes[0].data.container = { direction: 'column' }
    await writeFile(path, JSON.stringify(ui))
    let result = await advanceProjectDeliveryAfterTurn(workspace, root)
    expect(result).toMatchObject({ phase: 'content' })
    expect(result!.issues.join(' ')).toContain('layout.container')

    delete ui.data.nodes[0].data.container
    ui.data.nodes[1].data = { layoutOcclusion: 'occluder' }
    ui.data.nodes.push({ id: 'clearance', role: 'container', parentId: 'root', data: { layoutOcclusion: 'protected' },
      layout: { anchor: 'middle-center', size: [200, 100] } })
    await writeFile(path, JSON.stringify(ui))
    result = await advanceProjectDeliveryAfterTurn(workspace, root)
    expect(result).toMatchObject({ phase: 'content' })
    expect(result!.issues.join(' ')).toContain('declared occluders: play')
    expect((await readProjectDelivery(workspace, root))!.phase).toBe('content')

    ui.data.nodes[1].layout.position = [0, 150]
    await writeFile(path, JSON.stringify(ui))
    // This fixture has no reviewed baseline; baseline mutation is tested separately.
    expect(await advanceProjectDeliveryAfterTurn(workspace, root))
      .toMatchObject({ phase: 'implementation', shouldContinue: true, issues: [] })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Content requires declared supported sizes and the confirmed orientation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-content-supported-sizes-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, JSON.stringify({ settings: { orientation: 'Landscape' } }))
    await enterContentFixture(workspace, root)
    const path = join(workspace, 'content/ui/menu.json')
    const ui = JSON.parse(await readFile(path, 'utf8'))
    const data = ui.data.nodes[0].data
    delete data.targetViewports
    await writeFile(path, JSON.stringify(ui))
    let result = await advanceProjectDeliveryAfterTurn(workspace, root)
    expect(result?.phase).toBe('content')
    expect(result?.issues.join(' ')).toContain('targetViewports')
    data.targetViewports = [[600, 360]]
    data.orientation = 'Portrait'
    await writeFile(path, JSON.stringify(ui))
    result = await advanceProjectDeliveryAfterTurn(workspace, root)
    expect(result?.phase).toBe('content')
    expect(result?.issues.join(' ')).toContain('differs from the confirmed brief')
    data.orientation = 'Landscape'
    await writeFile(path, JSON.stringify(ui))
    expect((await advanceProjectDeliveryAfterTurn(workspace, root))?.phase).toBe('implementation')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('unrelated writes cannot repeatedly dispatch an unchanged validation failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-failure-dedup-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Build a game')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, authorBatch: 1 }))
    expect((await advanceProjectDeliveryAfterTurn(workspace, root))?.shouldContinue).toBe(false)
    await writeFile(join(workspace, 'notes.txt'), 'Still investigating')
    expect((await advanceProjectDeliveryAfterTurn(workspace, root))?.shouldContinue).toBe(false)
    await mkdir(join(workspace, 'docs'))
    await writeDesignDocumentsFixture(workspace, AUTHOR_BATCHES.slice(0, 2).flat())
    // Saved files and ordinary chat are not the scheduled authors' completion.
    expect((await advanceProjectDeliveryAfterTurn(workspace, root))?.shouldContinue).toBe(false)
    expect((await advanceProjectDeliveryAfterTurn(workspace, root, undefined, 1))?.shouldContinue).toBe(true)
    expect(await readProjectDelivery(workspace, root)).toMatchObject({ phase: 'author', authorBatch: 2 })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a blocked acceptance waits for user action instead of dispatching another automatic turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-blocked-acceptance-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
    const state = await beginProjectDelivery(workspace, root, 'Build a game')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'acceptance' }))
    await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({
      scope: 'delivery', status: 'blocked', summary: 'Preview browser unavailable',
      environment: 'Browser unavailable', evidencePaths: [],
      verification: { target: 'deployment', observation: 'simulation', knownIssues: [], unverified: ['Browser gameplay'] },
    }))
    expect(await advanceProjectDeliveryAfterTurn(workspace, root)).toMatchObject({
      phase: 'acceptance', shouldContinue: false, issues: ['Preview browser unavailable'],
    })
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('acceptance')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a project paused at the removed visual approval stage resumes in resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-removed-visual-review-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Build a game')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({
      ...state, phase: 'visual-review', visualReviewApprovedDigest: 'old-approval',
    }))
    expect(await readProjectDelivery(workspace, root)).toMatchObject({ phase: 'resources' })
    expect((await advanceProjectDeliveryAfterTurn(workspace, root))?.phase).toBe('resources')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('acceptance reports return the actual schema error instead of a generic retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-acceptance-feedback-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
    await beginProjectDelivery(workspace, root, 'Build a game')
    await enterAcceptanceFixture(workspace, root)
    await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({
      scope: 'delivery', status: 'passed', summary: 'Tested in browser',
      environment: { browser: 'Chrome' }, evidencePaths: [], artifactPaths: [],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [] },
    }))
    const first = await advanceProjectDeliveryAfterTurn(workspace, root)
    expect(first?.phase).toBe('acceptance')
    expect(first?.issues.join(' ')).toContain('environment')
    expect(first?.issues.join(' ')).toContain('string')
    expect(first?.shouldContinue).toBe(true)
    expect((await evaluateProjectDeliveryGate(workspace, root))?.issues.join(' ')).toContain('environment')
    expect((await advanceProjectDeliveryAfterTurn(workspace, root))?.shouldContinue).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('an implementation PASS cannot skip target-runtime acceptance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-implementation-evidence-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
    await beginProjectDelivery(workspace, root, 'Build a game')
    const state = await readProjectDelivery(workspace, root)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'implementation' }))
    await writeFile(join(workspace, 'game.js'), 'tested build')
    await writeFile(join(workspace, '.beegame/delivery/browser.txt'), 'Observed current build')
    await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({
      scope: 'delivery', status: 'passed', summary: 'Played the current build', environment: 'Browser',
      evidencePaths: ['.beegame/delivery/browser.txt'], artifactPaths: ['game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [] },
    }))
    await captureProjectDeliveryAcceptance(workspace, root, Date.now() - 2000)
    expect((await evaluateProjectDeliveryGate(workspace, root))?.allowed).toBe(false)
    expect(await advanceProjectDeliveryAfterTurn(workspace, root, { phase: 'implementation', status: 'complete', summary: '' })).toMatchObject({ phase: 'acceptance', shouldContinue: true })
    expect((await evaluateProjectDeliveryGate(workspace, root))?.allowed).toBe(false)
    await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({
      scope: 'delivery', status: 'passed', summary: 'Inspected the current game in its target runtime', environment: 'Browser',
      evidencePaths: ['.beegame/delivery/browser.txt'], artifactPaths: ['game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [] },
    }))
    await captureProjectDeliveryAcceptance(workspace, root, Date.now() - 2000)
    expect(await advanceProjectDeliveryAfterTurn(workspace, root)).toMatchObject({ phase: 'complete', shouldContinue: false })
    expect((await evaluateProjectDeliveryGate(workspace, root))?.allowed).toBe(true)
    await writeFile(join(workspace, 'game.js'), 'changed after acceptance')
    expect((await evaluateProjectDeliveryGate(workspace, root))?.allowed).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('one native project advances through author, review with revision, resources, content, implementation and acceptance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-delivery-milestones-'))
  const workspace = join(root, 'project')
  const dataRoot = join(root, 'host')
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, dataRoot, 'Make a game')
    expect((await readFile(join(workspace, 'assets/manifest/CONTRACT.md'), 'utf8'))).toContain('v9')
    expect((await readFile(join(workspace, 'assets/manifest/check.mjs'), 'utf8')).length).toBeGreaterThan(0)
    expect((await readProjectDelivery(workspace, dataRoot))?.phase).toBe('author')
    expect(await Bun.file(join(workspace, '.beegame/delivery/content-contract.json')).exists()).toBe(false)
    expect(await advanceProjectDeliveryAfterTurn(workspace, dataRoot, { phase: 'author', status: 'complete', summary: '' })).toMatchObject({
      phase: 'author', shouldContinue: false, issues: expect.arrayContaining(['docs/GDD.md is missing']),
    })
    expect(await advanceProjectDeliveryAfterTurn(workspace, dataRoot)).toMatchObject({
      phase: 'author', shouldContinue: false,
    })
    await mkdir(join(workspace, 'docs'))
    for (const [batch, documents] of AUTHOR_BATCHES.entries()) {
      for (const document of documents) await writeDesignDocumentFixture(workspace, document)
      if (batch === 1) {
        await pauseProjectDelivery(workspace, dataRoot)
        expect(await advanceProjectDeliveryAfterTurn(workspace, dataRoot)).toBeUndefined()
        expect((await resumeProjectDelivery(workspace, dataRoot))?.authorBatch).toBe(1)
      }
      expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot, batch === 0
        ? { phase: 'author', status: 'complete', summary: '' } : undefined, batch || undefined))?.phase)
        .toBe(batch === AUTHOR_BATCHES.length - 1 ? 'review' : 'author')
      if (batch < AUTHOR_BATCHES.length - 1) {
        expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot))?.shouldContinue).toBe(false)
        expect((await readProjectDelivery(workspace, dataRoot))?.authorBatch).toBe(batch + 1)
        expect((await readProjectDelivery(workspace, dataRoot))?.designBaseline).toBeUndefined()
      }
    }
    for (const phase of ['resources'] as const) {
      expect(existsSync(join(workspace, 'content/index.json'))).toBe(false)
      expect((await completeReview(workspace, dataRoot))?.phase).toBe(phase)
      expect(await Bun.file(join(workspace, '.beegame/delivery/content-contract.json')).exists()).toBe(false)
    }
    expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot))?.phase).toBe('resources')
    await writeFile(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({ schema: 'legacy', entries: [] }))
    const invalidResource = await advanceProjectDeliveryAfterTurn(workspace, dataRoot)
    expect(invalidResource?.issues).toContain('version must be 9.')
    expect(invalidResource?.issues).not.toContain('assets/asset-manifest.json')
    await rm(join(workspace, 'assets/asset-manifest.json'))
    await mkdir(join(workspace, 'assets/runtime/example'), { recursive: true })
    await writeFile(join(workspace, 'assets/runtime/example/resource.json'), '{"original":true}')
    await writeBeeGameAssetManifest(workspace, assetManifestAuthoringExamples().canonical)
    const resourceCheck = Bun.spawn([process.execPath, 'assets/manifest/check.mjs'], {
      cwd: workspace, stdout: 'pipe', stderr: 'pipe',
    })
    expect(await resourceCheck.exited).toBe(0)
    expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot))?.phase).toBe('content')
    expect(existsSync(join(workspace, 'content/index.json'))).toBe(false)
    await writeUiLayoutFixture(workspace)
    const authority = projectContentAuthority(workspace)
    const contract = JSON.parse(await readFile(join(workspace, '.beegame/delivery/content-contract.json'), 'utf8'))
    expect(contract.index.documentRevision).toBe(authority.documentRevision)
    expect(contract.index.assetManifestRevision).toBe(authority.assetManifestRevision)
    await mkdir(join(workspace, 'content/scenes'), { recursive: true })
    await writeFile(join(workspace, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2', id: 'game', dimension: '2d',
      documentRevision: authority.documentRevision, assetManifestRevision: authority.assetManifestRevision,
      entryScene: 'scene', sceneModel: BEEGAME_SCENE_MODEL, files: ['scenes/main.json', 'ui/menu.json'],
    }))
    await writeFile(join(workspace, 'content/scenes/main.json'), JSON.stringify({
      schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: [],
      data: { settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels',
        width: 1280, height: 720, pixelsPerUnit: 1 } }, nodes: [{ id: 'root', components: [] }] },
    }))
    await writeFile(join(workspace, 'docs/GDD.md'), designDocumentFixture('GDD.md') + '\nUnreviewed change\n')
    expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot))?.issues).toContain(
      'Reviewed design/evidence changed outside scheduled owner scope; request an affected design-resolution before dependent work.',
    )
    await writeDesignDocumentFixture(workspace, 'GDD.md')
    expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot))?.phase).toBe('implementation')
    expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot, { phase: 'implementation', status: 'complete', summary: '' }))?.phase).toBe('acceptance')
    await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
    await writeFile(join(workspace, 'game.ts'), 'export const game = true')
    await writeFile(join(workspace, '.beegame/delivery/verification.txt'), 'played')
    await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({
      scope: 'delivery', status: 'passed', summary: 'Verified current game',
      environment: 'Browser preview', evidencePaths: ['.beegame/delivery/verification.txt'],
      artifactPaths: ['game.ts'], verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [],
        contentChecks: [{ kind: 'scene-layout', document: 'content/scenes/main.json', nodeId: 'root', property: 'transform',
          change: 'Translate root +20 on X in a test copy', expected: 'Scene moves 20 logical pixels',
          observed: 'Before x=0; after x=20', status: 'passed', evidencePaths: ['.beegame/delivery/verification.txt'] },
          { kind: 'ui-layout', document: 'content/ui/menu.json', nodeId: 'play', property: 'layout',
            change: 'Move play in a test copy', expected: 'Button moves', observed: 'Button moved', status: 'passed',
            evidencePaths: ['.beegame/delivery/verification.txt'] }] },
    }))
    await captureProjectDeliveryAcceptance(workspace, dataRoot, Date.now() - 2000)
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(false)
    expect(await advanceProjectDeliveryAfterTurn(workspace, dataRoot)).toMatchObject({
      phase: 'acceptance', diagnostic: { category: 'verification-incomplete', message: 'Design requirements are unverified: GDD.md#play.' },
    })
    const acceptance = JSON.parse(await readFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), 'utf8'))
    acceptance.verification.requirementChecks = designRequirementChecksFixture(workspace, ['.beegame/delivery/verification.txt'])
    await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify(acceptance))
    await captureProjectDeliveryAcceptance(workspace, dataRoot, Date.now() - 2000)
    expect(await advanceProjectDeliveryAfterTurn(workspace, dataRoot)).toMatchObject({ phase: 'complete', shouldContinue: false })
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('native delivery accepts only a fresh Agent report bound to current source, evidence and build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-project-delivery-'))
  const workspace = join(root, 'project')
  const dataRoot = join(root, 'host')
  try {
    await mkdir(workspace)
    await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
    await mkdir(join(workspace, 'dist'), { recursive: true })
    await writeFile(join(workspace, 'game.ts'), 'export const game = 1')
    await writeFile(join(workspace, 'dist/game.js'), 'built game')
    await writeFile(join(workspace, '.beegame/delivery/browser.txt'), 'played in browser')
    await beginProjectDelivery(workspace, dataRoot, 'Build a playable game')
    await enterAcceptanceFixture(workspace, dataRoot)
    expect(await Bun.file(join(workspace, '.beegame/delivery/content-format.json')).exists()).toBe(true)
    expect(await Bun.file(join(workspace, '.beegame/delivery/content-contract.json')).exists()).toBe(false)
    expect(await Bun.file(join(workspace, '.beegame/workflow/content-authoring-contract.json')).exists()).toBe(false)
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(false)

    const started = Date.now() - 2000
    const report = { scope: 'delivery', status: 'passed', summary: 'Verified playable build',
      environment: 'Browser preview', evidencePaths: ['.beegame/delivery/browser.txt'],
      artifactPaths: ['dist/game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [] } }
    await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify(report))
    await captureProjectDeliveryAcceptance(workspace, dataRoot, started)
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(false)
    await advanceProjectDeliveryAfterTurn(workspace, dataRoot)
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(true)

    await writeFile(join(workspace, 'game.ts'), 'export const game = 2')
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.issues).toContain('Workspace changed after acceptance; revalidation is required.')
    // A later turn that did not rewrite the report must not silently accept the changed source.
    await captureProjectDeliveryAcceptance(workspace, dataRoot, Date.now() + 2000)
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(false)
    await writeFile(join(workspace, 'game.ts'), 'export const game = 1')
    await writeFile(join(workspace, 'dist/game.js'), 'changed build')
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(false)
    await writeFile(join(workspace, 'dist/game.js'), 'built game')
    await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({ ...report, summary: 'Edited later' }))
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a report-only correction accepts unchanged runtime evidence without another browser run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-report-correction-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
    await writeFile(join(workspace, 'game.js'), 'tested build')
    await writeFile(join(workspace, '.beegame/delivery/browser.txt'), 'runtime observation')
    await beginProjectDelivery(workspace, root, 'Build a game')
    await enterAcceptanceFixture(workspace, root)
    const evidencePaths = ['.beegame/delivery/browser.txt']
    const contentCheck = { kind: 'ui-layout', document: 'content/ui/title.json', nodeId: 'title', property: 'layout',
      change: 'move title', expected: 'title moves', observed: 'title moved', status: 'passed', evidencePaths }
    const report = { scope: 'delivery', status: 'passed', summary: 'Observed current build', environment: 'Browser',
      evidencePaths, artifactPaths: ['game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [] } }
    const reportPath = join(workspace, PROJECT_DELIVERY_REPORT_PATH)
    await writeFile(reportPath, JSON.stringify({ ...report, contentChecks: [contentCheck] }))
    expect((await readRuntimeAcceptanceReport(workspace, PROJECT_DELIVERY_REPORT_PATH))?.diagnostic?.category).toBe('report-invalid')
    await captureProjectDeliveryAcceptance(workspace, root, Date.now() - 2000)
    expect((await readProjectDelivery(workspace, root))?.accepted).toBeUndefined()

    await writeFile(reportPath, JSON.stringify({ ...report,
      verification: { ...report.verification, contentChecks: [contentCheck] } }))
    await captureProjectDeliveryAcceptance(workspace, root, Date.now() - 2000)
    await advanceProjectDeliveryAfterTurn(workspace, root)
    expect((await evaluateProjectDeliveryGate(workspace, root))?.allowed).toBe(true)
    expect(await readFile(join(workspace, '.beegame/delivery/browser.txt'), 'utf8')).toBe('runtime observation')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a current chat delivery PASS at the canonical report updates the publish gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-chat-delivery-acceptance-'))
  const workspace = join(root, 'project')
  const dataRoot = join(root, 'host')
  try {
    await mkdir(join(workspace, 'dist'), { recursive: true })
    await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
    await writeFile(join(workspace, 'game.ts'), 'export const game = 1')
    await writeFile(join(workspace, 'dist/game.js'), 'tested build')
    await writeFile(join(workspace, '.beegame/delivery/browser.txt'), 'Observed the current game')
    await beginProjectDelivery(workspace, dataRoot, 'Build a playable game')
    await enterAcceptanceFixture(workspace, dataRoot)

    const reportPath = PROJECT_DELIVERY_REPORT_PATH
    await writeFile(join(workspace, reportPath), JSON.stringify({
      scope: 'delivery', status: 'passed', summary: 'Verified the current game for deployment',
      environment: 'BGS Preview', evidencePaths: ['.beegame/delivery/browser.txt'],
      artifactPaths: ['dist/game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [],
        outsideScope: ['Physical controller feel is outside the agreed browser release'] },
    }))
    await captureProjectDeliveryAcceptance(workspace, dataRoot, Date.now() - 2000)
    await advanceProjectDeliveryAfterTurn(workspace, dataRoot)

    expect((await readProjectDelivery(workspace, dataRoot))?.accepted).toMatchObject({
      source: 'report', reportPath,
    })
    expect(await evaluateProjectDeliveryGate(workspace, dataRoot)).toMatchObject({ allowed: true, layer: 'ready' })
    await writeFile(join(workspace, 'game.ts'), 'export const game = 2')
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.layer).toBe('revision')
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.issues).toContain(
      'Workspace changed after acceptance; revalidation is required.',
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a task-scoped chat PASS does not replace release acceptance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-request-pass-'))
  const workspace = join(root, 'project')
  const dataRoot = join(root, 'host')
  try {
    await mkdir(join(workspace, '.beegame/workflow/evidence'), { recursive: true })
    await mkdir(join(workspace, '.beegame/delivery/evidence'), { recursive: true })
    await writeFile(join(workspace, 'game.ts'), 'export const game = 1')
    await beginProjectDelivery(workspace, dataRoot, 'Build a playable game')
    await writeFile(join(workspace, '.beegame/delivery/evidence/runtime-request-turn.json'), JSON.stringify({
      scope: 'request', status: 'passed', summary: 'Fixed the requested issue',
      environment: 'Unit tests', evidencePaths: ['.beegame/workflow/evidence/request.txt'],
      artifactPaths: ['game.ts'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [] },
    }))
    await writeFile(join(workspace, '.beegame/workflow/evidence/request.txt'), 'Request evidence')
    await captureProjectDeliveryAcceptance(workspace, dataRoot, Date.now() - 2000)
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.issues).toContain(
      'Current project has no verified delivery acceptance.',
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('workflow evidence reports are not read by the current project publish gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-workflow-report-ignored-'))
  const workspace = join(root, 'project')
  const dataRoot = join(root, 'host')
  try {
    await mkdir(join(workspace, '.beegame/workflow/evidence'), { recursive: true })
    await mkdir(join(workspace, 'dist'), { recursive: true })
    await writeFile(join(workspace, 'dist/game.js'), 'tested build')
    await writeFile(join(workspace, '.beegame/workflow/evidence/browser.txt'), 'Observed the game')
    await writeFile(join(workspace, '.beegame/workflow/evidence/runtime-old-run.json'), JSON.stringify({
      scope: 'delivery', status: 'passed', summary: 'Legacy workflow PASS',
      environment: 'Browser preview',
      evidencePaths: ['.beegame/workflow/evidence/browser.txt'], artifactPaths: ['dist/game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [] },
    }))
    await beginProjectDelivery(workspace, dataRoot, 'Build a playable game')
    await captureProjectDeliveryAcceptance(workspace, dataRoot, Date.now() - 2000)
    expect((await readProjectDelivery(workspace, dataRoot))?.accepted).toBeUndefined()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('stopping and resuming a native project does not erase its original objective', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-project-delivery-stop-'))
  const workspace = join(root, 'project')
  const dataRoot = join(root, 'host')
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, dataRoot, 'Make a platform game')
    await pauseProjectDelivery(workspace, dataRoot)
    expect(await readProjectDelivery(workspace, dataRoot)).toMatchObject({ status: 'paused', objective: 'Make a platform game' })
    await resumeProjectDelivery(workspace, dataRoot)
    expect(await readProjectDelivery(workspace, dataRoot)).toMatchObject({ status: 'active', objective: 'Make a platform game' })
    const state = await readFile(join(dataRoot, 'project-delivery', (await readdir(join(dataRoot, 'project-delivery')))[0]!, 'state.json'), 'utf8')
    expect(state).not.toContain('DOCUMENT_DRAFTING')
    expect(await Bun.file(join(workspace, '.beegame/delivery/state.json')).exists()).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
