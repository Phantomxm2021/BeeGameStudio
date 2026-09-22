import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  beginProjectDelivery,
  captureProjectDeliveryAcceptance,
  evaluateProjectDeliveryGate,
  importProjectDeliveryAcceptance,
  pauseProjectDelivery,
  PROJECT_DELIVERY_REPORT_PATH,
  readProjectDelivery,
  resumeProjectDelivery,
} from './project-delivery'
import { computeWorkspaceRevision } from './delivery-workflow/revision'
import { readRuntimeAcceptanceReport } from './delivery-workflow/runtime-acceptance'

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

test('a current historical acceptance transfers without rewriting the Agent report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-project-delivery-import-'))
  const workspace = join(root, 'project')
  const dataRoot = join(root, 'host')
  try {
    await mkdir(join(workspace, '.beegame/workflow/evidence'), { recursive: true })
    await mkdir(join(workspace, 'dist'), { recursive: true })
    await writeFile(join(workspace, 'game.ts'), 'export const game = 1')
    await writeFile(join(workspace, 'dist/game.js'), 'built game')
    await writeFile(join(workspace, '.beegame/workflow/evidence/played.txt'), 'played')
    const reportPath = '.beegame/workflow/evidence/runtime-historical.json'
    await writeFile(join(workspace, reportPath), JSON.stringify({ scope: 'delivery', status: 'passed',
      summary: 'Verified current build', environment: 'Browser preview',
      evidencePaths: ['.beegame/workflow/evidence/played.txt'], artifactPaths: ['dist/game.js'],
      verification: { target: 'deployment', knownIssues: [], unverified: [] } }))
    const report = await readRuntimeAcceptanceReport(workspace, reportPath)
    expect(report?.status).toBe('passed')
    await beginProjectDelivery(workspace, dataRoot, 'Build the historical game')
    await importProjectDeliveryAcceptance({ workspacePath: workspace, dataRoot,
      revision: await computeWorkspaceRevision(workspace), reportPath, reports: [report!] })
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(true)
    await writeFile(join(workspace, 'dist/game.js'), 'new untested build')
    expect((await evaluateProjectDeliveryGate(workspace, dataRoot))?.allowed).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
