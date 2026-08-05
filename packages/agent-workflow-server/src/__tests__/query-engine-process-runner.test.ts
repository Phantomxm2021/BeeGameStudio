import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createProcessIsolatedQueryEngineRunner,
  createQueryEngineTurnSubmitMessage,
} from '../beegame/query-engine-process-runner'
import {
  deserializeQueryEngineStartInput,
  serializeQueryEngineStartInput,
} from '../beegame/query-engine-process-input'

describe('process-isolated QueryEngine runner', () => {
  test('preserves confirmed brief authority on an isolated turn', () => {
    const confirmedBriefContext = JSON.stringify({
      resource_library_usage: 'required',
    })
    const message = createQueryEngineTurnSubmitMessage('turn-1', {
      prompt: 'prepare resources',
      confirmedBriefContext,
      signal: new AbortController().signal,
      onMessage() {},
      async requestPermission() {
        return { behavior: 'deny' }
      },
    })

    expect(message).toEqual({
      type: 'turn.submit',
      turnId: 'turn-1',
      prompt: 'prepare resources',
      confirmedBriefContext,
    })
  })

  test('preserves workflow permission identity across process serialization', () => {
    const serialized = serializeQueryEngineStartInput({
      sessionId: 'resource-worker',
      deliveryEvidenceDataRoot: '/tmp/evidence',
      cwd: '/tmp/project',
      env: {},
      approvedOutboundTargets: {},
      workflowWorker: true,
      workflowWorkerType: 'resource-curator',
      workflowAllowedPaths: ['assets/content/'],
      workflowProtectedPaths: ['assets/content/entities.json'],
    })

    expect(deserializeQueryEngineStartInput(serialized)).toMatchObject({
      sessionId: 'resource-worker',
      deliveryEvidenceDataRoot: '/tmp/evidence',
      workflowWorker: true,
      workflowWorkerType: 'resource-curator',
      workflowAllowedPaths: ['assets/content/'],
      workflowProtectedPaths: ['assets/content/entities.json'],
    })
  })

  test('preserves the sole document review contract across process serialization', () => {
    const serialized = serializeQueryEngineStartInput({
      sessionId: 'document-reviewer',
      cwd: '/tmp/project',
      env: {},
      approvedOutboundTargets: {},
      workflowWorker: true,
      workflowWorkerType: 'document-reviewer',
      workflowDocumentReviewContract: {
        scope: 'complete',
        mode: 'closure',
        requiredCheckIds: ['implementation_readiness'],
        currentCheckIds: ['implementation_readiness'],
        artifacts: [
          { path: 'assets/asset-manifest.json', content: '{"version":8}\n' },
        ],
        activeTarget: 'resource',
        priorFindings: [
          {
            findingId: 'finding-1',
            checkId: 'implementation_readiness',
            owner: 'resource',
            open: true,
            requiredOutcome: 'The resource contract is implementation ready.',
          },
        ],
        changedPaths: ['assets/asset-manifest.json'],
      },
    })

    expect(deserializeQueryEngineStartInput(serialized)).toMatchObject({
      workflowWorker: true,
      workflowWorkerType: 'document-reviewer',
      workflowDocumentReviewContract: {
        scope: 'complete',
        mode: 'closure',
        requiredCheckIds: ['implementation_readiness'],
        currentCheckIds: ['implementation_readiness'],
        activeTarget: 'resource',
      },
    })
  })

  test('preserves the exact document author contract across process serialization', () => {
    const serialized = serializeQueryEngineStartInput({
      sessionId: 'document-author',
      cwd: '/tmp/project',
      env: {},
      approvedOutboundTargets: {},
      workflowWorker: true,
      workflowWorkerType: 'document-author',
      workflowAllowedPaths: ['docs/GDD.md'],
      workflowDocumentAuthorMode: 'remediation',
      workflowCanonicalDocumentCommitContract: {
        dispatchId: 'dispatch-1',
        targetPath: 'docs/GDD.md',
        documentId: 'GDD',
        operation: 'revise',
        baselineDigest: 'baseline-digest',
        baselineVersion: '1.2.3',
        baselineUpdatedAt: '2026-08-04T00:00:00.000Z',
      },
    })

    expect(deserializeQueryEngineStartInput(serialized)).toMatchObject({
      workflowWorker: true,
      workflowWorkerType: 'document-author',
      workflowAllowedPaths: ['docs/GDD.md'],
      workflowDocumentAuthorMode: 'remediation',
      workflowCanonicalDocumentCommitContract: {
        dispatchId: 'dispatch-1',
        targetPath: 'docs/GDD.md',
        documentId: 'GDD',
        operation: 'revise',
        baselineDigest: 'baseline-digest',
        baselineVersion: '1.2.3',
        baselineUpdatedAt: '2026-08-04T00:00:00.000Z',
      },
    })
  })

  test('preserves the repair graph cardinality across process serialization', () => {
    const serialized = serializeQueryEngineStartInput({
      sessionId: 'document-repair-planner',
      cwd: '/tmp/project',
      env: {},
      approvedOutboundTargets: {},
      workflowWorker: true,
      workflowWorkerType: 'document-author',
      workflowAllowedPaths: [],
      workflowDocumentAuthorMode: 'repair-planning',
      workflowDocumentRepairGroupCount: 3,
    })

    expect(deserializeQueryEngineStartInput(serialized)).toMatchObject({
      workflowDocumentAuthorMode: 'repair-planning',
      workflowDocumentRepairGroupCount: 3,
    })
  })

  test('starts independent session workers without sharing the server process', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'beegame-runtime-worker-'))
    const firstWorkspace = join(cwd, 'user-a', 'project')
    const secondWorkspace = join(cwd, 'user-b', 'project')
    await Promise.all([
      mkdir(firstWorkspace, { recursive: true }),
      mkdir(secondWorkspace, { recursive: true }),
    ])
    const runner = createProcessIsolatedQueryEngineRunner()
    try {
      const [first, second] = await Promise.all([
        runner.start({
          sessionId: 'worker-session-a',
          cwd: firstWorkspace,
          env: { BEEGAME_CONFIG_DIR: join(cwd, 'config-a') },
          approvedOutboundTargets: {},
        }),
        runner.start({
          sessionId: 'worker-session-b',
          cwd: secondWorkspace,
          env: { BEEGAME_CONFIG_DIR: join(cwd, 'config-b') },
          approvedOutboundTargets: {},
        }),
      ])

      expect(first).not.toBe(second)
      const firstPid = (first as unknown as { child: { pid: number } }).child
        .pid
      const secondPid = (second as unknown as { child: { pid: number } }).child
        .pid
      expect(firstPid).not.toBe(process.pid)
      expect(secondPid).not.toBe(process.pid)
      expect(firstPid).not.toBe(secondPid)
      const firstExited = (
        first as unknown as { child: { exited: Promise<number> } }
      ).child.exited
      const secondExited = (
        second as unknown as { child: { exited: Promise<number> } }
      ).child.exited
      first.dispose?.()
      second.dispose?.()
      await expect(
        Promise.race([
          Promise.all([firstExited, secondExited]),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('isolated workers did not exit')),
              2_000,
            ),
          ),
        ]),
      ).resolves.toBeDefined()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
