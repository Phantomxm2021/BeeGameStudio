import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  buildDocumentAuthorAuthorityBlock,
  createBeeGameDeliveryWorkerPort,
} from '../beegame/delivery-worker-session-port'
import {
  registerBeeGameAuthoredResources,
  writeBeeGameAssetManifest,
} from '../beegame/asset-contracts'
import type { BeeGameSessionManager } from '../beegame/session-manager'
import type { WorkerDispatchRequest } from '../beegame/delivery-workflow/types'
import { createNativeResourceContentTool } from '../beegame/native-resource-content-tool'
import {
  computeDocumentRevision,
  computeResourceInventoryRevision,
  computeResourceRevision,
} from '../beegame/delivery-workflow/revision'
import { getGameDocumentContract } from '../beegame/delivery-workflow/game-document-contracts'
import { buildWorkerPrompt } from '../beegame/delivery-workflow/worker-prompts'
import { foundationReviewStagingPath } from '../beegame/delivery-workflow/foundation-review'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../beegame/delivery-workflow/types'

describe('delivery worker session credentials', () => {
  test('accepts only the planner resource-plan terminal contract', async () => {
    const workspacePath = await createResourceWorkspace()
    try {
      await writeBeeGameAssetManifest(workspacePath, resourcePlanManifest())
      const terminal = await runResourceTerminal({
        workspacePath,
        workerType: 'resource-planner',
        toolName: 'AssetManifest',
        toolInput: { action: 'submit_resource_plan' },
      })

      expect(terminal).toEqual({
        revision: 'revision-resource-terminal',
        workerType: 'resource-planner',
        status: 'completed',
        writtenPaths: ['assets/asset-manifest.json'],
        taskMetrics: {
          catalogPayloadBytes: 0,
          catalogCallTypes: [],
          canonicalMutationCount: 1,
        },
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects curator tool history when no durable inventory receipt exists', async () => {
    const workspacePath = await createResourceWorkspace()
    try {
      await writeBeeGameAssetManifest(workspacePath, resourcePlanManifest())
      await mkdir(join(workspacePath, 'assets/runtime'), { recursive: true })
      await writeFile(join(workspacePath, 'assets/runtime/world.dat'), 'world')
      await registerBeeGameAuthoredResources(workspacePath, [
        {
          id: 'world-resource',
          root_path: 'assets/runtime/world.dat',
          file_paths: ['assets/runtime/world.dat'],
          provisional: true,
          reason: 'Independent resource terminal fixture.',
          selection_reason: ['Exercises the curator receipt boundary.'],
          asset_kind: 'data',
        },
      ])
      await expect(
        runResourceTerminal({
          workspacePath,
          workerType: 'resource-curator',
          catalogObserved: true,
          toolName: 'CommitResourceInventory',
          toolInput: {
            decisions: [
              {
                requirement_id: 'world.visual',
                resource_id: 'world-resource',
                kind: 'placeholder',
              },
            ],
          },
        }),
      ).rejects.toThrow('without an accepted durable inventory receipt')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('accepts a content inventory request only for exact manifest requirement IDs', async () => {
    const workspacePath = await createResourceWorkspace()
    try {
      await writeBeeGameAssetManifest(workspacePath, resourcePlanManifest())
      const contract = {
        dispatchId: 'dispatch-resource-content-author',
        inventoryRevision:
          await computeResourceInventoryRevision(workspacePath),
        baselineResourceRevision: await computeResourceRevision(
          workspacePath,
          '',
        ),
        requiredRequirementIds: ['world.visual'],
        verifiedResourceIds: [],
        inventoryBindings: [],
        writablePaths: ['assets/content/resource-registry.json'],
        repairPaths: ['assets/content/resource-registry.json'],
      }
      const tool = createNativeResourceContentTool({
        buildTool: definition => definition,
        workspacePath,
        contract,
        assertMutationAuthority: () => undefined,
      }) as { call(input: unknown): Promise<unknown> }
      await tool.call({
        action: 'needs_inventory',
        missingRequirementIds: ['world.visual'],
      })
      const terminal = await runResourceTerminal({
        workspacePath,
        workerType: 'resource-content-author',
        toolName: 'CommitResourceContent',
        toolInput: {
          action: 'needs_inventory',
          missingRequirementIds: ['world.visual'],
        },
        contract: {
          ...contract,
        },
      })

      expect(terminal).toMatchObject({
        revision: 'revision-resource-terminal',
        workerType: 'resource-content-author',
        status: 'needs_inventory',
        missingRequirementIds: ['world.visual'],
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('waits through a prepared resource receipt and accepts only its committed proof', async () => {
    const workspacePath = await createResourceWorkspace()
    try {
      await writeBeeGameAssetManifest(workspacePath, resourcePlanManifest())
      await mkdir(join(workspacePath, 'assets/runtime'), { recursive: true })
      await writeFile(join(workspacePath, 'assets/runtime/world.dat'), 'world')
      await registerBeeGameAuthoredResources(workspacePath, [
        {
          id: 'world-resource',
          root_path: 'assets/runtime/world.dat',
          file_paths: ['assets/runtime/world.dat'],
          provisional: true,
          reason: 'Durable Resource Content receipt fixture.',
          selection_reason: ['Exercises restart recovery.'],
          asset_kind: 'data',
        },
      ])
      const contract = {
        dispatchId: 'dispatch-content-receipt',
        inventoryRevision:
          await computeResourceInventoryRevision(workspacePath),
        baselineResourceRevision: await computeResourceRevision(
          workspacePath,
          '',
        ),
        requiredRequirementIds: ['world.visual'],
        verifiedResourceIds: ['world-resource'],
        inventoryBindings: [
          {
            requirementId: 'world.visual',
            resourceIds: ['world-resource'],
          },
        ],
        writablePaths: ['assets/content/resource-registry.json'],
        repairPaths: ['assets/content/resource-registry.json'],
      }
      const tool = createNativeResourceContentTool({
        buildTool: definition => definition,
        workspacePath,
        contract,
        assertMutationAuthority: () => undefined,
      }) as {
        call(input: unknown): Promise<unknown>
      }
      await tool.call({
        action: 'commit',
        documents: {
          'assets/content/resource-registry.json': {
            schema: 'beegame-content-v1',
            id: 'resource-registry',
            kind: 'resource-registry',
            fulfills: ['world.visual'],
            resources: ['world-resource'],
            data: {
              bindings: [
                {
                  requirementId: 'world.visual',
                  resourceIds: ['world-resource'],
                },
              ],
            },
          },
        },
      })
      const receiptPath = join(
        workspacePath,
        '.beegame/workflow/resource-content-commits',
        `${contract.dispatchId}.json`,
      )
      const committedReceipt = JSON.parse(await readFile(receiptPath, 'utf8'))
      await writeFile(
        receiptPath,
        `${JSON.stringify({ ...committedReceipt, status: 'prepared' }, null, 2)}\n`,
      )

      const sessions = {
        start() {
          return { id: 'session-content-receipt' }
        },
        events() {
          return [
            {
              id: 'content-result-without-tool-event',
              type: 'result' as const,
              text: 'completed',
              createdAt: new Date(),
            },
          ]
        },
      } as unknown as BeeGameSessionManager
      const port = createBeeGameDeliveryWorkerPort({
        sessions,
        userId: 'user-1',
      })
      await port.start({
        dispatchId: contract.dispatchId,
        runId: 'run-content-receipt',
        ownerId: 'user-1',
        projectId: 'project-content-receipt',
        workspacePath,
        workerType: 'resource-content-author',
        phase: 'RESOURCE_PREPARATION',
        revision: 'revision-content-receipt',
        contract: {
          ...contract,
        },
      })

      const terminalResult = port.waitForTerminal!(contract.dispatchId).then(
        value => ({ value }),
        error => ({ error }),
      )
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toMatchObject({
        status: 'prepared',
      })
      await writeFile(
        receiptPath,
        `${JSON.stringify(committedReceipt, null, 2)}\n`,
      )

      await expect(terminalResult).resolves.toEqual({
        value: {
          revision: 'revision-content-receipt',
          workerType: 'resource-content-author',
          status: 'completed',
          contentIds: ['resource-registry'],
          writtenPaths: ['assets/content/resource-registry.json'],
          missingRequirementIds: [],
          taskMetrics: {
            catalogPayloadBytes: 0,
            catalogCallTypes: [],
            canonicalMutationCount: 1,
          },
        },
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('gives Resource Content Author read access to its existing content set', async () => {
    const starts: Array<Record<string, unknown>> = []
    const sessions = {
      start(input: Record<string, unknown>) {
        starts.push(input)
        return { id: 'session-resource-content' }
      },
      updateAuthToken() {},
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })

    await port.start({
      dispatchId: 'dispatch-resource-content',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'resource-content-author',
      phase: 'RESOURCE_PREPARATION',
      taskId: 'RESOURCE_CONTENT',
      revision: 'revision-1',
      allowedPaths: ['assets/content/'],
      contract: {
        authorityPaths: ['docs/GDD.md'],
        repairPaths: ['assets/content/entity-definitions.json'],
        inventoryRevision: 'inventory-revision',
        baselineResourceRevision: 'resource-revision',
        requiredRequirementIds: ['world.visual'],
        verifiedResourceIds: ['world-resource'],
        inventoryBindings: [
          { requirementId: 'world.visual', resourceIds: ['world-resource'] },
        ],
      },
    })

    expect(starts[0]).toMatchObject({
      workflowAllowedPaths: ['assets/content/'],
      workflowReadOnlyPaths: [
        'docs/GDD.md',
        'assets/content/entity-definitions.json',
      ],
    })
    expect(starts[0].workflowProtectedPaths).toBeUndefined()
  })

  test('does not inject a custom document commit contract during initial authoring', async () => {
    const starts: Array<Record<string, unknown>> = []
    const sessions = {
      start(input: Record<string, unknown>) {
        starts.push(input)
        return { id: `session-${starts.length}` }
      },
      updateAuthToken() {},
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    const base = {
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-author' as const,
      phase: 'DOCUMENT_DRAFTING' as const,
      revision: 'revision-1',
    }
    await port.start({
      ...base,
      dispatchId: 'dispatch-gdd',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/GDD.md',
      },
    })
    await port.start({
      ...base,
      dispatchId: 'dispatch-level',
      allowedPaths: ['docs/LEVEL_SCENE_DESIGN.md'],
      contract: {
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/LEVEL_SCENE_DESIGN.md',
      },
    })

    expect(starts[0]?.workflowDocumentAuthorMode).toBe('initial')
    expect(starts[1]?.workflowDocumentAuthorMode).toBe('initial')
    expect(starts[0]?.workflowCanonicalDocumentCommitContract).toBeUndefined()
    expect(starts[1]?.workflowCanonicalDocumentCommitContract).toBeUndefined()
  })

  test('does not expose stale target content or native file instructions', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'initial-authority-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(
        join(workspacePath, 'docs/GDD.md'),
        'stale target content',
      )
      const block = await buildDocumentAuthorAuthorityBlock({
        dispatchId: 'dispatch-gdd-baseline',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision-1',
        allowedPaths: ['docs/GDD.md'],
        contract: {
          authoringMode: 'initial',
          foundationDocumentPath: 'docs/GDD.md',
          upstreamDocumentPaths: [],
        },
      })
      expect(block).toBe('')
      expect(block).not.toContain('stale target content')
      expect(block).not.toContain('CommitCanonicalDocument')
      expect(block).not.toContain(
        'Write the complete assigned Markdown document directly',
      )
      expect(block).not.toContain('complete when the turn ends')
      expect(block).not.toContain('file-operation sequence')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('sends one authoritative initial document instruction without wrapper repetition', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-prompt-once-'))
    let submittedPrompt = ''
    const sessions = {
      start() {
        return { id: 'session-document-prompt-once' }
      },
      updateAuthToken() {},
      async sendWithDisplay(_sessionId: string, prompt: string) {
        submittedPrompt = prompt
      },
    } as unknown as BeeGameSessionManager
    const request: WorkerDispatchRequest = {
      dispatchId: 'dispatch-document-prompt-once',
      runId: 'run-document-prompt-once',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-1',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        authoringMode: 'initial',
        documentSet: 'foundation',
        foundationDocumentPath: 'docs/GDD.md',
        upstreamDocumentPaths: [],
        completeDocumentContract: getGameDocumentContract('docs/GDD.md'),
      },
    }
    try {
      const port = createBeeGameDeliveryWorkerPort({
        sessions,
        userId: 'user-1',
        confirmedBriefContext: '{"kind":"confirmed_build_brief"}',
      })
      await port.start(request)
      await port.submit(request.dispatchId!, buildWorkerPrompt(request))

      expect(submittedPrompt).not.toContain(
        'Author the assigned Markdown document',
      )
      expect(submittedPrompt).not.toContain('complete when the turn ends')
      expect(submittedPrompt).not.toContain('file-operation sequence')
      expect(submittedPrompt).toContain(
        'Return exactly one complete raw Markdown body for docs/GDD.md',
      )
      expect(submittedPrompt).toContain('Do not call tools')
      expect(submittedPrompt).not.toContain(
        'Continuous bounded document sequence',
      )
      expect(submittedPrompt).not.toContain('original complete document prompt')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('never degrades a remediation dispatch into a document creation', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'remediation-metadata-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(join(workspacePath, 'docs/GDD.md'), 'existing document')
      const sessions = {
        start() {
          throw new Error('session must not start')
        },
        updateAuthToken() {},
      } as unknown as BeeGameSessionManager
      const port = createBeeGameDeliveryWorkerPort({
        sessions,
        userId: 'user-1',
      })

      await expect(
        port.start({
          dispatchId: 'dispatch-remediation',
          runId: 'run-1',
          ownerId: 'user-1',
          projectId: 'project-1',
          workspacePath,
          workerType: 'document-author',
          phase: 'DOCUMENT_DRAFTING',
          revision: 'revision-1',
          allowedPaths: ['docs/GDD.md'],
          contract: {
            authoringMode: 'remediation',
            remediation: { findings: [{ findingId: 'finding-1' }] },
          },
        }),
      ).rejects.toThrow('document remediation authority is invalid')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
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
        'workflow service persists the accepted plan as canonical evidence',
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
      "Bee Game Studio's native tools, reasoning, permissions, context management, and normal completion behavior remain unchanged",
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

  test('derives the document terminal from a normal Claude result and assigned file', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-canonical-author-'),
    )
    const sessions = {
      start() {
        return { id: 'session-canonical-author' }
      },
      updateAuthToken() {},
      events() {
        return [
          {
            id: 'normal-document-result',
            type: 'result' as const,
            text: 'Document complete.',
            createdAt: new Date(),
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      await port.start({
        dispatchId: 'dispatch-canonical-author',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision-1',
        allowedPaths: ['docs/GDD.md'],
        contract: {
          authoringMode: 'initial',
          foundationDocumentPath: 'docs/GDD.md',
          upstreamDocumentPaths: [],
        },
      })
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(
        join(workspacePath, 'docs/GDD.md'),
        '# Game Design\n\nCanonical rules.\n',
      )
      await expect(
        port.waitForTerminal?.('dispatch-canonical-author'),
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

  test('derives every completed native edit path for one Foundation remediation lane', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-coordinated-remediation-'),
    )
    const events: Array<Record<string, unknown>> = []
    const sessions = {
      start() {
        return { id: 'session-coordinated-remediation' }
      },
      updateAuthToken() {},
      events() {
        return events
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      const writtenPaths = ['docs/GDD.md']
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      for (const path of writtenPaths)
        await writeFile(join(workspacePath, path), `# Updated ${path}\n`)
      const sourceRevision = 'b'.repeat(64)
      const reviewPath = `.beegame/reviews/foundation/${sourceRevision}/review.json`
      const reviewBytes = `${JSON.stringify({
        version: 2,
        scope: 'foundation',
        revision: sourceRevision,
        verdict: 'NEEDS_REVISION',
        priorConflictStatus: [],
        conflicts: [
          {
            id: 'B1',
            title: 'Shared authority mismatch',
            problem: 'Two documents disagree.',
            evidence: [
              {
                path: writtenPaths[0],
                location: 'Rules',
                observed: 'The documents disagree.',
              },
            ],
            requiredOutcome: 'Both documents agree.',
            changes: writtenPaths.map(path => ({
              path,
              action: 'Use the shared authority.',
            })),
            acceptance: ['Both documents use the shared authority.'],
          },
        ],
      })}\n`
      await mkdir(join(workspacePath, '.beegame/reviews/foundation', sourceRevision), {
        recursive: true,
      })
      await writeFile(join(workspacePath, reviewPath), reviewBytes)
      await port.start({
        dispatchId: 'dispatch-coordinated-remediation',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision-1',
        allowedPaths: writtenPaths,
        contract: {
          authoringMode: 'remediation',
          documentSet: 'foundation',
          remediation: {
            laneId: 'core-design',
            reviewPath,
            reviewDigest: createHash('sha256').update(reviewBytes).digest('hex'),
            affectedPaths: writtenPaths,
            sourceRevision,
          },
        },
      })
      for (const [index, path] of writtenPaths.entries()) {
        const toolUseID = `edit-${index}`
        events.push(
          {
            id: `${toolUseID}-started`,
            type: 'tool.started',
            text: '',
            createdAt: new Date(),
            payload: { toolUseID, toolName: 'Edit', input: { file_path: path } },
          },
          {
            id: `${toolUseID}-completed`,
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: { toolUseID, toolName: 'Edit', input: { file_path: path } },
          },
        )
      }
      events.push({
        id: 'result-coordinated-remediation',
        type: 'result',
        text: 'Remediation complete.',
        createdAt: new Date(),
      })

      await expect(
        port.waitForTerminal?.('dispatch-coordinated-remediation'),
      ).resolves.toMatchObject({ writtenPaths })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('reports a missing assigned document instead of a missing BeeGame tool', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-missing-author-'),
    )
    const sessions = {
      start() {
        return { id: 'session-missing-author' }
      },
      updateAuthToken() {},
      events() {
        return [
          {
            id: 'normal-result-without-document',
            type: 'result' as const,
            text: 'Document complete.',
            createdAt: new Date(),
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      await port.start({
        dispatchId: 'dispatch-missing-author',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision-1',
        allowedPaths: ['docs/GDD.md'],
        contract: {
          authoringMode: 'initial',
          foundationDocumentPath: 'docs/GDD.md',
          upstreamDocumentPaths: [],
        },
      })
      await expect(
        port.waitForTerminal?.('dispatch-missing-author'),
      ).rejects.toThrow('document author output is missing: docs/GDD.md')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
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
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-1',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/GDD.md',
        upstreamDocumentPaths: [],
      },
    }

    await port.start(request)
    authToken = 'reviewer-token'
    await port.submit('dispatch-1', 'Review the documents')
    authToken = 'next-phase-token'
    await port.start({
      ...request,
      dispatchId: 'dispatch-2',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
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

  test('reports an in-flight inventory commit as unsafe to interrupt', async () => {
    const events: Array<{
      id: string
      type: 'tool.started' | 'tool.completed'
      text: string
      createdAt: Date
      payload: {
        toolUseID: string
        toolName: string
        input: Record<string, unknown>
      }
    }> = [
      {
        id: 'event-import-started',
        type: 'tool.started' as const,
        text: '',
        createdAt: new Date(),
        payload: {
          toolUseID: 'import-batch',
          toolName: 'CommitResourceInventory',
          input: { decisions: [] },
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
      workerType: 'resource-curator',
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
        toolName: 'CommitResourceInventory',
        input: { decisions: [] },
      },
    })
    await expect(
      port.hasInFlightMutation?.('dispatch-resource-import'),
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
    })

    await port.start({
      dispatchId: 'dispatch-resource-rejected-parallel',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision-1',
      contract: {},
    })

    await expect(
      port.waitForTerminal?.('dispatch-resource-rejected-parallel'),
    ).rejects.toThrow('model turn ended after rejected calls')
  })

  test('accepts one canonical foundation review JSON and derives its terminal', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-foundation-review-terminal-'),
    )
    const confirmedBriefDigest = 'b'.repeat(64)
    try {
      const revision = await computeDocumentRevision(
        workspacePath,
        confirmedBriefDigest,
      )
      const stagingPath = foundationReviewStagingPath(
        workspacePath,
        revision,
        'foundation-initial-1-synthesis',
      )
      await mkdir(dirname(stagingPath), { recursive: true })
      await writeFile(
        stagingPath,
        `${JSON.stringify({
          version: 2,
          scope: 'foundation',
          revision,
          verdict: 'READY',
          priorConflictStatus: [],
          conflicts: [],
        })}\n`,
        'utf8',
      )
      const events = [
        {
          id: 'foundation-review-result',
          type: 'result' as const,
          text: 'completed',
          createdAt: new Date(),
        },
      ]
      const sessions = {
        start() {
          return { id: 'session-foundation-reviewer' }
        },
        events() {
          return events
        },
      } as unknown as BeeGameSessionManager
      const port = createBeeGameDeliveryWorkerPort({
        sessions,
        userId: 'user-1',
      })
      const assignment = {
        scope: 'foundation',
        role: 'synthesis',
        sourcePaths: ['core-design', 'technical-assets', 'presentation'].map(
          lane =>
            join(
              workspacePath,
              `.beegame/reviews/foundation/${revision}/parts/${lane}.json`,
            ),
        ),
        verificationSourcePaths: [],
        stagingOutputPaths: [stagingPath],
        committedOutputPaths: [
          join(workspacePath, `.beegame/reviews/foundation/${revision}/review.json`),
        ],
      } as const

      await port.start({
        dispatchId: 'dispatch-foundation-review',
        runId: 'run-foundation-review',
        ownerId: 'user-1',
        projectId: 'project-foundation-review',
        workspacePath,
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision,
        allowedPaths: [...assignment.stagingOutputPaths],
        contract: {
          reviewScope: 'foundation',
          reviewMode: 'initial',
          reviewRole: 'synthesis',
          assignment,
          confirmedBriefDigest,
          packetDigests: {},
        },
      })

      expect(
        await port.waitForTerminal!('dispatch-foundation-review'),
      ).toEqual({
        workerType: 'document-reviewer',
        status: 'completed',
        revision,
        mode: 'initial',
        role: 'synthesis',
        reportPath: `.beegame/reviews/foundation/${revision}/review.json`,
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})

async function createResourceWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'beegame-resource-terminal-'))
}

function resourcePlanManifest() {
  return {
    version: 8 as const,
    project_target: {
      asset_format_capabilities: ['dat', 'json'],
      resource_library_usage: 'optional' as const,
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [
      {
        id: 'world.visual',
        required: true,
        acquisition_profile: {
          dimensions: ['agnostic' as const],
          asset_kinds: ['data' as const],
          usage_tags: [],
          capabilities: [],
          styles: [],
        },
      },
    ],
    resources: [],
  }
}

async function runResourceTerminal(input: {
  workspacePath: string
  workerType:
    | 'resource-planner'
    | 'resource-curator'
    | 'resource-content-author'
  toolName:
    | 'AssetManifest'
    | 'CommitResourceInventory'
    | 'CommitResourceContent'
  toolInput: Record<string, unknown>
  contract?: Record<string, unknown>
  catalogObserved?: boolean
}) {
  const events = [
    ...(input.catalogObserved
      ? [
          {
            id: 'resource-catalog-tool',
            type: 'tool.completed' as const,
            text: '',
            createdAt: new Date(),
            payload: {
              toolUseID: 'resource-catalog-tool',
              toolName: 'ResourceLibrary',
              input: { action: 'match_requirements' },
              output: JSON.stringify({ groups: [] }),
            },
          },
        ]
      : []),
    {
      id: 'resource-terminal-tool',
      type: 'tool.completed' as const,
      text: '',
      createdAt: new Date(),
      payload: {
        toolUseID: 'resource-terminal-tool',
        toolName: input.toolName,
        input: input.toolInput,
      },
    },
    {
      id: 'resource-terminal-result',
      type: 'result' as const,
      text: 'completed',
      createdAt: new Date(),
    },
  ]
  const sessions = {
    start() {
      return { id: `session-${input.workerType}` }
    },
    events() {
      return events
    },
  } as unknown as BeeGameSessionManager
  const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
  await port.start({
    dispatchId: `dispatch-${input.workerType}`,
    runId: 'run-resource-terminal',
    ownerId: 'user-1',
    projectId: 'project-resource-terminal',
    workspacePath: input.workspacePath,
    workerType: input.workerType,
    phase: 'RESOURCE_PREPARATION',
    revision: 'revision-resource-terminal',
    contract: input.contract ?? {},
  })
  return port.waitForTerminal!(`dispatch-${input.workerType}`)
}
