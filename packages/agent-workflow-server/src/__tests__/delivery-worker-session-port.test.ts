import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDocumentAuthorAuthorityBlock,
  createBeeGameDeliveryWorkerPort,
  completedProjectMutationPaths,
} from '../beegame/delivery-worker-session-port'
import {
  registerBeeGameAuthoredResources,
  writeBeeGameAssetManifest,
} from '../beegame/asset-contracts'
import type { BeeGameSessionManager, BeeGameEvent } from '../beegame/session-manager'

test('project delivery changes exclude native memory and scratch, not project files', () => {
  const paths = ['src/main.ts', 'docs/GDD.md', '../.runtime/app/projects/project/memory/feedback.md',
    '.beegame/tmp/session/inspection.png', 'assets/runtime/player.png']
  const events = paths.flatMap((path, index): BeeGameEvent[] => [
    { id: index * 2, sessionId: 'test', text: 'Write', createdAt: new Date(), type: 'tool.started', payload: { type: 'tool.started', toolName: 'Write', toolUseID: String(index), input: { file_path: path } } },
    { id: index * 2 + 1, sessionId: 'test', text: 'Write', createdAt: new Date(), type: 'tool.completed', payload: { type: 'tool.completed', toolName: 'Write', toolUseID: String(index) } },
  ])
  expect(completedProjectMutationPaths('/project', events)).toEqual(['src/main.ts', 'docs/GDD.md', 'assets/runtime/player.png'])
})

test('delivery stages borrow the project conversation instead of starting or closing a worker session', async () => {
  let started = 0, stopped = 0, interrupted = 0, sentSession = ''
  const projectSession = { id: 'project-chat', status: 'running', turnStatus: 'idle', createdAt: new Date() }
  const sessions = {
    projectConversationSessionId() { return projectSession.id },
    get(id: string) { return id === projectSession.id ? projectSession : undefined },
    start() { started++; throw new Error('must not create a phase session') },
    updateAuthToken() {}, stop() { stopped++ }, interruptTurn() { interrupted++; return projectSession },
    async sendWithDisplay(id: string) { sentSession = id },
    events() { return [] }, async waitForSessionIdle() {},
  } as unknown as BeeGameSessionManager
  const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'owner' })
  const request: WorkerDispatchRequest = { dispatchId: 'stage-1', runId: 'run-1', ownerId: 'owner',
    projectId: 'project-1', workspacePath: '/tmp/project-1', workerType: 'question-answerer',
    phase: 'DOCUMENT_DRAFTING', revision: 'rev-1', contract: {} }
  await port.start(request)
  await port.submit('stage-1', 'continue this same conversation')
  expect(sentSession).toBe('project-chat')
  expect(started).toBe(0)
  await port.stop('stage-1', 'stop this stage only')
  expect(interrupted).toBe(1)
  expect(stopped).toBe(0)
  await port.close?.('stage-1')
  expect(stopped).toBe(0)
})

test('an idle project conversation is not mistaken for a finished turn before submit', async () => {
  const events: BeeGameEvent[] = []
  const projectSession = { id: 'project-chat', status: 'running', turnStatus: 'idle', createdAt: new Date() }
  const sessions = {
    projectConversationSessionId() { return projectSession.id },
    get() { return projectSession },
    updateAuthToken() {},
    events() { return [...events] },
    async waitForSessionIdle() {},
    async sendWithDisplay() {
      projectSession.turnStatus = 'running'
      events.push({ id: 1, sessionId: projectSession.id, type: 'turn.started', text: 'started', createdAt: new Date(),
        payload: { type: 'turn.started', workflowDispatchId: 'stage-2' } })
      events.push({ id: 2, sessionId: projectSession.id, type: 'turn.failed', text: 'fixture failure after accepted turn', createdAt: new Date(),
        payload: { type: 'turn.failed', workflowDispatchId: 'stage-2' } })
      projectSession.turnStatus = 'idle'
    },
  } as unknown as BeeGameSessionManager
  const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'owner' })
  await port.start({ dispatchId: 'stage-2', runId: 'run-1', ownerId: 'owner',
    projectId: 'project-1', workspacePath: '/tmp/project-1', workerType: 'resource-planner',
    phase: 'RESOURCE_PREPARATION', revision: 'rev-1', contract: {} })
  let settled = false
  const terminal = port.waitForTerminal!('stage-2').then(() => {
    settled = true
    return new Error('unexpected success')
  }, (error: Error) => {
    settled = true
    return error
  })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(settled).toBe(false)
  await port.submit('stage-2', 'prepare resources')
  expect((await terminal).message).toBe('fixture failure after accepted turn')
  await port.close?.('stage-2')
})

