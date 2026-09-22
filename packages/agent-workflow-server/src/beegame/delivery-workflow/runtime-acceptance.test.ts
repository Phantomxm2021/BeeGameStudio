import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readRuntimeAcceptance, runtimeAcceptancePath, runtimeEvidenceIsCurrent } from './runtime-acceptance'
import { persistImplementationEvidence } from './evidence'
import { buildWorkerPrompt } from './worker-prompts'

test('runtime results need explicit observations and current, workspace-contained evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-runtime-record-'))
  try {
    await mkdir(join(root, '.beegame/workflow/evidence'), { recursive: true })
    const path = join(root, runtimeAcceptancePath('dispatch-a'))
    expect(await readRuntimeAcceptance(root, 'dispatch-a')).toBeUndefined()
    const report = { status: 'passed', summary: 'Title and pause observed in the real iframe',
      verification: { target: 'deployment', knownIssues: [], unverified: [] },
      artifactPaths: ['dist/game.js'],
      environment: 'BGS Web Preview iframe', evidencePaths: ['browser.txt'] }
    await writeFile(path, JSON.stringify(report))
    expect((await readRuntimeAcceptance(root, 'dispatch-a'))?.status).toBe('blocked')
    await writeFile(join(root, 'browser.txt'), 'actual test observations')
    await mkdir(join(root, 'dist'))
    await writeFile(join(root, 'dist/game.js'), 'tested build')
    const accepted = (await readRuntimeAcceptance(root, 'dispatch-a'))!
    expect(accepted.status).toBe('passed')
    expect(await runtimeEvidenceIsCurrent(root, [accepted])).toBe(true)
    await writeFile(join(root, 'dist/game.js'), 'different build with unchanged source')
    expect(await runtimeEvidenceIsCurrent(root, [accepted])).toBe(false)
    await writeFile(join(root, 'dist/game.js'), 'tested build')
    await writeFile(join(root, 'browser.txt'), 'changed evidence')
    expect(await runtimeEvidenceIsCurrent(root, [accepted])).toBe(false)
    for (const update of [
      { artifactPaths: [] }, { artifactPaths: ['missing-build.js'] }, { artifactPaths: ['../outside'] },
      { verification: undefined },
      { verification: { target: 'development', knownIssues: [], unverified: [] } },
      { verification: { target: 'deployment', knownIssues: ['Buttons overlap'], unverified: [] } },
      { verification: { target: 'deployment', knownIssues: [], unverified: ['Host preview', 'Full level traversal'] } },
      { evidencePaths: [] }, { evidencePaths: ['../outside'] },
      { environment: '' }, { evidencePaths: [runtimeAcceptancePath('dispatch-a')] },
    ]) {
      await writeFile(path, JSON.stringify({ ...report, ...update }))
      expect((await readRuntimeAcceptance(root, 'dispatch-a'))?.status).toBe('blocked')
    }
    expect(await runtimeEvidenceIsCurrent(root, [{ ...accepted, verification: undefined }])).toBe(false)
    await symlink('/etc/hosts', join(root, 'outside'))
    await writeFile(path, JSON.stringify({ ...report, evidencePaths: ['outside'] }))
    expect((await readRuntimeAcceptance(root, 'dispatch-a'))?.status).toBe('blocked')
    for (const status of ['failed', 'blocked'] as const) {
      await writeFile(path, JSON.stringify({ ...report, status, evidencePaths: [] }))
      expect((await readRuntimeAcceptance(root, 'dispatch-a'))?.status).toBe(status)
    }
    await writeFile(path, JSON.stringify(report))
    await persistImplementationEvidence({workspacePath:root,dispatchId:'dispatch-a',
      evidencePath:'.beegame/workflow/evidence/implementation-a.json',taskId:'task',revision:'revision',
      verifiedArtifacts:[],summary:'Normal final response',verificationResults:[]})
    const saved = JSON.parse(await readFile(join(root,'.beegame/workflow/evidence/implementation-a.json'),'utf8'))
    expect(saved.runtimeAcceptance.summary).toBe(report.summary)
    expect(saved.summary).toBe('Normal final response')
    expect(await readRuntimeAcceptance(root, 'dispatch-b')).toBeUndefined()
  } finally { await rm(root, { recursive:true, force:true }) }
})

test('implementation prompt requests only a dispatch-scoped result, not an audit workflow', () => {
  const prompt = buildWorkerPrompt({workerType:'implementation-worker',dispatchId:'fresh-dispatch',
    phase:'IMPLEMENTATION',runId:'run',ownerId:'owner',projectId:'project',workspacePath:'/project',
    revision:'revision',allowedPaths:['./'],contract:{changeRequest:'修复按钮'}})
  expect(prompt).toContain(runtimeAcceptancePath('fresh-dispatch'))
  expect(prompt).toContain('Choose your own verification methods')
  expect(prompt).toContain('including the host iframe')
  expect(prompt).toContain('修复按钮')
})
