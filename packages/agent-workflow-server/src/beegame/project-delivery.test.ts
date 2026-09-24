import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtimeAcceptancePath } from './delivery-workflow/runtime-acceptance'
import { computeWorkspaceRevision } from './delivery-workflow/revision'
import {
  beginProjectDelivery,
  captureProjectDeliveryAcceptance,
  evaluateProjectDeliveryGate,
  pauseProjectDelivery,
  PROJECT_DELIVERY_REPORT_PATH,
  readProjectDelivery,
  resumeProjectDelivery,
} from './project-delivery'

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
    expect(await Bun.file(join(workspace, '.beegame/delivery/content-contract.json')).exists()).toBe(true)
    expect(await Bun.file(join(workspace, '.beegame/workflow/content-authoring-contract.json')).exists()).toBe(false)
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(false)

    const started = Date.now() - 2000
    const report = { scope: 'delivery', status: 'passed', summary: 'Verified playable build',
      environment: 'Browser preview', evidencePaths: ['.beegame/delivery/browser.txt'],
      artifactPaths: ['dist/game.js'],
      verification: { target: 'deployment', knownIssues: [], unverified: [] } }
    await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify(report))
    await captureProjectDeliveryAcceptance(workspace, dataRoot, started)
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

    const reportPath = PROJECT_DELIVERY_REPORT_PATH
    await writeFile(join(workspace, reportPath), JSON.stringify({
      scope: 'delivery', status: 'passed', summary: 'Verified the current game for deployment',
      environment: 'BGS Preview', evidencePaths: ['.beegame/delivery/browser.txt'],
      artifactPaths: ['dist/game.js'],
      verification: { target: 'deployment', knownIssues: [], unverified: [] },
    }))
    await captureProjectDeliveryAcceptance(workspace, dataRoot, Date.now() - 2000)

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

test('a legacy chat PASS cannot authorize publication without a delivery report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-chat-pass-'))
  const workspace = join(root, 'project')
  const dataRoot = join(root, 'host')
  try {
    await mkdir(workspace)
    await writeFile(join(workspace, 'game.ts'), 'export const game = 1')
    await beginProjectDelivery(workspace, dataRoot, 'Build a playable game')
    const state = await readProjectDelivery(workspace, dataRoot)
    const identity = createHash('sha256').update(await realpath(workspace)).digest('hex')
    const stateFile = join(dataRoot, 'project-delivery', identity, 'state.json')
    await writeFile(stateFile, JSON.stringify({ ...state, accepted: {
      source: 'chat', revision: await computeWorkspaceRevision(workspace),
      sessionId: 'session-one', turnId: 'turn-one',
      completedAt: new Date().toISOString(), resultSha256: 'a'.repeat(64),
    } }))
    expect(await Bun.file(join(workspace, PROJECT_DELIVERY_REPORT_PATH)).exists()).toBe(false)
    expect(await evaluateProjectDeliveryGate(workspace, dataRoot)).toMatchObject({
      allowed: false,
      issues: ['Current version requires a delivery acceptance report.'],
    })
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
    await writeFile(join(workspace, runtimeAcceptancePath('request-turn')), JSON.stringify({
      scope: 'request', status: 'passed', summary: 'Fixed the requested issue',
      environment: 'Unit tests', evidencePaths: ['.beegame/workflow/evidence/request.txt'],
      artifactPaths: ['game.ts'],
      verification: { target: 'deployment', knownIssues: [], unverified: [] },
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
      verification: { target: 'deployment', knownIssues: [], unverified: [] },
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