test('a submitted project turn without a terminal result still needs action', async () => {
  const events: BeeGameEvent[] = []
  const projectSession = { id: 'project-chat', status: 'running', turnStatus: 'idle', createdAt: new Date() }
  const sessions = {
    projectConversationSessionId() { return projectSession.id },
    get() { return projectSession },
    updateAuthToken() {},
    events() { return [...events] },
    async waitForSessionIdle() {},
    async sendWithDisplay() {
      events.push({ id: 1, sessionId: projectSession.id, type: 'turn.started', text: 'started', createdAt: new Date(),
        payload: { type: 'turn.started', workflowDispatchId: 'stage-3' } })
    },
  } as unknown as BeeGameSessionManager
  const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'owner' })
  await port.start({ dispatchId: 'stage-3', runId: 'run-1', ownerId: 'owner',
    projectId: 'project-1', workspacePath: '/tmp/project-1', workerType: 'resource-planner',
    phase: 'RESOURCE_PREPARATION', revision: 'rev-1', contract: {} })
  await port.submit('stage-3', 'prepare resources')
  await expect(port.waitForTerminal!('stage-3')).rejects.toThrow('Project conversation turn ended without a terminal result')
  await port.close?.('stage-3')
})

test('a late event from the previous phase cannot terminate the next phase', async () => {
  const events: BeeGameEvent[] = []
  const projectSession = { id: 'project-chat', status: 'running', turnStatus: 'idle', createdAt: new Date() }
  const sessions = {
    projectConversationSessionId() { return projectSession.id },
    get() { return projectSession },
    updateAuthToken() {},
    events() { return [...events] },
    async waitForSessionIdle() {},
    async sendWithDisplay() {
      projectSession.turnStatus = 'running'
      events.push({ id: 2, sessionId: projectSession.id, turnId: 'resource-turn', type: 'turn.started',
        text: 'resource turn', createdAt: new Date(),
        payload: { type: 'turn.started', workflowDispatchId: 'resource-stage' } })
      events.push({ id: 3, sessionId: projectSession.id, turnId: 'resource-turn', type: 'result',
        text: 'Resource work completed', createdAt: new Date(),
        payload: { type: 'result', workflowDispatchId: 'resource-stage' } })
      projectSession.turnStatus = 'idle'
    },
  } as unknown as BeeGameSessionManager
  const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'owner' })
  await port.start({ dispatchId: 'resource-stage', runId: 'run-1', ownerId: 'owner',
    projectId: 'project-1', workspacePath: '/tmp/project-1', workerType: 'resource-planner',
    phase: 'RESOURCE_PREPARATION', revision: 'rev-1', contract: {} })
  // The previous phase's delayed event arrives after the new dispatch starts.
  events.push({ id: 1, sessionId: projectSession.id, turnId: 'review-turn', type: 'turn.started',
    text: 'review turn', createdAt: new Date(),
    payload: { type: 'turn.started', workflowDispatchId: 'review-stage' } })
  let settled = false
  const terminal = port.waitForTerminal!('resource-stage').then(value => {
    settled = true
    return value
  })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(settled).toBe(false)
  await port.submit('resource-stage', 'prepare resources')
  expect(await terminal).toMatchObject({ workerType: 'resource-planner', status: 'completed' })
  await port.close?.('resource-stage')
})
import type { WorkerDispatchRequest } from '../beegame/delivery-workflow/types'
import { buildWorkerPrompt } from '../beegame/delivery-workflow/worker-prompts'
import { type ChecklistAuthority } from '../beegame/checklist-authority-projection'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../beegame/foundation-documents'

