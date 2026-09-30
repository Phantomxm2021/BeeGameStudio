import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRuntimeAcceptanceReport, runtimeEvidenceIsCurrent } from './runtime-acceptance'
import { bundleAcceptanceChecker } from './acceptance-check-bundle'
import { advanceProjectDeliveryAfterTurn, beginProjectDelivery, projectDeliveryStatePath, PROJECT_DELIVERY_REPORT_PATH } from './project-delivery'

test('a delivery PASS requires actual target-runtime verification and no unresolved requirements', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-delivery-coverage-'))
  const reportPath = '.beegame/delivery/acceptance.json'
  try {
    await mkdir(join(workspace, '.beegame/delivery'), { recursive: true })
    await writeFile(join(workspace, 'game.js'), 'current build')
    await writeFile(join(workspace, '.beegame/delivery/browser.txt'), 'Observed in the target runtime')
    const base = {
      scope: 'delivery', status: 'passed', summary: 'Current version verified',
      environment: 'Web browser', evidencePaths: ['.beegame/delivery/browser.txt'],
      artifactPaths: ['game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [] as string[], unverified: [] as string[] },
    }
    const read = async (report: unknown) => {
      await writeFile(join(workspace, reportPath), JSON.stringify(report))
      return readRuntimeAcceptanceReport(workspace, reportPath)
    }

    expect((await read(base))?.status).toBe('passed')
    const unspecified = await read({ ...base, verification: { target: 'deployment', knownIssues: [], unverified: [] } })
    expect(unspecified?.status).toBe('blocked')
    const simulated = await read({ ...base, verification: { ...base.verification, observation: 'simulation' } })
    expect(simulated?.status).toBe('blocked')
    expect(simulated?.summary).toContain('target runtime')

    const knownIssue = await read({ ...base, verification: { ...base.verification, knownIssues: ['Menu cannot be clicked'] } })
    expect(knownIssue?.status).toBe('blocked')
    expect(knownIssue?.summary).toContain('Menu cannot be clicked')

    const unverified = await read({ ...base, verification: { ...base.verification, unverified: ['Level two was not played'] } })
    expect(unverified?.status).toBe('blocked')
    expect(unverified?.summary).toContain('Level two was not played')
    expect(unverified?.summary).not.toContain('Agent report:')

    const misplacedChecks = await read({ ...base, contentChecks: [{ kind: 'ui-layout' }] })
    expect(misplacedChecks?.status).toBe('blocked')
    expect(misplacedChecks?.summary).toContain('contentChecks must be inside verification.contentChecks')

    const physicalOutsideScope = await read({ ...base, verification: { ...base.verification,
      outsideScope: ['Physical controller feel was not part of the agreed browser release'] } })
    expect(physicalOutsideScope?.status).toBe('passed')
    expect(physicalOutsideScope?.verification?.outsideScope).toHaveLength(1)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('a readable UI JSON and browser screenshot do not certify that its layout is consumed', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-content-binding-'))
  try {
    await mkdir(join(workspace, 'content/ui'), { recursive: true })
    await writeFile(join(workspace, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2', id: 'test', dimension: '2d',
      documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64),
      entryScene: 'scene', sceneModel: 'game-object-v2', files: ['ui/menu.json'],
    }))
    await writeFile(join(workspace, 'content/ui/menu.json'), JSON.stringify({
      schema: 'beegame-content.v1', id: 'menu', kind: 'ui-screen', assetRefs: [],
      data: { rootId: 'root', nodes: [
        { id: 'root', role: 'screen-root', layout: { size: [960, 540] } },
        { id: 'play', parentId: 'root', role: 'button', layout: { position: [10, 20], size: [100, 50] }, text: 'Play' },
      ] },
    }))
    await writeFile(join(workspace, 'game.js'), 'built renderer')
    await writeFile(join(workspace, 'browser.txt'), 'Saved before/after geometry from the actual test runtime')
    const base = {
      scope: 'delivery', status: 'passed', summary: 'Build and browser pass', environment: 'Browser',
      evidencePaths: ['browser.txt'], artifactPaths: ['game.js'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [] },
    }
    const check = {
      kind: 'ui-layout', document: 'content/ui/menu.json', nodeId: 'play', property: 'layout',
      change: 'Move +100,+100 and change size from 240x52 to 120x80 in an intercepted response',
      expected: 'Button follows the changed position and size', observed: 'Position moves +100,+100; bounds become 120x80',
      status: 'passed', evidencePaths: ['browser.txt'],
    }
    const read = async (checks?: unknown[]) => {
      await writeFile(join(workspace, 'acceptance.json'), JSON.stringify({ ...base,
        verification: { ...base.verification, ...(checks ? { contentChecks: checks } : {}) } }))
      return readRuntimeAcceptanceReport(workspace, 'acceptance.json')
    }
    expect((await read())?.summary).toContain('Content data consumption is unverified: ui-layout')
    expect((await read([{ ...check, property: 'text' }]))?.status).toBe('blocked')
    const wrongProperty = await read([{ ...check, property: 'transform' }])
    expect(wrongProperty?.summary).toContain('verification.contentChecks.0.property: ui-layout cannot be established by changing transform')
    expect((await read([{ ...check, status: 'failed', observed: 'Text changed, but geometry stayed 240x52 at the same position' }]))?.summary)
      .toContain('geometry stayed 240x52')
    expect((await read([{ ...check, status: 'unverified' }]))?.status).toBe('blocked')
    expect((await read([{ ...check, nodeId: 'invented' }]))?.summary).toContain('unknown node')
    expect((await read([{ ...check, evidencePaths: ['unrecorded.txt'] }]))?.summary).toContain('evidencePaths')
    const accepted = (await read([check]))!
    expect(accepted.status).toBe('passed')
    expect(await runtimeEvidenceIsCurrent(workspace, [accepted])).toBe(true)
    const menuPath = join(workspace, 'content/ui/menu.json')
    const originalMenu = await readFile(menuPath, 'utf8')
    const invalidMenu = JSON.parse(originalMenu)
    invalidMenu.data.nodes[1].layout = { anchor: 'top-center', position: [-120, -1000], size: [240, 52] }
    await writeFile(menuPath, JSON.stringify(invalidMenu))
    expect((await read([check]))?.summary).toContain('Authored UI controls or their panels are outside the viewport')
    await writeFile(menuPath, originalMenu)
    // Historical PASS objects cannot bypass the new consumption coverage check.
    expect(await runtimeEvidenceIsCurrent(workspace, [{ ...accepted, verification: {
      ...accepted.verification!, contentChecks: undefined,
    } }])).toBe(false)
    await writeFile(join(workspace, 'browser.txt'), 'changed evidence')
    expect(await runtimeEvidenceIsCurrent(workspace, [accepted])).toBe(false)
    // Ordinary analysis/fix responses are not made into full delivery acceptance.
    await writeFile(join(workspace, 'acceptance.json'), JSON.stringify({ ...base, scope: 'request' }))
    expect((await readRuntimeAcceptanceReport(workspace, 'acceptance.json'))?.status).toBe('passed')
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test.each(['scene-2d', 'scene-3d'] as const)('%s resource and geometry verification cannot be replaced by UI text checks', async kind => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-scene-binding-'))
  try {
    await mkdir(join(workspace, 'content'), { recursive: true })
    await writeFile(join(workspace, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2', id: 'test', dimension: kind === 'scene-2d' ? '2d' : '3d',
      documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64),
      entryScene: 'world', sceneModel: 'game-object-v2', files: ['world.json'],
    }))
    await writeFile(join(workspace, 'content/world.json'), JSON.stringify({
      schema: 'beegame-content.v1', id: 'world', kind, assetRefs: ['visual'],
      data: { nodes: [{ id: 'object', transform: { position: [0, 0, 0] }, components: kind === 'scene-2d' ? [
        { id: 'map', type: 'tilemap', data: { schema: 'tilemap.v1', gridNodeId: 'object', cells: [{ x: 0, y: 0, tileId: 'ground' }] } },
      ] : [] }] },
    }))
    await writeFile(join(workspace, 'game.js'), 'build')
    await writeFile(join(workspace, 'evidence.txt'), 'Target-runtime before/after observation')
    const scene = { kind: 'scene-layout', document: 'content/world.json', nodeId: 'object', property: 'transform',
      change: 'Translate object', expected: 'Object moves', observed: 'Object moved to authored coordinates',
      status: 'passed', evidencePaths: ['evidence.txt'] }
    const read = async (contentChecks: unknown[]) => {
      await writeFile(join(workspace, 'acceptance.json'), JSON.stringify({ scope: 'delivery', status: 'passed',
        summary: 'Verified', environment: 'Target engine', evidencePaths: ['evidence.txt'], artifactPaths: ['game.js'],
        verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [], contentChecks } }))
      return readRuntimeAcceptanceReport(workspace, 'acceptance.json')
    }
    expect((await read([scene]))?.summary).toContain('resource-binding')
    const resource = { ...scene, kind: 'resource-binding', property: 'assetRef', change: 'Replace authored assetRef',
      expected: 'New asset renders', observed: 'New asset decoded and rendered' }
    const map = { ...scene, property: 'tilemap', change: 'Move an authored cell', expected: 'Tile moves', observed: 'Tile moved' }
    if (kind === 'scene-2d') {
      expect((await read([map, resource]))?.summary).toContain('unverified: scene-layout')
      expect((await read([scene, resource]))?.summary).toContain('scene-layout/tilemap')
      expect((await read([scene, map, resource]))?.status).toBe('passed')
    } else {
      expect((await read([scene, resource]))?.status).toBe('passed')
      const report = await read([scene, map, resource])
      expect(report?.summary).toContain('without a Tilemap')
      expect(report?.diagnostic?.category).toBe('report-invalid')
      const script = join(workspace, 'check.mjs')
      await writeFile(script, await bundleAcceptanceChecker())
      const source = await readFile(join(workspace, 'content/world.json'), 'utf8')
      const run = Bun.spawnSync([process.execPath, script, 'acceptance.json'], { cwd: workspace })
      expect(run.exitCode).toBe(1)
      expect(JSON.parse(run.stdout.toString())).toMatchObject({ diagnostic: report?.diagnostic,
        check: 'report-content-evidence', publishReadiness: 'not-checked' })
      expect(await readFile(join(workspace, 'content/world.json'), 'utf8')).toBe(source)
      const host = join(workspace, 'host')
      const state = await beginProjectDelivery(workspace, host, 'Fixture')
      await writeFile(projectDeliveryStatePath(workspace, host), JSON.stringify({ ...state, phase: 'acceptance' }))
      await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), await readFile(join(workspace, 'acceptance.json')))
      expect(await advanceProjectDeliveryAfterTurn(workspace, host)).toMatchObject({
        phase: 'acceptance', shouldContinue: true, diagnostic: { category: 'report-invalid' },
      })
      expect((await advanceProjectDeliveryAfterTurn(workspace, host))?.shouldContinue).toBe(false)
    }
  } finally { await rm(workspace, { recursive: true, force: true }) }
})
