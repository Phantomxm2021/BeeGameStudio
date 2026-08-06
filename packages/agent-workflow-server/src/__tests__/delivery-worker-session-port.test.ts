import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import {
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
  type DocumentReviewCheckId,
} from '../beegame/delivery-workflow/types'
import {
  buildDocumentReviewReferenceIndex,
  buildDocumentReviewWireReferenceIndex,
} from '../beegame/delivery-workflow/document-review-input'
import { commitCanonicalDocument } from '../beegame/native-canonical-document-tool'
import { createNativeResourceContentTool } from '../beegame/native-resource-content-tool'
import {
  computeResourceInventoryRevision,
  computeResourceRevision,
} from '../beegame/delivery-workflow/revision'

function reviewerContract(
  atomicCheckId: DocumentReviewCheckId = 'cross_document_consistency',
  cycleId = 'cycle-review',
) {
  const reviewArtifacts = [
    {
      path: 'systemDeliveryContract',
      content: '{"roots":{"content":"assets/content"}}\n',
    },
    { path: 'docs/GDD.md', content: '# Rules\n' },
    { path: 'docs/TECHNICAL_DESIGN.md', content: '# Rules\n' },
  ]
  return {
    cycleId,
    reviewScope: 'foundation' as const,
    reviewMode: 'initial' as const,
    requiredCheckIds: [atomicCheckId],
    currentCheckIds: [atomicCheckId],
    reviewAuthority: {
      confirmedBriefContext: 'Confirmed brief',
      confirmedBriefDigest: 'service-owned-digest',
    },
    reviewArtifacts,
    referenceIndex: buildDocumentReviewWireReferenceIndex([
      { path: 'reviewAuthority', content: 'Confirmed brief' },
      ...reviewArtifacts,
    ]),
    criteriaByCheck: { [atomicCheckId]: [] },
    artifactPathsByCheck: {
      [atomicCheckId]: reviewArtifacts.map(artifact => artifact.path),
    },
  }
}

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

  test('accepts only the curator inventory receipt terminal contract', async () => {
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
      const terminal = await runResourceTerminal({
        workspacePath,
        workerType: 'resource-curator',
        catalogObserved: true,
        toolName: 'AssetManifest',
        toolInput: {
          action: 'complete_resource_inventory',
          bindings: [
            {
              requirement_id: 'world.visual',
              resource_ids: ['world-resource'],
            },
          ],
        },
      })

      expect(terminal).toMatchObject({
        revision: 'revision-resource-terminal',
        workerType: 'resource-curator',
        status: 'completed',
        catalogObserved: true,
        resourceIds: ['world-resource'],
        bindings: [
          {
            requirementId: 'world.visual',
            resourceIds: ['world-resource'],
          },
        ],
        taskMetrics: {
          catalogPayloadBytes: expect.any(Number),
          catalogCallTypes: ['list_packs'],
          canonicalMutationCount: 0,
        },
      })
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
        protectedPaths: [],
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
          preservedPaths: [],
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
        protectedPaths: [],
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
        documents: [
          {
            path: 'assets/content/resource-registry.json',
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
        ],
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
          preservedPaths: [],
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

  test('starts one read-only repair-planning worker boundary', async () => {
    const starts: Array<Record<string, unknown>> = []
    const sessions = {
      start(input: Record<string, unknown>) {
        starts.push(input)
        return { id: 'session-document-repair' }
      },
      updateAuthToken() {},
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    await port.start({
      dispatchId: 'dispatch-document-repair',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-1',
      allowedPaths: [],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'repair-planning',
        remediation: {
          findings: [{ findingId: 'F1' }, { findingId: 'F2' }],
        },
        repairPlanTask: {
          groups: [
            {
              findingIds: ['F1', 'F2'],
              subjectPaths: ['docs/GDD.md'],
              candidatePaths: ['docs/GDD.md'],
            },
          ],
        },
      },
    })

    expect(starts[0]).toMatchObject({
      workflowAllowedPaths: [],
      workflowDocumentAuthorMode: 'repair-planning',
      workflowDocumentRepairPlanContract: {
        groups: [
          {
            subjectPaths: ['docs/GDD.md'],
            candidatePaths: ['docs/GDD.md'],
          },
        ],
      },
    })
  })

  test('does not expose remediation tools during initial document authoring', async () => {
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
  })

  test('projects upstream authority and the controlled target baseline without file tools', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'initial-authority-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(join(workspacePath, 'docs/GDD.md'), 'gdd authority')
      await writeFile(
        join(workspacePath, 'docs/LEVEL_SCENE_DESIGN.md'),
        'level authority',
      )
      await writeFile(
        join(workspacePath, 'docs/BALANCE_DESIGN.md'),
        'stale target content',
      )
      const block = await buildDocumentAuthorAuthorityBlock({
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision-1',
        allowedPaths: ['docs/BALANCE_DESIGN.md'],
        contract: {
          authoringMode: 'initial',
          foundationDocumentPath: 'docs/BALANCE_DESIGN.md',
          upstreamDocumentPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
        },
      })
      expect(block).toContain('gdd authority')
      expect(block).toContain('level authority')
      expect(block).toContain('replacement baseline from an earlier run')
      expect(block).toContain('stale target content')
      expect(block).toContain('CommitCanonicalDocument')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('projects repair authority from the frozen dispatch contract instead of live files', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'repair-authority-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(
        join(workspacePath, 'docs/GDD.md'),
        '# Rules\n\nmutated live content',
      )
      const block = await buildDocumentAuthorAuthorityBlock({
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision-1',
        allowedPaths: [],
        contract: {
          authoringMode: 'repair-planning',
          systemDeliveryContract: {},
          repairPlanTask: {
            groups: [
              {
                subjectPaths: ['docs/GDD.md'],
                candidatePaths: ['docs/GDD.md'],
              },
            ],
            authorityReferences: [
              {
                path: 'docs/GDD.md',
                anchor: '# Rules',
                content: '# Rules\n\nfrozen reviewed content',
              },
            ],
          },
        },
      })

      expect(block).toContain('frozen reviewed content')
      expect(block).not.toContain('mutated live content')
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
      ).rejects.toThrow(
        'canonical document revision requires baseline metadata',
      )
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
    let reviewerStart: Record<string, unknown> | undefined
    const finding = {
      findingId: 'document-conflict',
      checkId: 'cross_document_consistency',
      severity: 'blocking',
      owner: 'foundation',
      evidence: [{ path: 'systemDeliveryContract', anchor: '/roots/content' }],
      subjects: [
        { path: 'docs/GDD.md', anchor: 'Rules' },
        { path: 'docs/TECHNICAL_DESIGN.md', anchor: 'Rules' },
      ],
      observation:
        'The label "Level 3" conflicts with `Level 4`.\nBoth are explicit.',
      blockingImpact: 'The implementation has no unique level rule.',
      requiredOutcome: 'Both documents define the same level rule.',
    }
    const references = buildDocumentReviewReferenceIndex([
      { path: 'reviewAuthority', content: 'Confirmed brief' },
      ...reviewerContract().reviewArtifacts,
    ]).references
    const systemReferenceId = references.find(
      reference => reference.anchor === '/roots/content',
    )!.referenceId
    const gddReferenceId = references.find(
      reference => reference.path === 'docs/GDD.md',
    )!.referenceId
    const findingInput = {
      findingId: finding.findingId,
      evidence: [{ referenceId: systemReferenceId }],
      subjects: [{ referenceId: gddReferenceId }],
      observation: finding.observation,
      blockingImpact: finding.blockingImpact,
      requiredOutcome: finding.requiredOutcome,
    }
    const sessions = {
      start(input: Record<string, unknown>) {
        reviewerStart = input
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
              toolName: 'SubmitDocumentReviewPacket',
              input: {
                checks: [
                  {
                    conclusion: 'The documents conflict.',
                    evidence: [
                      { referenceId: systemReferenceId },
                      { referenceId: gddReferenceId },
                    ],
                    assessments: [],
                    findings: [findingInput],
                  },
                ],
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
        contract: reviewerContract(),
      })
      await port.submit('dispatch-review', 'Review foundation documents')
      const terminal = await port.waitForTerminal?.('dispatch-review')
      expect(submittedPrompt).toContain(
        'SubmitDocumentReviewPacket exactly once',
      )
      expect(reviewerStart?.workflowDocumentReviewContract).toMatchObject({
        scope: 'foundation',
        mode: 'initial',
        requiredCheckIds: ['cross_document_consistency'],
      })
      expect(submittedPrompt).not.toContain('Terminal JSON contract')
      expect(terminal).toMatchObject({
        workerType: 'document-reviewer',
        revision: 'revision-1',
        verdict: 'NEEDS_REVISION',
        checklistIds: [],
        findings: [
          expect.objectContaining({
            findingId: finding.findingId,
            subjects: [{ path: 'docs/GDD.md', anchor: '# Rules' }],
          }),
        ],
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

  test('preserves the last rejected Reviewer packet contract error', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-review-rejection-'),
    )
    const sessions = {
      start() {
        return { id: 'session-reviewer-rejection' }
      },
      updateAuthToken() {},
      async sendWithDisplay() {},
      events() {
        return [
          {
            id: 'review-tool-rejected',
            type: 'tool.failed',
            text: 'SubmitDocumentReviewPacket failed',
            createdAt: new Date(),
            payload: {
              toolName: 'SubmitDocumentReviewPacket',
              input: { checks: [] },
              output: 'unknown document review referenceId: a3',
            },
          },
          {
            id: 'review-result',
            type: 'result',
            text: 'Unable to submit.',
            createdAt: new Date(),
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      await port.start({
        dispatchId: 'dispatch-review-rejection',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: 'revision-1',
        allowedPaths: [],
        contract: reviewerContract(),
      })
      await port.submit('dispatch-review-rejection', 'Review packet')
      await expect(
        port.waitForTerminal?.('dispatch-review-rejection'),
      ).rejects.toThrow('unknown document review referenceId: a3')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('reuses one frozen-revision reviewer execution session across serial packets', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-review-session-reuse-'),
    )
    const artifacts = reviewerContract().reviewArtifacts
    const systemReferenceId = buildDocumentReviewReferenceIndex([
      { path: 'reviewAuthority', content: 'Confirmed brief' },
      ...artifacts,
    ]).references.find(
      reference => reference.path === 'systemDeliveryContract',
    )!.referenceId
    const session = {
      id: 'review-session',
      status: 'running' as const,
      turnStatus: 'idle' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const events: ReturnType<BeeGameSessionManager['events']> = []
    const prompts: string[] = []
    let activeDispatchId = ''
    let startCount = 0
    let rebindCount = 0
    const rebindLifecycle: string[] = []
    const disposedSessionIds: string[] = []
    const sessions = {
      start(input: { workflowDispatchId: string }) {
        startCount += 1
        activeDispatchId = input.workflowDispatchId
        return session
      },
      get() {
        return session
      },
      rebindWorkflowReviewer(input: { dispatchId: string }) {
        rebindLifecycle.push('rebind')
        rebindCount += 1
        activeDispatchId = input.dispatchId
      },
      async flushWorkflowUsage() {
        rebindLifecycle.push('flush-usage')
      },
      updateAuthToken() {},
      stop() {},
      async disposeWorkflowWorker(sessionId: string) {
        disposedSessionIds.push(sessionId)
      },
      async sendWithDisplay(_sessionId: string, prompt: string) {
        prompts.push(prompt)
        events.push({
          id: `tool-${activeDispatchId}`,
          type: 'tool.completed',
          text: '',
          createdAt: new Date(),
          payload: {
            toolName: 'SubmitDocumentReviewPacket',
            input: {
              checks: [
                {
                  conclusion: 'The current authority is consistent.',
                  evidence: [{ referenceId: systemReferenceId }],
                  assessments: [],
                  findings: [],
                },
              ],
            },
          },
        } as never)
      },
      events() {
        return events
      },
      hasInFlightToolSubmission() {
        return false
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    const request = (
      dispatchId: string,
      currentCheck: 'cross_document_consistency' | 'technical_feasibility',
      cycleId = 'cycle-review',
    ): WorkerDispatchRequest => ({
      dispatchId,
      runId: 'run-review-session',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath,
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'frozen-revision-1',
      allowedPaths: [],
      contract: {
        ...reviewerContract(currentCheck, cycleId),
        requiredCheckIds: [
          'cross_document_consistency',
          'technical_feasibility',
        ],
      },
    })
    try {
      await port.start(request('review-packet-1', 'cross_document_consistency'))
      await port.submit('review-packet-1', 'full frozen projection')
      await port.waitForTerminal?.('review-packet-1')
      await port.close?.('review-packet-1')
      expect(disposedSessionIds).toEqual([])

      await port.start(request('review-packet-2', 'technical_feasibility'))
      expect(rebindLifecycle).toEqual(['flush-usage', 'rebind'])
      await port.submit('review-packet-2', 'must be replaced')
      await port.waitForTerminal?.('review-packet-2')

      await port.close?.('review-packet-2')
      expect(disposedSessionIds).toEqual(['review-session'])
      await port.start(
        request(
          'review-packet-new-cycle',
          'cross_document_consistency',
          'cycle-review-2',
        ),
      )
      await port.submit('review-packet-new-cycle', 'new frozen projection')
      await port.waitForTerminal?.('review-packet-new-cycle')

      expect(startCount).toBe(2)
      expect(rebindCount).toBe(1)
      expect(prompts).toHaveLength(3)
      expect(prompts[0]).toStartWith('full frozen projection')
      expect(prompts[1]).toContain(
        'Continue the same frozen-revision Reviewer execution session',
      )
      expect(prompts[1]).toContain('BEGIN REVIEW REFERENCE INDEX')
      expect(prompts[1]).toContain('BEGIN REVIEW ARTIFACT')
      expect(prompts[2]).toStartWith('new frozen projection')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('reconstructs every design check with the same assessments accepted by its active contract', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-design-review-result-'),
    )
    const contracts = Object.entries(
      GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
    ) as Array<
      [
        keyof typeof GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
        readonly [string, string, string],
      ]
    >
    const eventsBySession = new Map<
      string,
      ReturnType<BeeGameSessionManager['events']>
    >()
    const sessions = {
      start(input: { workflowDispatchId: string }) {
        return { id: input.workflowDispatchId }
      },
      updateAuthToken() {},
      async sendWithDisplay() {},
      events(sessionId: string) {
        return eventsBySession.get(sessionId) ?? []
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      for (const [atomicCheckId, criteria] of contracts) {
        const contract = reviewerContract(atomicCheckId)
        const references = buildDocumentReviewReferenceIndex([
          { path: 'reviewAuthority', content: 'Confirmed brief' },
          ...contract.reviewArtifacts,
        ]).references
        const evidenceReferenceId = references.find(
          reference => reference.path === 'docs/GDD.md',
        )!.referenceId
        const dispatchId = `dispatch-${atomicCheckId}`
        eventsBySession.set(dispatchId, [
          {
            id: `tool-${atomicCheckId}`,
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolName: 'SubmitDocumentReviewPacket',
              input: {
                checks: [
                  {
                    assessments: criteria.map(criterion => ({
                      criterion,
                      status: 'pass',
                      evidence: [{ referenceId: evidenceReferenceId }],
                      derivation:
                        'The cited design authority supports this criterion.',
                      conclusion: 'The criterion passes.',
                    })),
                    findings: [],
                  },
                ],
              },
            },
          },
        ] as unknown as ReturnType<BeeGameSessionManager['events']>)
        await port.start({
          dispatchId,
          runId: 'run-1',
          ownerId: 'user-1',
          projectId: 'project-1',
          workspacePath,
          workerType: 'document-reviewer',
          phase: 'DOCUMENT_REVIEW',
          revision: `revision-${atomicCheckId}`,
          allowedPaths: [],
          contract,
        })
        const terminal = await port.waitForTerminal?.(dispatchId)
        expect(terminal).toMatchObject({
          verdict: 'READY',
          checks: [{ id: atomicCheckId, assessments: expect.any(Array) }],
          findings: [],
        })
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('derives the document terminal from one durable canonical commit receipt', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-canonical-author-'),
    )
    const sessions = {
      start() {
        return { id: 'session-canonical-author' }
      },
      updateAuthToken() {},
      events() {
        return []
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
      await commitCanonicalDocument({
        workspacePath,
        contract: {
          dispatchId: 'dispatch-canonical-author',
          targetPath: 'docs/GDD.md',
          documentId: 'GDD',
          operation: 'create',
          baselineDigest: null,
        },
        body: '# Game Design\n\nCanonical rules.',
      })
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
      contract: reviewerContract(),
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
      payload: {
        toolUseID: string
        toolName: string
        input: Record<string, never>
      }
    }> = [
      {
        id: 'review-terminal-started',
        type: 'tool.started' as const,
        text: '',
        createdAt: new Date(),
        payload: {
          toolUseID: 'review-terminal',
          toolName: 'SubmitDocumentReviewPacket',
          input: {},
        },
      },
    ]
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
      contract: reviewerContract(),
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
        toolName: 'SubmitDocumentReviewPacket',
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
    requirements: [{ id: 'world.visual', required: true }],
    resources: [],
  }
}

async function runResourceTerminal(input: {
  workspacePath: string
  workerType:
    | 'resource-planner'
    | 'resource-curator'
    | 'resource-content-author'
  toolName: 'AssetManifest' | 'CommitResourceContent'
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
              input: { action: 'list_packs' },
              output: JSON.stringify({ items: [] }),
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