describe('delivery worker session credentials', () => {
  test('a follow-up cannot start a delivery worker or open its capabilities', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-follow-up-capabilities-'))
    let prompt = '', closed = 0
    const starts: Record<string, unknown>[] = []
    const sessions = { start(input: Record<string, unknown>) { starts.push(input); return { id: 'follow-up' } },
      updateAuthToken() {}, stop() {}, async sendWithDisplay(_id: string, text: string) { prompt = text },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'owner',
      confirmedBriefContext: JSON.stringify({ kind: 'confirmed_build_brief', idea: 'Large original game specification' }),
      openImageAccess: () => ({ instruction: 'Image API remains available', close() { closed++ } }),
      openPreviewAccess: () => ({ instruction: 'Preview API remains available', async close() { closed++ } }),
    })
    const request: WorkerDispatchRequest = { dispatchId: 'follow-up', runId: 'run', ownerId: 'owner',
      projectId: 'project', workspacePath, workerType: 'implementation-worker', phase: 'DELIVERY',
      taskId: 'PROJECT_CHANGE', revision: 'revision', allowedPaths: ['./'],
      contract: { purpose: 'project-change', changeRequest: 'Fix the pause button' } }
    try {
      await expect(port.start(request)).rejects.toThrow('native project conversation')
      expect(prompt).toBe('')
      expect(starts).toHaveLength(0)
      expect(closed).toBe(0)
    } finally { await port.stop(request.dispatchId!, 'cleanup'); await rm(workspacePath, { recursive: true, force: true }) }
  })
  for (const workerType of ['resource-planner', 'implementation-worker'] as const)
  test(`${workerType} receives resource repair capabilities and stop revokes them`, async () => {
    let prompt = ''
    let imageAccessClosed = 0
    let previewAccessClosed = 0
    const stopCalls: unknown[][] = []
    const sessions = {
      start() { return { id: 'resource-access-worker' } }, updateAuthToken() {},
      async sendWithDisplay(_id: string, text: string) { prompt = text },
      stop(...args: unknown[]) { stopCalls.push(args) },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({
      sessions, userId: 'user-1', resourceLibraryBaseUrl: 'https://library.test',
      getAuthToken: () => 'private-user-token',
      openPreviewAccess(context) {
        expect(context.workspacePath).toBe('/tmp/resource-access')
        expect(context.sessionId).toBe('resource-access-worker')
        return { instruction: 'Owned Preview test capability', async close() { previewAccessClosed++ } }
      },
      openImageAccess(projectId) {
        expect(projectId).toBe('project-1')
        return { instruction: 'Native image command available', close() { imageAccessClosed++ } }
      },
    })
    const request = { dispatchId: 'resource-access', runId: 'run', ownerId: 'user-1', projectId: 'project-1',
      workspacePath: '/tmp/resource-access', workerType, phase: workerType === 'resource-planner' ? 'RESOURCE_PREPARATION' : 'IMPLEMENTATION',
      revision: 'revision-1', allowedPaths: ['assets/'], contract: {} } as WorkerDispatchRequest
    await port.start(request)
    try {
      await port.submit('resource-access', buildWorkerPrompt(request))
      if (workerType === 'resource-planner') {
      expect(prompt).toContain('licensed internet assets')
      expect(prompt).toContain('do not repeat searches solely to justify reusing a verified asset')
      expect(prompt).toContain('verified provenance and license facts')
      expect(prompt).not.toContain('Move to the next source only')
      expect(prompt).toContain('not a mandatory search ladder')
      expect(prompt).not.toContain('Required sourcing priority')
      expect(prompt).toContain("user's explicit source constraints")
      expect(prompt).not.toContain('Before submission record')
      expect(prompt).toContain('no fixed search count or tool sequence')
      } else {
        expect(prompt).toContain('Owned Preview test capability')
        expect(prompt).toContain('.beegame/implementation-issues.md')
        expect(prompt).not.toContain('finish the game logic first')
        expect(prompt).toContain('choose investigation and repair order yourself')
        expect(prompt).toContain('source-asset defects belong to targeted resource repair')
        expect(prompt).not.toContain('Content and Manifest may be corrected')
        expect(prompt).toContain('uiPaintOrder(nodes, rootId)')
        expect(prompt).toContain('DOM textContent')
      }
      expect(prompt).toContain('GET /api/resource-packs/{packId}/elements/{elementId}/resource-url')
      expect(prompt).not.toContain('private-user-token')
      expect(prompt).toContain('Native image command available')
      const base = prompt.match(/Base URL: (\S+)/)![1]!
      expect((await fetch(base + '/api/admin')).status).toBe(405)
      await port.stop('resource-access', 'user stopped')
      expect(stopCalls).toEqual([['resource-access-worker', 'user stopped']])
      expect(imageAccessClosed).toBe(1)
      expect(previewAccessClosed).toBe(workerType === 'implementation-worker' ? 1 : 0)
      await expect(fetch(base + '/api/admin')).rejects.toThrow()
    } finally { await port.stop('resource-access', 'test cleanup') }
  })
  test('implementation sees the actual project Preview and its sandbox capabilities', async () => {
    let actualPrompt = ''
    const sessions = {
      start() { return { id: 'preview-worker' } }, updateAuthToken() {},
      async sendWithDisplay(_id: string, prompt: string) { actualPrompt = prompt },
      events() { return [] },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1',
      confirmedBriefContext: JSON.stringify({ kind: 'confirmed_build_brief',
        idea: 'Only one scene and UI; no complete game.',
        selected_option: { title: 'Small scene' }, settings: { engine: 'react' },
        confirmed_gdd: 'Already available in accepted documents' }),
      getPreviewContext: () => ({ status: 'running', sessionId: 'project-preview', url: 'http://localhost/previews/project-preview/' }) })
    await port.start({ dispatchId: 'preview-dispatch', runId: 'run', ownerId: 'user-1', projectId: 'project-1',
      workspacePath: '/tmp/preview-contract', workerType: 'implementation-worker', phase: 'IMPLEMENTATION',
      revision: 'revision-1', allowedPaths: ['./'], contract: {} })
    await port.submit('preview-dispatch', 'Fix the reported error')
    expect(actualPrompt).toContain('http://localhost/previews/project-preview/')
    expect(actualPrompt).toContain('sandboxed-iframe')
    expect(actualPrompt).toContain('localStorage/sessionStorage access can throw')
    expect(actualPrompt).toContain('"projectId":"project-1"')
    expect(actualPrompt).not.toContain('allow-same-origin')
    expect(actualPrompt).toContain('Only one scene and UI; no complete game.')
    expect(actualPrompt).toContain('Confirmed user scope')
    expect(actualPrompt).toContain('Small scene')
    expect(actualPrompt).toContain('"engine":"react"')
    expect(actualPrompt).not.toContain('Already available in accepted documents')
  })
  for (const outcome of ['result', 'turn.failed'] as const) {
    test(`uses post-drain ${outcome}, not the earlier waiting message`, async () => {
      const events: BeeGameEvent[] = []
      const push = (type: BeeGameEvent['type'], text: string, payload?: BeeGameEvent['payload']) =>
        events.push({ id: events.length, sessionId: 'drain-session', type, text, createdAt: new Date(), payload })
      const sessions = {
        start() { return { id: 'drain-session' } }, updateAuthToken() {},
        async sendWithDisplay() { push('result', '等待复核结果中。') },
        events() { return [...events] },
        async waitForWorkflowWorkerIdle() {
          push('tool.started', 'Write', { type: 'tool.started', toolUseID: 'write-1', toolName: 'Write', input: { file_path: '/tmp/drain-project/src/final.ts' } })
          push('tool.completed', 'Write completed', { type: 'tool.completed', toolUseID: 'write-1', toolName: 'Write' })
          push(outcome, outcome === 'result' ? 'Final parent report' : 'Native process exited during review')
        },
      } as unknown as BeeGameSessionManager
      const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
      await port.start({ dispatchId: 'drain-dispatch', runId: 'run-1', ownerId: 'user-1', projectId: 'project-1',
        workspacePath: '/tmp/drain-project', workerType: 'implementation-worker', phase: 'IMPLEMENTATION',
        taskId: 'DIRECT_IMPLEMENTATION', revision: 'revision-1', allowedPaths: ['./'], contract: {} })
      await port.submit('drain-dispatch', 'Implement')
      if (outcome === 'turn.failed')
        await expect(port.waitForTerminal?.('drain-dispatch')).rejects.toThrow('Native process exited during review')
      else
        expect(await port.waitForTerminal?.('drain-dispatch')).toMatchObject({
          summary: 'Final parent report', changedPaths: ['src/final.ts'], verifiedArtifacts: [], verificationResults: [],
        })
    })
  }

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
        catalogObserved: false,
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
        '.beegame/delivery/evidence/implementation-dispatch-implementation.json',
      ],
      evidencePath:
        '.beegame/delivery/evidence/implementation-dispatch-implementation.json',
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

  test('acceptance requires a saved runtime report rather than a synthetic final verdict', async () => {
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
        'Acceptance Agent did not save its runtime result',
      )
      await mkdir(join(workspacePath, '.beegame/delivery/evidence'), { recursive: true })
      await writeFile(join(workspacePath, 'game.js'), 'tested build')
      await writeFile(join(workspacePath, 'observed.txt'), 'actual browser observations')
      await writeFile(join(workspacePath, '.beegame/delivery/evidence/runtime-dispatch-acceptance.json'), JSON.stringify({
        scope: 'delivery', status: 'passed', summary: 'Verified the game', environment: 'Web Preview',
        verification: { target: 'deployment', knownIssues: [], unverified: [] },
        evidencePaths: ['observed.txt'], artifactPaths: ['game.js'],
      }))
      const terminal = await port.waitForTerminal?.('dispatch-acceptance')
      expect(terminal).toMatchObject({ workerType: 'acceptance-validator', status: 'completed' })
      const saved = JSON.parse(await readFile(join(workspacePath,
        (terminal as { evidencePath: string }).evidencePath), 'utf8'))
      expect(saved.runtimeAcceptance.status).toBe('passed')
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
