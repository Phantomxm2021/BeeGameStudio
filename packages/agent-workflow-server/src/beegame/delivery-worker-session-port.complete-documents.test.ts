import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDocumentAuthorAuthorityBlock,
  createBeeGameDeliveryWorkerPort,
} from './delivery-worker-session-port'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import { parseWorkerTerminalResult } from './delivery-workflow/worker-contracts'
import type { FoundationDocumentPath, WorkerDispatchRequest } from './delivery-workflow/types'

function canonicalSource(
  path: 'docs/GDD.md' | 'docs/LEVEL_SCENE_DESIGN.md',
): string {
  const contract = getGameDocumentContract(path)
  return [
    `# ${contract.discipline}`,
    ...contract.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      `Authority content for ${section.sectionId}.`,
    ]),
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    'Unprojected production material payload.',
  ].join('\n')
}

async function writeAuthoritySource(
  workspacePath: string,
  path: FoundationDocumentPath,
): Promise<void> {
  const markdown = canonicalSource(
    path as 'docs/GDD.md' | 'docs/LEVEL_SCENE_DESIGN.md',
  )
  await writeFile(join(workspacePath, path), markdown)
}

describe('delivery worker complete document boundary', () => {
  test('turns native compiler structured output into an identity-bound terminal', async () => {
    const events = [{
      id: 1,
      sessionId: 'compiler-session',
      type: 'result' as const,
      text: '',
      createdAt: new Date(),
      payload: {
        structured_output: {
          status: 'completed',
          domainResults: [
            'gameplay',
            'balance',
            'world-scene',
            'presentation',
            'resource-realization',
            'implementation-verification',
          ].map(moduleId => ({
            moduleId,
            semantic: { outcome: 'PROJECTED', nodes: [], sourceClaims: [] },
          })),
        },
      },
    }]
    let started: WorkerDispatchRequest | undefined
    const sessions = {
      start: (request: WorkerDispatchRequest) => {
        started = request
        return { id: 'compiler-session' }
      },
      updateAuthToken: () => undefined,
      sendWithDisplay: async () => undefined,
      events: () => events,
      get: () => ({ status: 'running', turnStatus: 'completed', createdAt: new Date() }),
      waitForWorkflowWorkerIdle: async () => undefined,
      isWorkflowWorkerOpen: () => true,
    }
    const port = createBeeGameDeliveryWorkerPort({ sessions: sessions as never, userId: 'user' })
    await port.start({
      dispatchId: 'dispatch-compiler',
      runId: 'run-compiler',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      taskId: 'task-compiler',
      revision: 'revision-compiler',
      allowedPaths: [],
      projectReadScope: 'empty',
      contract: {
        compileRequestDigest: 'a'.repeat(64),
        foundationReadyReceiptDigest: 'b'.repeat(64),
        compileRequest: { taskId: 'task-compiler' },
        foundationReadyReceipt: { receiptDigest: 'b'.repeat(64) },
      },
    } as never)
    const terminal = await port.waitForTerminal!('dispatch-compiler')
    expect(started?.workflowJsonSchema).toBeDefined()
    expect(parseWorkerTerminalResult(terminal)).toMatchObject({
      workerType: 'game-ir-compiler',
      runId: 'run-compiler',
      dispatchId: 'dispatch-compiler',
      taskId: 'task-compiler',
      revision: 'revision-compiler',
      compileRequestDigest: 'a'.repeat(64),
      foundationReadyReceiptDigest: 'b'.repeat(64),
    })
    const forgedPort = createBeeGameDeliveryWorkerPort({ sessions: sessions as never, userId: 'user' })
    await forgedPort.start({
      dispatchId: 'dispatch-forged-compiler',
      runId: 'run-compiler',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      taskId: 'task-compiler',
      revision: 'revision-compiler',
      allowedPaths: [],
      projectReadScope: 'empty',
      contract: { foundationReadyReceiptDigest: 'b'.repeat(64) },
    } as never)
    await expect(forgedPort.waitForTerminal!('dispatch-forged-compiler')).rejects.toThrow(/identity/i)
  })

  test('submits the dispatch-built revision projection instead of rebuilding from the start request', async () => {
    const prompts: string[] = []
    const sessions = {
      start: () => ({ id: 'revision-session' }),
      updateAuthToken: () => undefined,
      sendWithDisplay: async (_sessionId: string, prompt: string) => {
        prompts.push(prompt)
      },
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    await port.start({
      dispatchId: 'revision-dispatch',
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'foundation-document-reviser',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        workerType: 'foundation-document-reviser',
        stagedPath: 'docs/GDD.md',
      },
    })
    await port.submit('revision-dispatch', 'DISPATCH_BUILT_REVISION_PROJECTION')
    expect(prompts).toEqual(['DISPATCH_BUILT_REVISION_PROJECTION'])
  })

  test('persists only the exact selected upstream authority as complete input', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'focused-authority-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeAuthoritySource(workspacePath, 'docs/GDD.md')
      await writeAuthoritySource(workspacePath, 'docs/LEVEL_SCENE_DESIGN.md')
      await writeFile(
        join(workspacePath, 'docs/UI_UX_SPEC.md'),
        '# Stale target\n\nSTALE TARGET BODY',
      )
      const block = await buildDocumentAuthorAuthorityBlock({
        dispatchId: 'dispatch-ui-authority',
        runId: 'run-ui-authority',
        workerType: 'document-author',
        workspacePath,
        allowedPaths: ['docs/UI_UX_SPEC.md'],
        contract: {
          authoringMode: 'initial',
          documentSet: 'foundation',
          foundationDocumentPath: 'docs/UI_UX_SPEC.md',
          availableUpstreamPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
        },
      } as never)
      expect(block).not.toContain(
        'Write the complete assigned Markdown document directly',
      )
      expect(block).toContain('complete selected upstream authority')
      expect(block).toContain('BEGIN FOUNDATION AUTHORITY')
      expect(block).not.toContain('complete when the turn ends')
      expect(block).not.toContain('file-operation sequence')
      expect(block).not.toContain('completeDocumentContract')
      expect(block).not.toContain('CommitCanonicalDocument')
      expect(block).not.toContain('document_parts_prepared')
      expect(block).not.toContain('write or edit the assigned path directly')
      expect(block).toContain(
        '.beegame/workflow/document-projections/dispatch-ui-authority.json',
      )
      const projected = JSON.parse(
        await readFile(
          join(
            workspacePath,
            '.beegame/workflow/document-projections/dispatch-ui-authority.json',
          ),
          'utf8',
        ),
      )
      expect(projected.targetPath).toBe('docs/UI_UX_SPEC.md')
      expect(projected.sources.length).toBeGreaterThan(0)
      expect(
        projected.sources.every((source: {
          sections?: Array<{
            sectionId?: unknown
            startLine?: unknown
            lineCount?: unknown
            content?: unknown
            digest?: unknown
          }>
        }) =>
          source.sections?.every(
            section =>
              typeof section.sectionId === 'string' &&
              Number.isInteger(section.startLine) &&
              Number(section.startLine) > 0 &&
              Number.isInteger(section.lineCount) &&
              Number(section.lineCount) > 0 &&
              typeof section.content === 'string' &&
              section.content.includes(
                `Authority content for ${String(section.sectionId)}.`,
              ) &&
              typeof section.digest === 'string' &&
              /^[a-f0-9]{64}$/.test(section.digest),
          ),
        ),
      ).toBe(true)
      expect(projected.sources[0]).not.toHaveProperty('sectionIds')
      expect(projected).not.toHaveProperty('records')
      expect(projected.sources[0].sections[0]).not.toHaveProperty('contentLines')
      expect(block).toContain('Authority content for')
      expect(block).not.toContain('"startLine"')
      expect(block).not.toContain('"lineCount"')
      expect(block).not.toContain('"digest"')
      expect(block).not.toContain('Confirmed authority for')
      expect(block).not.toContain('Unprojected production material payload.')
      expect(block).not.toContain('STALE TARGET BODY')
      expect(block).not.toContain('remaining bounded checkpoint sequence')
      expect(block).not.toContain('do not perform a separate target read')
      expect(block).not.toContain('Follow that sequence')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
