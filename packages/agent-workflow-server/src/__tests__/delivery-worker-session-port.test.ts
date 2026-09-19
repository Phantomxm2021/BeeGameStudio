import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
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
import { buildWorkerPrompt } from '../beegame/delivery-workflow/worker-prompts'
import { type ChecklistAuthority } from '../beegame/checklist-authority-projection'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../beegame/foundation-documents'

describe('delivery worker session credentials', () => {
  test('malformed resource artifacts reach stage acceptance instead of throwing a transport failure', async () => {
    const workspacePath = await createResourceWorkspace()
    try {
      await mkdir(join(workspacePath, 'assets'), { recursive: true })
      await writeFile(join(workspacePath, 'assets/asset-manifest.json'), '{invalid')
      const terminal = await runResourceTerminal({ workspacePath, workerType: 'resource-planner',
        toolName: 'Write', toolInput: { file_path: join(workspacePath, 'assets/asset-manifest.json') } })
      expect(terminal).toMatchObject({ workerType: 'resource-planner', status: 'completed' })
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })
  test('passes only the accepted checklist snapshot to the document author', async () => {
    const input = checklistAuthorityFixture()
    const request = {
      dispatchId: 'dispatch-checklist',
      runId: 'run-checklist',
      ownerId: 'owner-1',
      projectId: 'project-1',
      // This path does not exist on purpose. The authority block must not read it.
      workspacePath: '/tmp/missing-checklist-workspace',
      workerType: 'document-author' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      revision: input.foundationRevision,
      allowedPaths: [
        '.beegame/workflow/checklist-candidates/dispatch-checklist.md',
      ],
      contract: {
        documentSet: 'checklist',
        checklistCandidatePath:
          '.beegame/workflow/checklist-candidates/dispatch-checklist.md',
        checklistCanonicalPath: 'docs/acceptance/gameplay-checklist.md',
        checklistAuthority: input,
      },
    }
    const block = await buildDocumentAuthorAuthorityBlock(request)
    expect(block).toContain('# 中文玩法愿景')
    expect(block).toContain('# 日本語シーン設計')
    expect(block).not.toContain('Game IR')
    expect(block).not.toContain('acceptance-scenario')
  })

  test('fails clearly when the checklist authority snapshot is absent', async () => {
    await expect(
      buildDocumentAuthorAuthorityBlock({
        runId: 'run-checklist',
        ownerId: 'owner-1',
        projectId: 'project-1',
        workspacePath: '/tmp/missing-checklist-workspace',
        workerType: 'document-author',
        phase: 'DOCUMENT_REVIEW',
        revision: 'revision-1',
        allowedPaths: ['candidate.md'],
        contract: {
          documentSet: 'checklist',
          checklistCandidatePath: 'candidate.md',
          checklistCanonicalPath: 'docs/acceptance/gameplay-checklist.md',
        },
      }),
    ).rejects.toThrow('checklist authority snapshot is missing')
  })

  test('accepts a directly written canonical planner resource plan', async () => {
    const workspacePath = await createResourceWorkspace()
    try {
      await writeBeeGameAssetManifest(workspacePath, resourcePlanManifest())
      const terminal = await runResourceTerminal({
        workspacePath,
        workerType: 'resource-planner',
        toolName: 'Write',
        toolInput: { file_path: join(workspacePath, 'assets/asset-manifest.json') },
      })

      expect(terminal).toEqual({
        revision: 'revision-resource-terminal',
        workerType: 'resource-planner',
        status: 'completed',
        writtenPaths: ['assets/asset-manifest.json'],
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('derives implementation terminal after normal agent completion', async () => {
    let submittedPrompt = ''
    let idleWaits = 0
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
            id: 'event-2',
            type: 'result',
            text: 'Implementation complete.',
            createdAt: new Date(),
            payload: { result: 'Implementation complete.' },
          },
        ]
      },
      async waitForWorkflowWorkerIdle() {
        idleWaits += 1
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
      confirmedBriefContext: 'GLOBAL ACCEPTANCE MUST RUN BROWSER',
    })
    await port.start({
      dispatchId: 'dispatch-implementation',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'implementation-worker',
      phase: 'IMPLEMENTATION',
      taskId: 'DIRECT_IMPLEMENTATION',
      revision: 'revision-1',
      allowedPaths: ['src/render/Scene.tsx'],
      contract: {
        task: { id: 'DIRECT_IMPLEMENTATION', contentIds: [] },
      },
    })
    await port.submit('dispatch-implementation', 'Implement the scene')

    expect(submittedPrompt).not.toContain('SubmitImplementationResult')
    expect(submittedPrompt).not.toContain('GLOBAL ACCEPTANCE MUST RUN BROWSER')
    expect(submittedPrompt).toContain(
      "Bee Game Studio's native tools, reasoning, permissions, context management, and normal completion behavior remain unchanged",
    )
    expect(await port.waitForTerminal?.('dispatch-implementation')).toEqual({
      workerType: 'implementation-worker',
      taskId: 'DIRECT_IMPLEMENTATION',
      revision: 'revision-1',
      status: 'completed',
      changedPaths: [],
      verifiedArtifacts: [],
      summary: 'Implementation complete.',
      verificationResults: [],
      evidenceRefs: [
        '.beegame/workflow/evidence/implementation-dispatch-implementation.json',
      ],
      evidencePath:
        '.beegame/workflow/evidence/implementation-dispatch-implementation.json',
    })
    expect(idleWaits).toBe(1)
  })

  test('forwards an explicit native resume ID without treating it as a transcript ID', async () => {
    let startInput: Record<string, unknown> | undefined
    const sessions = {
      start(input: Record<string, unknown>) {
        startInput = input
        return { id: 'session-resumed-implementation' }
      },
      updateAuthToken() {},
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    await port.start({
      dispatchId: 'dispatch-resume', runId: 'run-1', ownerId: 'user-1',
      projectId: 'project-1', workspacePath: '/tmp/project-1',
      workerType: 'implementation-worker', phase: 'IMPLEMENTATION',
      taskId: 'DIRECT_IMPLEMENTATION', revision: 'revision-1',
      allowedPaths: ['./'],
      contract: {
        task: { id: 'DIRECT_IMPLEMENTATION' },
        resumeWorkerSessionId: '15d7e597-c26a-4319-a2b0-63e8e00d5ac6',
      },
    })
    expect(startInput?.resumeNativeSessionId).toBe(
      '15d7e597-c26a-4319-a2b0-63e8e00d5ac6',
    )
    expect(startInput?.transcriptSessionId).toBeUndefined()
  })

  test('rejects the retired acceptance-validator worker instead of parsing a synthetic verdict', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-acceptance-'))
    const sessions = {
      start() {
        return { id: 'session-acceptance' }
      },
      updateAuthToken() {},
      async sendWithDisplay() {},
      events() {
        return [
          {
            id: 'acceptance-result',
            type: 'result',
            text: 'A historical acceptance worker finished.',
            createdAt: new Date(),
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      await port.start({
        dispatchId: 'dispatch-acceptance',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'acceptance-validator',
        phase: 'ACCEPTANCE',
        revision: 'revision-1',
        allowedPaths: [],
        contract: {
          taskIds: ['DIRECT_IMPLEMENTATION'],
          checklistIds: ['AC-1'],
          contentIds: ['scene.main'],
          resourceIds: ['asset.background'],
        },
      })
      await port.submit('dispatch-acceptance', 'Run acceptance')
      await expect(port.waitForTerminal?.('dispatch-acceptance')).rejects.toThrow(
        'retired delivery worker: acceptance-validator',
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('parses change impact from the normal CLI final response', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-change-impact-'))
    let submittedPrompt = ''
    const sessions = {
      start() { return { id: 'session-change-impact' } },
      updateAuthToken() {},
      async sendWithDisplay(_sessionId: string, prompt: string) {
        submittedPrompt = prompt
      },
      events() {
        return [{
          id: 'change-impact-result',
          type: 'result',
          text: [
            'CLASSIFICATION: implementation_only',
            'AFFECTED_REQUIREMENTS: REQ-2, REQ-4',
            'AFFECTED_CHECKLIST: NONE',
            'RATIONALE: Existing requirements remain valid; implementation changes are sufficient.',
          ].join('\n'),
          createdAt: new Date(),
        }]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      await port.start({
        dispatchId: 'dispatch-change-impact', runId: 'run-1', ownerId: 'user-1',
        projectId: 'project-1', workspacePath, workerType: 'change-impact-analyzer',
        phase: 'BRIEF_CONFIRMED', revision: 'revision-1', allowedPaths: [],
        contract: { message: 'Change the implementation', currentRevision: {} },
      })
      await port.submit('dispatch-change-impact', 'Analyze the change')

      expect(submittedPrompt).not.toContain('SubmitChangeImpactResult')
      expect(await port.waitForTerminal?.('dispatch-change-impact')).toMatchObject({
        workerType: 'change-impact-analyzer',
        classification: 'implementation_only',
        affectedRequirementIds: ['REQ-2', 'REQ-4'],
        affectedChecklistIds: [],
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('uses the normal CLI final response as the question answer', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-question-answer-'))
    let submittedPrompt = ''
    const sessions = {
      start() { return { id: 'session-question-answer' } },
      updateAuthToken() {},
      async sendWithDisplay(_sessionId: string, prompt: string) {
        submittedPrompt = prompt
      },
      events() {
        return [{
          id: 'question-answer-result',
          type: 'result',
          text: 'The scene uses the published forest environment resource.',
          createdAt: new Date(),
        }]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      await port.start({
        dispatchId: 'dispatch-question-answer', runId: 'run-1', ownerId: 'user-1',
        projectId: 'project-1', workspacePath, workerType: 'question-answerer',
        phase: 'BRIEF_CONFIRMED', revision: 'revision-1', allowedPaths: [],
        contract: { message: 'Which environment is used?', currentRevision: {} },
      })
      await port.submit('dispatch-question-answer', 'Answer the question')

      expect(submittedPrompt).not.toContain('SubmitQuestionAnswerResult')
      expect(await port.waitForTerminal?.('dispatch-question-answer')).toMatchObject({
        workerType: 'question-answerer',
        answer: 'The scene uses the published forest environment resource.',
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
      workerType: 'question-answerer',
      phase: 'BRIEF_CONFIRMED',
      revision: 'revision-1',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/GDD.md',
        availableUpstreamPaths: [],
      },
    }

    await port.start(request)
    authToken = 'reviewer-token'
    await port.submit('dispatch-1', 'Review the documents')
    authToken = 'next-phase-token'
    await port.start({
      ...request,
      dispatchId: 'dispatch-2',
      workerType: 'question-answerer',
      phase: 'BRIEF_CONFIRMED',
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

})

async function createResourceWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'beegame-resource-terminal-'))
}

function checklistAuthorityFixture(): ChecklistAuthority {
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) => {
    const content =
      index === 0
        ? '# 中文玩法愿景\n玩家收集光点并完成关卡。'
        : index === 1
          ? '# 日本語シーン設計\nプレイヤーは森を探索する。'
          : `# 文档 ${index + 1}\n自然语言正文。`
    return {
      path,
      content,
      digest: createHash('sha256').update(content, 'utf8').digest('hex'),
    }
  })
  const documentSetDigest = createHash('sha256')
    .update(
      JSON.stringify(
        documents.map(document => [document.path, document.digest]),
      ),
      'utf8',
    )
    .digest('hex')
  return {
    foundationRevision: documentSetDigest,
    documentSetDigest,
    documents,
  }
}

function resourcePlanManifest() {
  return {
    version: 9 as const,
    project_target: {
      asset_format_capabilities: ['dat', 'json'],
      resource_library_usage: 'optional' as const,
      runtime_asset_root: 'assets/runtime',
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
  workerType: 'resource-planner'
  toolName: 'Write'
  toolInput: Record<string, unknown>
  contract?: Record<string, unknown>
}) {
  const events = [
    {
      id: 'resource-terminal-tool-started',
      type: 'tool.started' as const,
      text: '',
      createdAt: new Date(),
      payload: { toolUseID: 'resource-terminal-tool', toolName: input.toolName, input: input.toolInput },
    },
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
