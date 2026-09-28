import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { BEEGAME_SCENE_MODEL } from './game-content-package'
import { readRuntimeAcceptanceReport } from './runtime-acceptance'
import {
  advanceProjectDeliveryAfterTurn,
  beginProjectDelivery,
  captureProjectDeliveryAcceptance,
  evaluateProjectDeliveryGate,
  pauseProjectDelivery,
  PROJECT_DOCUMENTS,
  PROJECT_DELIVERY_REPORT_PATH,
  projectDeliveryStatePath,
  projectContentAuthority,
  projectDeliveryPhaseInstruction,
  readProjectDelivery,
  resumeProjectDelivery,
} from './project-delivery'

async function enterAcceptanceFixture(workspace: string, dataRoot: string): Promise<void> {
  const state = await readProjectDelivery(workspace, dataRoot)
  await writeFile(projectDeliveryStatePath(workspace, dataRoot), JSON.stringify({ ...state, phase: 'acceptance' }))
}

test('delivery instructions specify data ownership without mandating verification agents', () => {
  expect(projectDeliveryPhaseInstruction('author')).toContain('self-checks and delegation')
  expect(projectDeliveryPhaseInstruction('author')).toContain('2D, 3D or XR')
  expect(projectDeliveryPhaseInstruction('author')).toContain('does not register arbitrary gameplay configuration files')
  expect(projectDeliveryPhaseInstruction('author')).toContain('one representative sample')
  expect(projectDeliveryPhaseInstruction('author')).toContain('visual composition implementable before coding')
  expect(projectDeliveryPhaseInstruction('author')).toContain('relevant aspect ratios')
  expect(projectDeliveryPhaseInstruction('author')).toContain('For each planned UI screen')
  expect(projectDeliveryPhaseInstruction('author')).toContain('middle-center panel at position [0,0]')
  expect(projectDeliveryPhaseInstruction('author')).toContain('one authoritative definition across the documents')
  expect(projectDeliveryPhaseInstruction('author')).toContain('assumptions that remain unverified')
  expect(projectDeliveryPhaseInstruction('review')).toContain('Revise the documents to resolve findings within this milestone')
  expect(projectDeliveryPhaseInstruction('review')).toContain('critical path from player action to completion')
  expect(projectDeliveryPhaseInstruction('review')).toContain('unintended overlap, occlusion or unused space')
  expect(projectDeliveryPhaseInstruction('resources')).toContain('reviewed ART_DIRECTION.md, UI_UX_SPEC.md, LEVEL_SCENE_DESIGN.md and ASSET_PLAN.md')
  expect(projectDeliveryPhaseInstruction('resources')).toContain('AI image capability for suitable UI graphics, cover illustrations')
  expect(projectDeliveryPhaseInstruction('resources')).toContain('no separate visual-board or user-approval prerequisite')
  expect(projectDeliveryPhaseInstruction('resources')).toContain('assets/ai-generation-prompts.md')
  expect(projectDeliveryPhaseInstruction('resources')).toContain('background or cover illustrations as separate images')
  expect(projectDeliveryPhaseInstruction('resources')).toContain('an image can contain distinct, non-overlapping elements in one sheet')
  expect(projectDeliveryPhaseInstruction('resources')).toContain('Choose transparent, opaque or automatic background')
  expect(projectDeliveryPhaseInstruction('resources')).toContain('image model generates the image, not cuts, packaging or frame coordinates')
  expect(projectDeliveryPhaseInstruction('resources')).toContain('copies the source PNG unchanged')
  expect(projectDeliveryPhaseInstruction('content')).toContain('Grid or behavior name alone is not a populated map')
  expect(projectDeliveryPhaseInstruction('content')).toContain('reviewed spatial composition')
  expect(projectDeliveryPhaseInstruction('content')).toContain('UI layout.position offsets the parent anchor')
  expect(projectDeliveryPhaseInstruction('content')).toContain('does not accept standalone gameplay tuning documents')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('editable source')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('Read the reviewed eight documents in docs/')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('data syntax, not gameplay design')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('hand-written CSS or engine positions is not data-driven rendering')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('responsive requirements and authored layout conflict')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('faulty test drivers')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('actual target runtime')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('confirmed scope and reviewed eight documents')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('visual captures or equivalent target-device evidence')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('inconclusive test-driver behavior')
  for (const phase of ['author', 'review', 'resources', 'content', 'implementation', 'acceptance'] as const) {
    const goal = projectDeliveryPhaseInstruction(phase)
    expect(goal).not.toContain('Do not start')
    expect(goal).not.toContain('StructuredOutput')
    expect(goal).not.toContain('must delegate')
  }
  expect(projectDeliveryPhaseInstruction('resources')).toContain('no mandatory source order')
  expect(projectDeliveryPhaseInstruction('resources')).toContain('generated code is not an authoring reference')
})

