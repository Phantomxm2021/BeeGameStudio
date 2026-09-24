import { test, expect } from 'bun:test'
import { buildWorkerPrompt } from './worker-prompts'
import type { WorkerDispatchRequest } from './types'

test('initial, resumed and change-request tasks share repair ownership and deferred nonblocking issues', () => {
  for (const contract of [{}, { currentImplementationIssues: ['hash mismatch'] }, { changeRequest: 'Fix the gate' }]) {
    const prompt = buildWorkerPrompt({ dispatchId: 'test', runId: 'run', ownerId: 'owner',
      projectId: 'project', workspacePath: '/project', workerType: 'implementation-worker',
      phase: 'IMPLEMENTATION', revision: 'revision', allowedPaths: ['./'], contract } as WorkerDispatchRequest)
    expect(prompt).toContain('Resolve issues by responsibility')
    expect(prompt).toContain('source-asset defects belong to targeted resource repair')
    expect(prompt).toContain('Do not blindly refresh hashes')
    expect(prompt).toContain('after repairs')
    expect(prompt).not.toContain('Content and Manifest are editable project artifacts')
    expect(prompt).not.toContain('Content and Manifest may be corrected within this task')
    expect(prompt).toContain('contract.gameContent.authoringContractPath')
    expect(prompt).toContain('inspectionCommand')
    expect(prompt).toContain('not game playability or rendered correctness')
  }
})

test('the prompt exposes the actual project boundary and protected exceptions', () => {
  const prompt = buildWorkerPrompt({ runId: 'run', ownerId: 'owner', projectId: 'project',
    workspacePath: '/project', workerType: 'implementation-worker', phase: 'IMPLEMENTATION',
    revision: 'revision', allowedPaths: ['./'], protectedPaths: ['docs/GDD.md', 'assets/'],
    contract: {} })
  expect(prompt).toContain('not a filesystem sandbox')
  expect(prompt).toContain('Protected paths (read-only, even inside writable paths): docs/GDD.md, assets/')
})
