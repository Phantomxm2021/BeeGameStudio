import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { BEEGAME_SCENE_MODEL } from './game-content-package'
import { readRuntimeAcceptanceReport } from './runtime-acceptance'
import { AUTHOR_BATCHES } from './project-author'
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

test.each(['review', 'implementation'] as const)('%s advances only on the Agent current milestone conclusion', async phase => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-milestone-conclusion-'))
  const workspace = join(root, 'project')
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Build a game')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase }))
    expect(await advanceProjectDeliveryAfterTurn(workspace, root)).toMatchObject({ phase, shouldContinue: false })
    expect(await advanceProjectDeliveryAfterTurn(workspace, root, {
      phase, status: 'blocked', summary: 'Design decision unresolved',
    })).toMatchObject({ phase, shouldContinue: false, issues: ['Design decision unresolved'] })
    expect(await advanceProjectDeliveryAfterTurn(workspace, root, {
      phase: phase === 'review' ? 'implementation' : 'review', status: 'complete', summary: '',
    })).toMatchObject({ phase, shouldContinue: false })
    expect(await advanceProjectDeliveryAfterTurn(workspace, root, { phase, status: 'complete', summary: '' }))
      .toMatchObject({ phase: phase === 'review' ? 'resources' : 'acceptance', shouldContinue: true })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('delivery instructions specify data ownership without fixing agent counts or extra review stages', () => {
  const author = AUTHOR_BATCHES.map((_, batch) => projectDeliveryPhaseInstruction('author', batch)).join('\n')
  const gdd = projectDeliveryPhaseInstruction('author', 0)
  expect(gdd).toContain('how simultaneous outcomes are resolved')
  expect(gdd).toContain('what counts as an interaction during an ongoing action or transition')
  expect(gdd).toContain('rather than prescribing implementation algorithms')
  for (const document of PROJECT_DOCUMENTS) expect(author).toContain(`- ${document} —`)
  expect(author).toContain('decision dependencies (not a required writing order within this batch)')
  expect(author).toContain('For each planned level or reusable level type')
  expect(author).toContain('Distinguish world extent from display extent')
  expect(author).toContain('Use GDD, level, balance and art decisions')
  expect(author).toContain('combined footprint of game view, HUD, overlays and controls')
  expect(author).toContain('Consolidate level, UI, art, audio and technical decisions')
  expect(author).toContain('For each batch, check the available Skills against its document responsibilities and invoke the applicable Skills')
  expect(author).toContain('reuse guidance already loaded in this session where relevant')
  expect(author).toContain('Use available subagents to advance independent work in parallel once its dependencies are clear')
  expect(author).toContain('Choose the task split and roles yourself')
  expect(author).toContain('2D, 3D or XR')
  expect(author).toContain('container size, aspect ratio or content length changes')
  expect(author).toContain('conditions that select each behavior')
  expect(author).toContain('rather than a list of alternatives for the implementer to design')
  expect(author).toContain('do not enumerate every possible screen size')
  expect(author).toContain('who loads Scene/UI/resource data')
  expect(author).toContain('including relevant actions, assumptions and boundaries')
  expect(author).toContain('detail proportional to its scope')
  expect(author).toContain('one document and reference it elsewhere')
  expect(author).toContain('does not perform generation, extraction, packing or resource registration')
  expect(author).not.toContain('iframe')
  expect(author).not.toContain('Format references:')
  expect(author).not.toContain('visual board')
  expect(projectDeliveryPhaseInstruction('review')).toContain('against the confirmed requirements and platform agreements')
  expect(projectDeliveryPhaseInstruction('review')).toContain('earlier authoring summaries, completion labels and your own previous conclusions are claims to check')
  expect(projectDeliveryPhaseInstruction('review')).toContain('leave that decision to the user')
  expect(projectDeliveryPhaseInstruction('review')).toContain('Pass only when no development blockers remain')
  expect(projectDeliveryPhaseInstruction('review')).toContain('implementation and acceptance baseline')
  expect(projectDeliveryPhaseInstruction('review')).toContain('every planned screen/state is represented by its layout input or a referenced shared composition')
  expect(projectDeliveryPhaseInstruction('review')).toContain('verify each correction against its source requirements and affected consumers')
  expect(projectDeliveryPhaseInstruction('review')).toContain('including new claims and layout selection conditions')
  expect(projectDeliveryPhaseInstruction('review')).toContain('requirements actually checked and the observed results')
  expect(projectDeliveryPhaseInstruction('review')).toContain('do not rewrite unchanged documents merely to synchronize version numbers')
  const review = projectDeliveryPhaseInstruction('review')
  expect(review).not.toContain('Arrange an independent check')
  expect(review).not.toContain('the checker must not be the author')
  expect(author).not.toContain('As a document becomes ready')
  expect(author).not.toContain('source-linked evidence')
  expect(review).not.toContain('author-stage checks')
  expect(review).toContain('Use the supplied spatial calculator on final inputs')
  expect(review).toContain('game-view rectangle for scene framing, not the whole host window')
  expect(author).toContain('Different aspect ratios or available space may use different compositions')
  expect(author).toContain('UI_UX_SPEC owns final screen-space allocation and layout selection')
  expect(review).not.toContain('Read them afresh')
  const resources = projectDeliveryPhaseInstruction('resources')
  expect(resources).toContain('reviewed ASSET_PLAN.md')
  expect(resources).toContain('Optional resources do not block completion')
  expect(resources).toContain('Approved fallbacks in the documents are valid')
  expect(resources).toContain('The content stage handles scene and UI layout and bindings')
  expect(resources).toContain('Do not edit the reviewed design documents')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('Do not edit them during implementation')
  expect(resources).toContain('1024x1024 and low quality')
  expect(author).toContain('one generated sheet per suitable group')
  expect(resources).toContain('prefer one generation request for a shared sheet')
  expect(author).toContain('Atlas organization is source-independent')
  expect(resources).toContain('For procedural sprites, prefer drawing directly into a shared sheet')
  expect(resources).toContain('Keep dynamic text, live bars')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('including concurrent requests')
  expect(resources).toContain('Split generation only for a concrete')
  expect(resources).toContain('a planned atlas is not optional')
  expect(resources).toContain('not authoritative frame coordinates')
  expect(resources).not.toContain('AI may produce sheets or separate images')
  expect(resources).toContain('Building a complete game is not a prerequisite for resource checks')
  expect(resources).toContain('deliver the usable output or executable generator')
  expect(resources).toContain('need not become separate asset files or generator frameworks')
  expect(projectDeliveryPhaseInstruction('content')).toContain('Use the schemas, coordinate semantics, supported components')
  expect(projectDeliveryPhaseInstruction('content')).toContain('reviewed spatial composition')
  expect(projectDeliveryPhaseInstruction('content')).toContain('runtime code must connect for dynamic behavior and feedback')
  expect(projectDeliveryPhaseInstruction('content')).toContain('Keep standalone gameplay configuration outside the Scene/UI/VFX registry')
  expect(projectDeliveryPhaseInstruction('content')).toContain('A valid schema alone does not establish design coverage')
  expect(projectDeliveryPhaseInstruction('content')).toContain('Building the full game is not required in this stage')
  expect(projectDeliveryPhaseInstruction('content')).toContain('Derive concrete values from the reviewed layout rules')
  expect(projectDeliveryPhaseInstruction('content')).toContain('do not choose a new layout or interaction design')
  expect(projectDeliveryPhaseInstruction('content')).not.toContain('Check the generated geometry at')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('editable source')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('Read the reviewed eight documents in docs/')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('data syntax, not gameplay design')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('do not maintain a separate substitute layout')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('correct the data while preserving valid formats and references')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('Reuse an existing valid plan')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('not additional delivery stages or approval gates')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('An intermediate playable version is not final delivery')
  const implementation = projectDeliveryPhaseInstruction('implementation')
  const steps = ['1. Establish and verify data consumption', '2. Deliver a representative vertical slice', '3. Expand through independently verifiable feature units', '4. Integrate and hand off the current build']
  for (let i = 0; i < steps.length; i++) {
    expect(implementation).toContain(steps[i]!)
    if (i > 0) expect(implementation.indexOf(steps[i]!)).toBeGreaterThan(implementation.indexOf(steps[i - 1]!))
  }
  expect(implementation).toContain('do not stop between them for BGS')
  expect(implementation).toContain('Resume from unresolved work')
  expect(implementation).toContain('Target the documented quality, not open-ended polishing')
  expect(implementation).toContain('Non-blocking presentation refinements may remain on the existing checklist')
  expect(implementation).toContain('do not defer broken parsing')
  expect(implementation).toContain('batch related checks instead of launching a browser for every small task')
  expect(implementation).toContain('not automatically rerunning the whole implementation test suite')
  expect(implementation).not.toContain('Self-check and handoff:')
  expect(implementation).toContain('observable player outcomes and dependencies')
  expect(implementation).toContain('do not create another set of design documents')
  expect(implementation).toContain('rules, data bindings, interaction, presentation and verification together')
  expect(implementation).toContain('before parallelizing dependent work')
  expect(implementation).toContain('test actual rendering, not just parsed JSON')
  expect(implementation).toContain('be restored')
  expect(implementation).toContain('Avoid concurrent edits to the same parser')
  expect(implementation).toContain("a subagent's PASS alone is not integration evidence")
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('self-checks do not replace subsequent acceptance')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('Reuse evidence that remains valid for the current implementation')
  expect(projectDeliveryPhaseInstruction('implementation')).toContain('faulty test drivers')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('actual target runtime')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('confirmed scope and reviewed eight documents')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('runtime-dependent questions left open in those documents')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('no in-scope issues or unverified requirements remain')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('visual captures or equivalent target-device evidence')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('actual composition, framing, resources, text, interaction feedback and audio')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('inconclusive test-driver behavior')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('Do not claim Tilemap verification for a scene without a Tilemap component')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('A report-format check is not verification')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('Revalidate results invalidated by fixes')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('Do not edit the reviewed design')
  expect(projectDeliveryPhaseInstruction('acceptance')).toContain('a local correction does not automatically require every check to run again')
  for (const phase of ['author', 'review', 'resources', 'content', 'implementation', 'acceptance'] as const) {
    const goal = projectDeliveryPhaseInstruction(phase)
    expect(goal).not.toContain('Do not start')
    expect(goal).not.toContain('StructuredOutput')
    expect(goal).not.toContain('must delegate')
  }
  expect(resources).toContain('assets/manifest/CONTRACT.md')
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
    // Completing the first batch advances within author, rather than requesting all eight files.
    expect((await advanceProjectDeliveryAfterTurn(workspace, root))?.shouldContinue).toBe(true)
    expect((await readProjectDelivery(workspace, root))?.authorBatch).toBe(1)
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
    expect(await advanceProjectDeliveryAfterTurn(workspace, dataRoot)).toMatchObject({
      phase: 'author', shouldContinue: true, issues: expect.arrayContaining(['docs/GDD.md is missing']),
    })
    expect(await advanceProjectDeliveryAfterTurn(workspace, dataRoot)).toMatchObject({
      phase: 'author', shouldContinue: false,
    })
    await mkdir(join(workspace, 'docs'))
    for (const [batch, documents] of AUTHOR_BATCHES.entries()) {
      for (const document of documents) await writeFile(join(workspace, 'docs', document), '# Design\n')
      if (batch === 1) {
        await pauseProjectDelivery(workspace, dataRoot)
        expect(await advanceProjectDeliveryAfterTurn(workspace, dataRoot)).toBeUndefined()
        expect((await resumeProjectDelivery(workspace, dataRoot))?.authorBatch).toBe(1)
      }
      expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot))?.phase)
        .toBe(batch === 3 ? 'review' : 'author')
    }
    for (const phase of ['resources'] as const) {
      expect((await advanceProjectDeliveryAfterTurn(workspace, dataRoot, { phase: 'review', status: 'complete', summary: '' }))?.phase).toBe(phase)
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