test('unrelated writes cannot repeatedly dispatch an unchanged validation failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-failure-dedup-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Build a game')
    expect((await advanceProjectDeliveryAfterTurn(workspace, root))?.shouldContinue).toBe(true)
    await writeFile(join(workspace, 'notes.txt'), 'Still investigating')
    expect((await advanceProjectDeliveryAfterTurn(workspace, root))?.shouldContinue).toBe(false)
    await mkdir(join(workspace, 'docs'))
    await writeFile(join(workspace, 'docs/GDD.md'), '# Game design')
    // A changed diagnostic (one missing document resolved) is new information.
    expect((await advanceProjectDeliveryAfterTurn(workspace, root))?.shouldContinue).toBe(true)
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
    expect(await advanceProjectDeliveryAfterTurn(workspace, root)).toMatchObject({ phase: 'acceptance', shouldContinue: true })
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
    expect(await advanceProjectDeliveryAfterTurn(workspace, dataRoot)).toMatchObject({
      phase: 'author', shouldContinue: true, issues: expect.arrayContaining(['docs/GDD.md is missing']),
    })
    expect(await advanceProjectDeliveryAfterTurn(workspace, dataRoot)).toMatchObject({
      phase: 'author', shouldContinue: false,
    })
    await mkdir(join(workspace, 'docs'))
    for (const document of PROJECT_DOCUMENTS) await writeFile(join(workspace, 'docs', document), '# Design\n')
    for (const phase of ['review', 'resources'] as const) {
      expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot))?.phase).toBe(phase)
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
    const authority = projectContentAuthority(workspace)
    const contract = JSON.parse(await readFile(join(workspace, '.beegame/delivery/content-contract.json'), 'utf8'))
    expect(contract.index.documentRevision).toBe(authority.documentRevision)
    expect(contract.index.assetManifestRevision).toBe(authority.assetManifestRevision)
    await mkdir(join(workspace, 'content/scenes'), { recursive: true })
    await writeFile(join(workspace, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2', id: 'game', dimension: '2d',
      documentRevision: authority.documentRevision, assetManifestRevision: authority.assetManifestRevision,
      entryScene: 'scene', sceneModel: BEEGAME_SCENE_MODEL, files: ['scenes/main.json'],
    }))
    await writeFile(join(workspace, 'content/scenes/main.json'), JSON.stringify({
      schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: [],
      data: { settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels',
        width: 1280, height: 720, pixelsPerUnit: 1 } }, nodes: [{ id: 'root', components: [] }] },
    }))
    await writeFile(join(workspace, 'docs/GDD.md'), '# Revised design\n')
    expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot))?.issues).toContain(
      'content/index.json: documentRevision does not match authority.',
    )
    await writeFile(join(workspace, 'docs/GDD.md'), '# Design\n')
    expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot))?.phase).toBe('implementation')
    expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot))?.phase).toBe('acceptance')
    await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
    await writeFile(join(workspace, 'game.ts'), 'export const game = true')
    await writeFile(join(workspace, '.beegame/delivery/verification.txt'), 'played')
    await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({
      scope: 'delivery', status: 'passed', summary: 'Verified current game',
      environment: 'Browser preview', evidencePaths: ['.beegame/delivery/verification.txt'],
      artifactPaths: ['game.ts'], verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [],
        contentChecks: [{ kind: 'scene-layout', document: 'content/scenes/main.json', nodeId: 'root', property: 'transform',
          change: 'Translate root +20 on X in a test copy', expected: 'Scene moves 20 logical pixels',
          observed: 'Before x=0; after x=20', status: 'passed', evidencePaths: ['.beegame/delivery/verification.txt'] }] },
    }))
    await captureProjectDeliveryAcceptance(workspace, dataRoot, Date.now() - 2000)
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(false)
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
    expect((await readRuntimeAcceptanceReport(workspace, PROJECT_DELIVERY_REPORT_PATH))?.invalidRecord).toBe(true)
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
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(true)
    await writeFile(join(workspace, 'game.ts'), 'export const game = 2')
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
