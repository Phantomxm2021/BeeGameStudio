import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBeeGameDeliveryWorkerPort } from '../beegame/delivery-worker-session-port'
import { registerBeeGameAuthoredResources, writeBeeGameAssetManifest } from '../beegame/asset-contracts'
import type { BeeGameSessionManager } from '../beegame/session-manager'
import type { WorkerDispatchRequest } from '../beegame/delivery-workflow/types'

describe('delivery worker session credentials', () => {
  test('reopens an existing catalog only for semantic review remediation', async () => {
    const starts: Array<Record<string, unknown>> = []
    const sessions = {
      start(input: Record<string, unknown>) {
        starts.push(input)
        return { id: `session-${starts.length}` }
      },
      updateAuthToken() {},
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
    })
    const base = {
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'resource-preparer' as const,
      phase: 'RESOURCE_PREPARATION' as const,
      revision: 'revision-1',
      allowedPaths: ['assets/'],
    }
    await port.start({
      ...base,
      dispatchId: 'dispatch-contract-repair',
      contract: {
        remediation: {
          kind: 'resource_contract',
          sourceRevision: 'resource-1',
          attempt: 1,
          issues: ['Canonical inventory metadata is invalid.'],
        },
      },
    })
    await port.start({
      ...base,
      dispatchId: 'dispatch-semantic-review',
      contract: {
        remediation: {
          kind: 'document_review',
          cycleId: 'cycle-1',
          sourceRevision: 'resource-1',
          findings: [],
        },
      },
    })
    expect(
      starts[0]?.workflowAllowResourceCatalogWithExistingInventory,
    ).toBeUndefined()
    expect(
      starts[1]?.workflowAllowResourceCatalogWithExistingInventory,
    ).toBe(true)
  })

  test('assigns the atomic planner one structured submission lane', async () => {
    let submittedPrompt = ''
    const sessions = {
      start() {
        return { id: 'session-task-planner' }
      },
      updateAuthToken() {},
      async sendWithDisplay(_sessionId: string, prompt: string) {
        submittedPrompt = prompt
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
    })
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-task-prompt-'))
    try {
      await port.start({
        dispatchId: 'dispatch-unique-plan',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'atomic-task-planner',
        phase: 'ATOMIC_TASK_PLANNING',
        revision: 'revision-1',
        allowedPaths: ['.beegame/workflow/evidence/'],
        contract: {},
      })
      await port.submit('dispatch-unique-plan', 'Plan the tasks')

      expect(submittedPrompt).toContain('SubmitAtomicTaskPlan exactly once')
      expect(submittedPrompt).toContain(
        'workflow service owns its canonical persistence',
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('derives implementation terminal from one structured submission', async () => {
    let submittedPrompt = ''
    const resultInput = {
      status: 'completed',
      changedPaths: [],
      verificationObservations: ['The scene artifact exists.'],
    }
    const sessions = {
      start() {
        return { id: 'session-implementation' }
      },
      updateAuthToken() {},
      async sendWithDisplay(_sessionId: string, prompt: string) {
        submittedPrompt = prompt
      },
      events() {
        return [
          {
            id: 'event-1',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolUseID: 'submit-result',
              toolName: 'SubmitImplementationResult',
              input: resultInput,
            },
          },
          {
            id: 'event-invalid-later',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolUseID: 'submit-invalid-result',
              toolName: 'SubmitImplementationResult',
              input: {
                ...resultInput,
                verificationObservations: [],
              },
            },
          },
          {
            id: 'event-2',
            type: 'result',
            text: 'Implementation complete.',
            createdAt: new Date(),
            payload: { result: 'Implementation complete.' },
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
    })
    await port.start({
      dispatchId: 'dispatch-implementation',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'implementation-worker',
      phase: 'IMPLEMENTATION',
      taskId: 'task-scene',
      revision: 'revision-1',
      allowedPaths: ['src/render/Scene.tsx'],
      contract: {
        task: {
          expectedArtifacts: ['src/render/Scene.tsx'],
          contentIds: [],
          verification: [
            {
              kind: 'file',
              commandOrAction: 'Inspect scene artifact',
              expectedResult: 'The scene exists',
            },
          ],
        },
      },
    })
    await port.submit('dispatch-implementation', 'Implement the scene')

    expect(submittedPrompt).toContain('SubmitImplementationResult exactly once')
    expect(submittedPrompt).toContain(
      'do not inspect workflow logs, transcripts, or historical evidence',
    )
    const {
      verificationObservations: _verificationObservations,
      ...terminalInput
    } = resultInput
    expect(await port.waitForTerminal?.('dispatch-implementation')).toEqual({
      workerType: 'implementation-worker',
      taskId: 'task-scene',
      revision: 'revision-1',
      ...terminalInput,
      verifiedArtifacts: ['src/render/Scene.tsx'],
      verificationResults: [
        {
          verificationIndex: 0,
          status: 'passed',
          observations: ['The scene artifact exists.'],
        },
      ],
      evidenceRefs: [
        '.beegame/workflow/evidence/implementation-dispatch-implementation.json',
      ],
      evidencePath:
        '.beegame/workflow/evidence/implementation-dispatch-implementation.json',
    })
  })

  test('derives validation identity and evidence from the active contract', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-validation-'))
    const sessions = {
      start() {
        return { id: 'session-auditor' }
      },
      updateAuthToken() {},
      async sendWithDisplay() {},
      events() {
        return [
          {
            id: 'validation-tool',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolName: 'SubmitValidationResult',
              input: {
                status: 'failed',
                findings: [
                  {
                    artifactPaths: ['src/game.ts'],
                    description: 'The game entry is disconnected.',
                    requiredAction: 'Connect the game entry.',
                  },
                ],
              },
            },
          },
          {
            id: 'validation-result',
            type: 'result',
            text: '',
            createdAt: new Date(),
            payload: { result: 'done' },
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      await port.start({
        dispatchId: 'dispatch-audit',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'implementation-auditor',
        phase: 'IMPLEMENTATION_AUDIT',
        revision: 'revision-1',
        allowedPaths: ['.beegame/workflow/evidence/'],
        contract: {
          taskIds: ['task-1'],
          tasks: [
            {
              id: 'task-1',
              allowedPaths: ['src/'],
              checklistIds: ['check-1'],
            },
          ],
          checklistIds: ['check-1'],
          resourceIds: ['resource-1'],
          contentIds: [],
        },
      })
      await port.submit('dispatch-audit', 'Audit implementation')
      const terminal = await port.waitForTerminal?.('dispatch-audit')
      expect(terminal).toEqual({
        workerType: 'implementation-auditor',
        revision: 'revision-1',
        status: 'failed',
        auditedTaskIds: ['task-1'],
        checklistIds: ['check-1'],
        resourceIds: ['resource-1'],
        contentIds: [],
        findings: [
          {
            taskIds: ['task-1'],
            checklistIds: ['check-1'],
            artifactPaths: ['src/game.ts'],
            description: 'The game entry is disconnected.',
            requiredAction: 'Connect the game entry.',
          },
        ],
        evidencePath:
          '.beegame/workflow/evidence/implementation-auditor-dispatch-audit.json',
      })
      expect(
        await readFile(
          join(
            workspacePath,
            '.beegame/workflow/evidence/implementation-auditor-dispatch-audit.json',
          ),
          'utf8',
        ),
      ).toContain('"revision":"revision-1"')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('derives document review from one structured submission without pre-persisting evidence', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-review-result-'),
    )
    let submittedPrompt = ''
    const finding = {
      findingId: 'document-conflict',
      checkId: 'cross_document_consistency',
      severity: 'blocking',
      owner: 'foundation',
      subjects: [
        { path: 'docs/GDD.md', anchor: 'Rules' },
        { path: 'docs/TECHNICAL_DESIGN.md', anchor: 'Rules' },
      ],
      observation:
        'The label "Level 3" conflicts with `Level 4`.\nBoth are explicit.',
      blockingReason: 'The implementation has no unique level rule.',
      requiredAction: 'Choose one level and update both documents.',
      closureCondition: 'Both documents define the same level rule.',
    }
    const {
      severity: _submissionSeverity,
      owner: _submissionOwner,
      ...findingInput
    } = finding
    const sessions = {
      start() {
        return { id: 'session-reviewer' }
      },
      updateAuthToken() {},
      async sendWithDisplay(_sessionId: string, prompt: string) {
        submittedPrompt = prompt
      },
      events() {
        return [
          {
            id: 'review-tool',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolName: 'SubmitDocumentReviewResult',
              input: {
                verdict: 'NEEDS_REVISION',
                checks: [
                  {
                    id: 'cross_document_consistency',
                    status: 'block',
                    conclusion: 'The documents conflict.',
                    evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
                    findingIds: ['document-conflict'],
                    assessments: [],
                  },
                ],
                findings: [findingInput],
              },
            },
          },
          {
            id: 'review-result',
            type: 'result',
            text: 'Review complete.',
            createdAt: new Date(),
            payload: { result: 'display prose is not a protocol' },
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      await port.start({
        dispatchId: 'dispatch-review',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: 'revision-1',
        allowedPaths: [],
        contract: {
          reviewScope: 'foundation',
          reviewAuthority: {
            confirmedBriefContext: 'Confirmed brief',
            confirmedBriefDigest: 'service-owned-digest',
          },
        },
      })
      await port.submit('dispatch-review', 'Review foundation documents')
      const terminal = await port.waitForTerminal?.('dispatch-review')
      expect(submittedPrompt).toContain(
        'SubmitDocumentReviewResult exactly once',
      )
      expect(submittedPrompt).not.toContain('Terminal JSON contract')
      expect(terminal).toMatchObject({
        workerType: 'document-reviewer',
        revision: 'revision-1',
        verdict: 'NEEDS_REVISION',
        checklistIds: [],
        findings: [finding],
      })
      await expect(
        readFile(
          join(
            workspacePath,
            '.beegame/workflow/evidence/document-review-foundation-dispatch-review.json',
          ),
          'utf8',
        ),
      ).rejects.toThrow()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('accepts a document author submission before the SDK emits a turn result', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-author-result-'),
    )
    const sessions = {
      start() {
        return { id: 'session-author-result' }
      },
      updateAuthToken() {},
      events() {
        return [
          {
            id: 'write-started',
            type: 'tool.started',
            text: '',
            createdAt: new Date(),
            payload: {
              toolUseID: 'write-gdd',
              toolName: 'Write',
              input: { file_path: 'docs/GDD.md' },
            },
          },
          {
            id: 'write-completed',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolUseID: 'write-gdd',
              toolName: 'Write',
              input: { file_path: 'docs/GDD.md' },
            },
          },
          {
            id: 'author-submission',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolUseID: 'submit-author-result',
              toolName: 'SubmitDocumentAuthorResult',
              input: { resolvedFindingIds: [] },
            },
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      await port.start({
        dispatchId: 'dispatch-author-result',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision-1',
        allowedPaths: ['docs/GDD.md'],
        contract: {},
      })

      await expect(
        port.waitForTerminal?.('dispatch-author-result'),
      ).resolves.toEqual({
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: ['docs/GDD.md'],
        resolvedFindingIds: [],
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('allows an idempotent document author submission with no file mutation', async () => {
    const sessions = {
      start() {
        return { id: 'session-author-no-op' }
      },
      updateAuthToken() {},
      events() {
        return [
          {
            id: 'author-no-op-submission',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolUseID: 'submit-author-no-op',
              toolName: 'SubmitDocumentAuthorResult',
              input: { resolvedFindingIds: [] },
            },
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    await port.start({
      dispatchId: 'dispatch-author-no-op',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-1',
      allowedPaths: ['docs/GDD.md'],
      contract: {},
    })

    await expect(
      port.waitForTerminal?.('dispatch-author-no-op'),
    ).resolves.toEqual({
      workerType: 'document-author',
      status: 'completed',
      writtenPaths: [],
      resolvedFindingIds: [],
    })
  })

  test('rejects deterministic checklist issue text submitted as a semantic finding id', async () => {
    const sessions = {
      start() {
        return { id: 'session-checklist-correction' }
      },
      updateAuthToken() {},
      events() {
        return [
          {
            id: 'checklist-correction-submission',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolUseID: 'submit-checklist-correction',
              toolName: 'SubmitDocumentAuthorResult',
              input: {
                resolvedFindingIds: [
                  'Checklist task 1 has no stable identifier.',
                ],
              },
            },
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    await port.start({
      dispatchId: 'dispatch-checklist-correction',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-author',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision-1',
      allowedPaths: ['docs/acceptance/gameplay-checklist.md'],
      contract: {
        documentSet: 'checklist',
        checklistRemediation: {
          sourceRevision: 'revision-1',
          attempt: 1,
          issues: ['Checklist task 1 has no stable identifier.'],
        },
      },
    })

    await expect(
      port.waitForTerminal?.('dispatch-checklist-correction'),
    ).rejects.toThrow(
      'checklistRemediation issues are not semantic finding IDs',
    )
  })

  test('accepts only the exact semantic remediation finding ids from the dispatch contract', async () => {
    const sessions = {
      start() {
        return { id: 'session-document-remediation' }
      },
      updateAuthToken() {},
      events() {
        return [
          {
            id: 'document-remediation-submission',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolUseID: 'submit-document-remediation',
              toolName: 'SubmitDocumentAuthorResult',
              input: { resolvedFindingIds: ['finding-2', 'finding-1'] },
            },
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    await port.start({
      dispatchId: 'dispatch-document-remediation',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-1',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        documentSet: 'foundation',
        remediation: {
          findings: [
            { findingId: 'finding-1' },
            { findingId: 'finding-2' },
          ],
        },
      },
    })

    await expect(
      port.waitForTerminal?.('dispatch-document-remediation'),
    ).resolves.toEqual({
      workerType: 'document-author',
      status: 'completed',
      writtenPaths: [],
      resolvedFindingIds: ['finding-1', 'finding-2'],
    })
  })

  test('rejects the retired remediation id field instead of dual-reading it', async () => {
    const sessions = {
      start() {
        return { id: 'session-retired-remediation-id' }
      },
      updateAuthToken() {},
      events() {
        return [{
          id: 'retired-remediation-submission',
          type: 'tool.completed',
          text: '',
          createdAt: new Date(),
          payload: {
            toolName: 'SubmitDocumentAuthorResult',
            input: { resolvedFindingIds: ['finding-1'] },
          },
        }]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    await port.start({
      dispatchId: 'dispatch-retired-remediation-id',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-1',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        documentSet: 'foundation',
        remediation: { findings: [{ id: 'finding-1' }] },
      },
    })

    await expect(
      port.waitForTerminal?.('dispatch-retired-remediation-id'),
    ).rejects.toThrow('contract.remediation findingId is invalid')
  })

  test('does not accept a structured document result hidden behind a deferred wrapper', async () => {
    const sessions = {
      start() {
        return { id: 'session-wrapped-author' }
      },
      updateAuthToken() {},
      events() {
        return [
          {
            id: 'wrapped-author-result',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolName: 'ExecuteExtraTool',
              input: {
                tool_name: 'SubmitDocumentAuthorResult',
                params: { resolvedFindingIds: ['finding-1'] },
              },
              output: JSON.stringify({
                result: { accepted: true, workerType: 'document-author' },
                tool_name: 'SubmitDocumentAuthorResult',
              }),
            },
          },
          {
            id: 'wrapped-author-turn-result',
            type: 'result',
            text: 'Accepted.',
            createdAt: new Date(),
            payload: { result: 'Accepted.' },
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })

    await port.start({
      dispatchId: 'dispatch-wrapped-author',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-1',
      allowedPaths: ['docs/GDD.md'],
      contract: {},
    })

    await expect(
      port.waitForTerminal?.('dispatch-wrapped-author'),
    ).rejects.toThrow(
      'worker terminal result is missing a valid SubmitDocumentAuthorResult call',
    )
  })

  test('resolves the current auth token for every worker start and submit', async () => {
    const starts: Array<{ authToken?: string }> = []
    const updates: Array<{ sessionId: string; authToken?: string }> = []
    const displays: Array<{ authToken?: string }> = []
    const tokenResolvers: Array<
      ((options?: { forceRefresh?: boolean }) => unknown) | undefined
    > = []
    const sessions = {
      start(input: {
        authToken?: string
        getValidAuthToken?: (options?: { forceRefresh?: boolean }) => unknown
      }) {
        starts.push(input)
        tokenResolvers.push(input.getValidAuthToken)
        return { id: `session-${starts.length}` }
      },
      updateAuthToken(sessionId: string, authToken?: string) {
        updates.push({ sessionId, authToken })
      },
      async sendWithDisplay(
        _sessionId: string,
        _prompt: string,
        display: { authToken?: string },
      ) {
        displays.push(display)
      },
    } as unknown as BeeGameSessionManager
    let authToken = 'author-token'
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
      getAuthToken: () => authToken,
    })
    const request: WorkerDispatchRequest = {
      dispatchId: 'dispatch-1',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision-1',
      contract: {
        reviewAuthority: {
          confirmedBriefContext: 'Confirmed brief',
          confirmedBriefDigest: 'service-owned-digest',
        },
      },
    }

    await port.start(request)
    authToken = 'reviewer-token'
    await port.submit('dispatch-1', 'Review the documents')
    authToken = 'next-phase-token'
    await port.start({
      ...request,
      dispatchId: 'dispatch-2',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision-2',
    })

    expect(starts.map(start => start.authToken)).toEqual([
      'author-token',
      'next-phase-token',
    ])
    expect(updates).toEqual([
      { sessionId: 'session-1', authToken: 'reviewer-token' },
    ])
    expect(displays.map(display => display.authToken)).toEqual([
      'reviewer-token',
    ])
    authToken = 'forced-refresh-token'
    expect(await tokenResolvers[1]?.({ forceRefresh: true })).toBe(
      'forced-refresh-token',
    )
  })

  test('derives and persists the atomic task planner terminal from one structured tool call', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-task-terminal-'),
    )
    const evidencePath =
      '.beegame/workflow/evidence/atomic-task-plan-dispatch-task-plan.json'
    try {
      await mkdir(join(workspacePath, '.beegame/workflow/evidence'), {
        recursive: true,
      })
      const planInput = {
        tasks: [
          {
            id: 'task-1',
            title: 'Create the runtime entry point',
            dependsOn: [],
            allowedPaths: ['src/'],
            expectedArtifacts: ['src/main.ts'],
            resourceIds: [],
            contentIds: [],
            verification: [
              {
                kind: 'build',
                commandOrAction: 'bun run build',
                expectedResult: 'Build exits successfully',
              },
            ],
          },
        ],
        ownership: {
          checklistItems: [{ id: 'check-1', taskId: 'task-1' }],
        },
      }
      const sessions = {
        start() {
          return { id: 'session-task-planner' }
        },
        events() {
          return [
            {
              id: 'event-1',
              type: 'tool.started',
              text: '',
              createdAt: new Date(),
              payload: {
                toolUseID: 'submit-plan',
                toolName: 'SubmitAtomicTaskPlan',
                input: planInput,
              },
            },
            {
              id: 'event-2',
              type: 'tool.completed',
              text: '',
              createdAt: new Date(),
              payload: {
                toolUseID: 'submit-plan',
                toolName: 'SubmitAtomicTaskPlan',
                input: planInput,
              },
            },
            {
              id: 'event-3',
              type: 'result',
              text: 'Task plan ready.',
              createdAt: new Date(),
              payload: { result: 'Task plan ready.' },
            },
          ]
        },
      } as unknown as BeeGameSessionManager
      const port = createBeeGameDeliveryWorkerPort({
        sessions,
        userId: 'user-1',
      })

      await port.start({
        dispatchId: 'dispatch-task-plan',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'atomic-task-planner',
        phase: 'ATOMIC_TASK_PLANNING',
        revision: 'revision-1',
        allowedPaths: ['.beegame/workflow/evidence/'],
        contract: {},
      })

      expect(await port.waitForTerminal?.('dispatch-task-plan')).toMatchObject({
        workerType: 'atomic-task-planner',
        status: 'completed',
        revision: 'revision-1',
        evidencePath,
        tasks: [
          {
            id: 'task-1',
            contentIds: [],
            expectedArtifacts: ['src/main.ts'],
          },
        ],
      })
      expect(
        JSON.parse(await readFile(join(workspacePath, evidencePath), 'utf8')),
      ).toMatchObject({
        workerType: 'atomic-task-planner',
        tasks: [{ id: 'task-1' }],
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('derives the resource terminal from durable workspace facts instead of assistant prose', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-resource-terminal-'),
    )
    try {
      await mkdir(join(workspacePath, 'assets/runtime/root'), {
        recursive: true,
      })
      await writeFile(
        join(workspacePath, 'assets/runtime/root/root.glb'),
        new Uint8Array([1, 2, 3]),
      )
      await writeFile(
        join(workspacePath, 'assets/asset-manifest.json'),
        JSON.stringify({
          version: 7,
          project_target: {
            asset_format_capabilities: ['glb'],
            runtime_asset_root: 'assets/runtime',
            content_root: 'assets/content',
            generated_asset_root: 'assets/generated',
          },
          requirements: [
            {
              id: 'root-model',
              required: true,
            },
          ],
          resources: [
            {
              id: 'root',
              source: {
                type: 'resource-library',
                pack_id: 'pack-1',
                pack_version: '1.0.0',
                element_id: 'root',
                element_path: 'models/root.glb',
              },
              status: 'verified',
              root_path: 'assets/runtime/root/root.glb',
              file_paths: ['assets/runtime/root/root.glb'],
              provisional: false,
              selected_at: new Date().toISOString(),
              selection_reason: ['Approved asset plan'],
            },
          ],
        }),
      )
      await mkdir(join(workspacePath, 'assets/content'), { recursive: true })
      await writeFile(
        join(workspacePath, 'assets/content/resources.json'),
        JSON.stringify({ schema: 'beegame-content-v1', id: 'resources', kind: 'resource-registry', fulfills: ['root-model'], resources: ['root'], data: {} }),
      )
      const starts: Array<Record<string, unknown>> = []
      const sessions = {
        start(input: Record<string, unknown>) {
          starts.push(input)
          return { id: 'session-resource' }
        },
        events() {
          return [
            {
              id: 'event-1',
              type: 'tool.started',
              text: '',
              createdAt: new Date(),
              payload: {
                toolUseID: 'denied-write',
                toolName: 'Write',
                input: { file_path: join(workspacePath, 'src/forbidden.ts') },
              },
            },
            {
              id: 'event-2',
              type: 'tool.started',
              text: '',
              createdAt: new Date(),
              payload: {
                toolUseID: 'completed-write',
                toolName: 'Write',
                input: {
                  file_path: join(workspacePath, 'assets/content/resource-note.json'),
                },
              },
            },
            {
              id: 'event-3',
              type: 'tool.completed',
              text: '',
              createdAt: new Date(),
              payload: {
                toolUseID: 'completed-write',
                toolName: 'Write',
              },
            },
            {
              id: 'event-4',
              type: 'result',
              text: 'Resources are ready.',
              createdAt: new Date(),
              payload: { result: 'This is prose, not terminal JSON.' },
            },
          ]
        },
      } as unknown as BeeGameSessionManager
      const port = createBeeGameDeliveryWorkerPort({
        sessions,
        userId: 'user-1',
      })
      const request: WorkerDispatchRequest = {
        dispatchId: 'dispatch-resource',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'resource-preparer',
        phase: 'RESOURCE_PREPARATION',
        revision: 'revision-1',
        allowedPaths: [
          'assets/asset-manifest.json',
          'assets/runtime/',
          'assets/content/',
          'assets/generated/',
        ],
        contract: {},
      }

      await port.start(request)
      const terminal = await port.waitForTerminal?.('dispatch-resource')

      expect(starts[0]).toMatchObject({
        workflowWorker: true,
        workflowWorkerType: 'resource-preparer',
      })
      expect(terminal).toMatchObject({
        workerType: 'resource-preparer',
        revision: 'revision-1',
        status: 'completed',
        resourceIds: ['root'],
      })
      expect(
        (terminal as { writtenPaths: string[] }).writtenPaths,
      ).not.toContain('src/forbidden.ts')
      expect((terminal as { writtenPaths: string[] }).writtenPaths).toContain(
        'assets/content/resource-note.json',
      )
      const evidencePath = (terminal as { evidencePath: string }).evidencePath
      const evidence = JSON.parse(
        await readFile(join(workspacePath, evidencePath), 'utf8'),
      )
      expect(evidence).toMatchObject({
        status: 'completed',
        manifestPresent: true,
        manifestValid: true,
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('stops a resource worker that repeats the same read without a durable mutation', async () => {
    const repeatedOutput = JSON.stringify({ items: [{ id: 'catalog-item' }] })
    const events = Array.from({ length: 4 }, (_, index) => ({
      id: `event-${index}`,
      type: 'tool.completed' as const,
      text: '',
      createdAt: new Date(),
      payload: {
        toolUseID: `read-${index}`,
        toolName: 'ResourceLibrary',
        input: { action: 'browse_catalog', page: 1, page_size: 25 },
        output: repeatedOutput,
      },
    }))
    const sessions = {
      start() {
        return { id: 'session-resource-loop' }
      },
      events() {
        return events
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
      resourceLimits: { repeatedReadResultLimit: 4 },
    })

    await port.start({
      dispatchId: 'dispatch-resource-loop',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision-1',
      contract: {},
    })

    try {
      await port.waitForTerminal?.('dispatch-resource-loop')
      throw new Error('expected resource convergence guard to stop the worker')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).name).toBe('WorkerNeedsActionError')
      expect((error as Error).message).toContain(
        'repeated the same read result 4 times',
      )
    }
  })

  test('reports an in-flight Resource Library import as unsafe to interrupt', async () => {
    const events: Array<{
      id: string
      type: 'tool.started' | 'tool.completed'
      text: string
      createdAt: Date
      payload: {
        toolUseID: string
        toolName: string
        input: { action: string; selections: unknown[] }
      }
    }> = [
      {
        id: 'event-import-started',
        type: 'tool.started' as const,
        text: '',
        createdAt: new Date(),
        payload: {
          toolUseID: 'import-batch',
          toolName: 'ResourceLibrary',
          input: { action: 'import_resources', selections: [] },
        },
      },
    ]
    const sessions = {
      start() {
        return { id: 'session-resource-import' }
      },
      events() {
        return events
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
    })

    await port.start({
      dispatchId: 'dispatch-resource-import',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision-1',
      contract: {},
    })

    await expect(
      port.hasInFlightMutation?.('dispatch-resource-import'),
    ).resolves.toBe(true)
    events.push({
      id: 'event-import-completed',
      type: 'tool.completed',
      text: '',
      createdAt: new Date(),
      payload: {
        toolUseID: 'import-batch',
        toolName: 'ResourceLibrary',
        input: { action: 'import_resources', selections: [] },
      },
    })
    await expect(
      port.hasInFlightMutation?.('dispatch-resource-import'),
    ).resolves.toBe(false)
  })

  test('reports only an actively streaming terminal tool submission', async () => {
    const events: Array<{
      id: string
      type: 'tool.started' | 'tool.completed'
      text: string
      createdAt: Date
      payload: { toolUseID: string; toolName: string; input: Record<string, never> }
    }> = [{
      id: 'review-terminal-started',
      type: 'tool.started' as const,
      text: '',
      createdAt: new Date(),
      payload: {
        toolUseID: 'review-terminal',
        toolName: 'SubmitDocumentReviewResult',
        input: {},
      },
    }]
    const sessions = {
      start() {
        return { id: 'session-review-terminal' }
      },
      events() {
        return events
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    await port.start({
      dispatchId: 'dispatch-review-terminal',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision-1',
      contract: {},
    })

    await expect(
      port.hasInFlightTerminalSubmission?.('dispatch-review-terminal'),
    ).resolves.toBe(true)
    events.push({
      id: 'review-terminal-completed',
      type: 'tool.completed',
      text: '',
      createdAt: new Date(),
      payload: {
        toolUseID: 'review-terminal',
        toolName: 'SubmitDocumentReviewResult',
        input: {},
      },
    })
    await expect(
      port.hasInFlightTerminalSubmission?.('dispatch-review-terminal'),
    ).resolves.toBe(false)
  })

  test('does not classify rejected unsupported resource calls as catalog reads', async () => {
    const rejectedOutput = 'Unsupported ResourceLibrary action.'
    const rejectedEvents = Array.from({ length: 4 }, (_, index) => ({
      id: `event-${index}`,
      type: 'tool.failed' as const,
      text: rejectedOutput,
      createdAt: new Date(),
      payload: {
        toolUseID: `unsupported-${index}`,
        toolName: 'ResourceLibrary',
        input: {
          action: 'unsupported_action',
        },
        output: rejectedOutput,
      },
    }))
    let reads = 0
    const sessions = {
      start() {
        return { id: 'session-resource-rejected-parallel' }
      },
      events() {
        reads += 1
        return reads === 1
          ? rejectedEvents
          : [
              ...rejectedEvents,
              {
                id: 'terminal-failure',
                type: 'turn.failed' as const,
                text: 'model turn ended after rejected calls',
                createdAt: new Date(),
              },
            ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
      resourceLimits: {
        repeatedReadResultLimit: 4,
      },
    })

    await port.start({
      dispatchId: 'dispatch-resource-rejected-parallel',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision-1',
      contract: {},
    })

    await expect(
      port.waitForTerminal?.('dispatch-resource-rejected-parallel'),
    ).rejects.toThrow('model turn ended after rejected calls')
  })
})
