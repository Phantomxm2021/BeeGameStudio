import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBeeGameDeliveryWorkerPort } from './delivery-worker-session-port'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  foundationDocumentDraftGroups,
  inspectFoundationDocumentDraft,
} from './foundation-document-draft'

function materialBody(format: string): string {
  if (format === 'mermaid') return '```mermaid\nflowchart LR\nA --> B\n```'
  if (format === 'inline_svg') return '<svg><rect width="10" height="10" /></svg>'
  return '| Field | Value |\n| --- | --- |\n| Owner | Production |'
}

async function advanceDraft(workspacePath: string, turnIndex: number) {
  const path = 'docs/GDD.md'
  const contract = getGameDocumentContract(path)
  const groups = foundationDocumentDraftGroups(path)
  const group = groups[turnIndex]!
  const target = join(workspacePath, path)
  if (turnIndex === 0) {
    await writeFile(
      target,
      [
        '# Game Design Document',
        '',
        '<!-- beegame-executive-summary -->',
        '## Executive Summary',
        'Production-ready game authority for implementation and acceptance.',
        '',
        ...group.sections.flatMap(section => [
          `<!-- beegame-section:${section.sectionId} -->`,
          `## ${section.title}`,
          `Production authority for ${section.sectionId}.`,
          '',
        ]),
        '<!-- beegame-draft-cursor:1 -->',
        '',
      ].join('\n'),
    )
    return
  }
  const current = await readFile(target, 'utf8')
  const cursor = `<!-- beegame-draft-cursor:${turnIndex} -->`
  const replacement =
    turnIndex === groups.length - 1
      ? [
          '<!-- beegame-production-materials -->',
          '## Production Materials',
          '',
          ...contract.productionMaterials.flatMap(material => [
            `<!-- beegame-material:${material.materialId} -->`,
            `### ${material.title}`,
            materialBody(material.format),
            '',
          ]),
        ].join('\n')
      : [
          ...group.sections.flatMap(section => [
            `<!-- beegame-section:${section.sectionId} -->`,
            `## ${section.title}`,
            `Production authority for ${section.sectionId}.`,
            '',
          ]),
          `<!-- beegame-draft-cursor:${turnIndex + 1} -->`,
        ].join('\n')
  await writeFile(target, current.replace(cursor, replacement))
}

describe('segmented initial document authoring', () => {
  test('continues bounded groups in one native session before terminal completion', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'segmented-document-'))
    const events: Array<Record<string, unknown>> = []
    const prompts: string[] = []
    const session = {
      id: 'session-one',
      status: 'running',
      turnStatus: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
      cwd: workspacePath,
    }
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const sessions = {
        start: () => session,
        updateAuthToken: () => undefined,
        get: () => session,
        events: () => events,
        isWorkflowWorkerOpen: () => true,
        waitForWorkflowWorkerIdle: async () => undefined,
        sendWithDisplay: async (_sessionId: string, prompt: string) => {
          prompts.push(prompt)
          const groupMatch = /Active bounded document group (\d+)\//.exec(prompt)
          await advanceDraft(workspacePath, groupMatch ? Number(groupMatch[1]) - 1 : 0)
          events.push({ type: 'result', text: 'turn complete' })
          return session
        },
        stop: () => session,
        disposeWorkflowWorker: async () => undefined,
      }
      const port = createBeeGameDeliveryWorkerPort({
        sessions: sessions as never,
        userId: 'user',
      })
      const request = {
        dispatchId: 'dispatch-segmented',
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision',
        allowedPaths: ['docs/GDD.md'],
        contract: {
          authoringMode: 'initial',
          documentSet: 'foundation',
          foundationDocumentPath: 'docs/GDD.md',
          upstreamDocumentPaths: [],
          completeDocumentContract: getGameDocumentContract('docs/GDD.md'),
        },
      } as const

      await port.start(request as never)
      await port.submit('dispatch-segmented', 'original complete document prompt')
      const terminal = await port.waitForTerminal?.('dispatch-segmented')

      expect(prompts.length).toBe(foundationDocumentDraftGroups('docs/GDD.md').length)
      expect(prompts[0]).toContain('Active bounded document group 1/5')
      expect(prompts.every(prompt => !prompt.includes('original complete document prompt'))).toBe(true)
      expect(terminal).toMatchObject({
        status: 'completed',
        writtenPaths: ['docs/GDD.md'],
      })
      expect(
        inspectFoundationDocumentDraft(
          'docs/GDD.md',
          await readFile(join(workspacePath, 'docs/GDD.md'), 'utf8'),
        ).complete,
      ).toBe(true)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
