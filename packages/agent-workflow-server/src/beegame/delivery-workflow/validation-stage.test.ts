import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { confirmAcceptanceFromImplementation } from './validation-stage'
import { readRuntimeAcceptance, runtimeAcceptancePath } from './runtime-acceptance'

test('retry reparses a rejected record once, but never re-baselines changed verified artifacts', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-acceptance-retry-'))
  try {
    await mkdir(join(workspacePath, '.beegame/workflow/evidence'), { recursive: true })
    await mkdir(join(workspacePath, 'dist'))
    await writeFile(join(workspacePath, 'dist/main.js'), 'tested build')
    await writeFile(join(workspacePath, 'observations.txt'), 'Test observations')
    const evidencePath = '.beegame/workflow/evidence/implementation-retry-test.json'
    const base = createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' })
    const run = { ...base, phase: 'ACCEPTANCE' as const,
      tasks: [{ id: 'DIRECT_IMPLEMENTATION', title: 'Implement', checklistIds: [], resourceIds: [], contentIds: [],
        allowedPaths: ['./'], status: 'completed' as const, attempt: 1,
        completedRevision: base.revision.workspace, evidenceRefs: [evidencePath] }] }
    const record = { revision: base.revision.workspace, runtimeAcceptance: {
      status: 'blocked', environment: 'not-established', evidence: [],
      summary: 'Invalid runtime acceptance record: EISDIR: illegal operation on a directory, read',
    } }
    const rawReport = { scope: 'delivery', status: 'passed', summary: 'Observed target', environment: 'Preview',
      evidencePaths: ['observations.txt'], artifactPaths: ['dist'],
      verification: { target: 'deployment', knownIssues: [], unverified: [] } }
    const reportPath = join(workspacePath, runtimeAcceptancePath('retry-test'))
    await writeFile(join(workspacePath, evidencePath), JSON.stringify(record))
    // A missing source must not silently turn a rejected record into success.
    expect((await confirmAcceptanceFromImplementation({ run, workspacePath })).status).toBe('needs_action')
    await writeFile(reportPath, JSON.stringify({ ...rawReport, status: 'blocked', summary: 'Overlapping targets',
      verification: { ...rawReport.verification, knownIssues: ['Overlapping targets'] } }))
    const blocked = await confirmAcceptanceFromImplementation({ run, workspacePath })
    expect(blocked.status).toBe('needs_action')
    expect(blocked.blockedReason).toContain('Overlapping targets')
    expect(blocked.blockedReason).not.toContain('EISDIR')
    await writeFile(join(workspacePath, evidencePath), JSON.stringify(record))
    await writeFile(reportPath, JSON.stringify(rawReport))
    expect((await confirmAcceptanceFromImplementation({ run, workspacePath })).evidence.acceptance?.status).toBe('passed')
    const bound = await readFile(join(workspacePath, evidencePath), 'utf8')
    expect(JSON.parse(bound).runtimeAcceptance.artifacts[0].path).toBe('dist')
    await writeFile(join(workspacePath, 'dist/main.js'), 'untested changed build')
    expect((await confirmAcceptanceFromImplementation({ run, workspacePath })).evidence.acceptance?.status).toBe('blocked')
    expect(await readFile(join(workspacePath, evidencePath), 'utf8')).toBe(bound)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

for (const change of ['none', 'build', 'evidence', 'agent-verdict'] as const)
test(`obsolete host veto is re-evaluated without replacing captured hashes: ${change}`, async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-obsolete-verdict-'))
  try {
    await mkdir(join(workspacePath, '.beegame/workflow/evidence'), { recursive: true })
    await writeFile(join(workspacePath, 'build.js'), 'tested build')
    await writeFile(join(workspacePath, 'observed.txt'), 'saved observations')
    const reportPath = join(workspacePath, runtimeAcceptancePath('old-policy'))
    const raw = { scope: 'delivery', status: 'passed', summary: 'Agent observations', environment: 'Preview',
      evidencePaths: ['observed.txt'], artifactPaths: ['build.js'],
      verification: { target: 'deployment', knownIssues: ['Development-only warning'], unverified: ['Physical phone'] } }
    await writeFile(reportPath, JSON.stringify(raw))
    const captured = (await readRuntimeAcceptance(workspacePath, 'old-policy'))!
    const previous = { ...captured, status: 'blocked',
      summary: `Delivery has unresolved issues: Development-only warning\nAgent report: ${raw.summary}` }
    const evidencePath = '.beegame/workflow/evidence/implementation-old-policy.json'
    const base = createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' })
    const run = { ...base, phase: 'ACCEPTANCE' as const,
      tasks: [{ id: 'DIRECT_IMPLEMENTATION', title: 'Implement', checklistIds: [], resourceIds: [], contentIds: [],
        allowedPaths: ['./'], status: 'completed' as const, attempt: 1,
        completedRevision: base.revision.workspace, evidenceRefs: [evidencePath] }] }
    await writeFile(join(workspacePath, evidencePath), JSON.stringify({ revision: base.revision.workspace, runtimeAcceptance: previous }))
    if (change === 'build') await writeFile(join(workspacePath, 'build.js'), 'changed build')
    if (change === 'evidence') await writeFile(join(workspacePath, 'observed.txt'), 'changed observations')
    if (change === 'agent-verdict') await writeFile(reportPath, JSON.stringify({ ...raw, status: 'blocked' }))
    const result = await confirmAcceptanceFromImplementation({ run, workspacePath })
    expect(result.evidence.acceptance?.status).toBe(change === 'none' ? 'passed' : 'blocked')
    const saved = JSON.parse(await readFile(join(workspacePath, evidencePath), 'utf8')).runtimeAcceptance
    expect(saved.evidence).toEqual(previous.evidence)
    expect(saved.artifacts).toEqual(previous.artifacts)
    expect(saved.status).toBe(change === 'none' ? 'passed' : 'blocked')
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})
