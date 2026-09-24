import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readRuntimeAcceptance, runtimeAcceptancePath, runtimeEvidenceIsCurrent } from './runtime-acceptance'
import { persistImplementationEvidence } from './evidence'
import { buildWorkerPrompt } from './worker-prompts'
import { implementationCompletionIssue } from './implementation-stage'

test('runtime results need explicit observations and current, workspace-contained evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-runtime-record-'))
  try {
    await mkdir(join(root, '.beegame/delivery/evidence'), { recursive: true })
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
      { evidencePaths: [] }, { evidencePaths: ['../outside'] },
      { environment: '' }, { evidencePaths: [runtimeAcceptancePath('dispatch-a')] },
    ]) {
      await writeFile(path, JSON.stringify({ ...report, ...update }))
      expect((await readRuntimeAcceptance(root, 'dispatch-a'))?.status).toBe('blocked')
    }
    expect(await runtimeEvidenceIsCurrent(root, [{ ...accepted, verification: undefined }])).toBe(false)
    // Disclosures must not silently override an explicit agent verdict.
    for (const status of ['passed', 'failed', 'blocked'] as const) {
      const verification = { target: 'deployment' as const, knownIssues: ['Development HMR warning'], unverified: ['Physical mobile device'] }
      await writeFile(path, JSON.stringify({ ...report, status, verification }))
      const result = (await readRuntimeAcceptance(root, 'dispatch-a'))!
      expect(result.status).toBe(status)
      expect(result.verification).toEqual(verification)
      expect(await runtimeEvidenceIsCurrent(root, [result])).toBe(status === 'passed')
    }
    await symlink('/etc/hosts', join(root, 'outside'))
    await writeFile(path, JSON.stringify({ ...report, evidencePaths: ['outside'] }))
    expect((await readRuntimeAcceptance(root, 'dispatch-a'))?.status).toBe('blocked')
    for (const status of ['failed', 'blocked'] as const) {
      await writeFile(path, JSON.stringify({ ...report, status, evidencePaths: [] }))
      expect((await readRuntimeAcceptance(root, 'dispatch-a'))?.status).toBe(status)
    }
    await writeFile(path, JSON.stringify(report))
    await persistImplementationEvidence({workspacePath:root,dispatchId:'dispatch-a',
      evidencePath:'.beegame/delivery/evidence/implementation-a.json',taskId:'task',revision:'revision',
      verifiedArtifacts:[],summary:'Normal final response',verificationResults:[]})
    const saved = JSON.parse(await readFile(join(root,'.beegame/delivery/evidence/implementation-a.json'),'utf8'))
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
  expect(prompt).not.toContain('no additional audit Agent')
  expect(prompt).toContain('including the host iframe')
  expect(prompt).toContain('修复按钮')
  expect(prompt).toContain('not a filesystem sandbox')
})

test('implementation completion accepts necessary project edits outside the primary output hint', () => {
  const issue = implementationCompletionIssue({
    task: { id: 'bugfix', title: 'Fix UI', checklistIds: [], resourceIds: [], contentIds: [],
      allowedPaths: [], status: 'running', attempt: 1, evidenceRefs: [] },
    terminal: {
      workerType: 'implementation-worker', taskId: 'bugfix', status: 'completed', revision: 'revision',
      changedPaths: ['src/ui/Button.tsx', 'tests/ui/Button.test.tsx'], verifiedArtifacts: [],
      summary: 'Fixed and verified the UI bug', verificationResults: [{ verificationIndex: 0,
        status: 'passed', observations: ['The affected UI test passed'] }],
      evidenceRefs: ['.beegame/delivery/evidence/bugfix.json'],
      evidencePath: '.beegame/delivery/evidence/bugfix.json',
    },
  })
  expect(issue).toBeUndefined()
})

test('deliverable directories bind nested file contents and names, without following escaping or cyclic links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-artifact-directory-'))
  try {
    await mkdir(join(root, '.beegame/delivery/evidence'), { recursive: true })
    await mkdir(join(root, 'dist/assets/runtime'), { recursive: true })
    await writeFile(join(root, 'observations.txt'), 'Observed gameplay')
    const asset = join(root, 'dist/assets/runtime/a.txt')
    await writeFile(asset, 'original')
    const reportPath = join(root, runtimeAcceptancePath('directory'))
    const report = { scope: 'delivery', status: 'passed', summary: 'Observed gameplay', environment: 'Preview',
      verification: { target: 'deployment', knownIssues: [], unverified: [] },
      evidencePaths: ['observations.txt'], artifactPaths: ['dist'] }
    await writeFile(reportPath, JSON.stringify(report))
    const original = (await readRuntimeAcceptance(root, 'directory'))!
    expect(original.status).toBe('passed')
    expect(await readRuntimeAcceptance(root, 'directory')).toEqual(original)
    expect(await runtimeEvidenceIsCurrent(root, [original])).toBe(true)
    await writeFile(asset, 'changed')
    expect(await runtimeEvidenceIsCurrent(root, [original])).toBe(false)
    await writeFile(asset, 'original')
    await rename(asset, asset + '.renamed')
    expect(await runtimeEvidenceIsCurrent(root, [original])).toBe(false)
    await rename(asset + '.renamed', asset)
    await writeFile(join(root, 'dist/new.txt'), 'extra')
    expect(await runtimeEvidenceIsCurrent(root, [original])).toBe(false)
    await rm(join(root, 'dist/new.txt'))
    await rm(asset)
    expect(await runtimeEvidenceIsCurrent(root, [original])).toBe(false)
    await writeFile(asset, 'original')
    expect(await runtimeEvidenceIsCurrent(root, [original])).toBe(true)
    await symlink('/etc/hosts', join(root, 'dist/escape'))
    expect((await readRuntimeAcceptance(root, 'directory'))?.summary).toContain('outside the workspace')
    await rm(join(root, 'dist/escape'))
    await symlink(join(root, 'dist'), join(root, 'dist/loop'))
    expect((await readRuntimeAcceptance(root, 'directory'))?.summary).toContain('cycle')
    await rm(join(root, 'dist/loop'))
    await writeFile(reportPath, JSON.stringify({ ...report, evidencePaths: ['dist'] }))
    expect((await readRuntimeAcceptance(root, 'directory'))?.summary).toContain('regular file: dist')
  } finally { await rm(root, { recursive: true, force: true }) }
})
