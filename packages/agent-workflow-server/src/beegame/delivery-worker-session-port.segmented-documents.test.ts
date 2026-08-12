import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBeeGameDeliveryWorkerPort } from './delivery-worker-session-port'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  foundationDocumentDraftPartCount,
  foundationDocumentDraftGroups,
  inspectFoundationDocumentDraft,
} from './foundation-document-draft'

function materialBody(format: string): string {
  if (format === 'mermaid') return '```mermaid\nflowchart LR\nA --> B\n```'
  if (format === 'inline_svg') return '<svg><rect width="10" height="10" /></svg>'
  return '| Field | Value |\n| --- | --- |\n| Owner | Production |'
}

async function advanceDraft(
  workspacePath: string,
  groupIndex: number,
  partIndex: number,
) {
  const path = 'docs/GDD.md'
  const contract = getGameDocumentContract(path)
  const groups = foundationDocumentDraftGroups(path)
  const group = groups[groupIndex]!
  const target = join(workspacePath, path)
  if (groupIndex === 0 && partIndex === 0) {
    const section = group.sections[0]!
    await writeFile(
      target,
      [
        '# Game Design Document',
        '',
        '<!-- beegame-executive-summary -->',
        '## Executive Summary',
        'Production-ready game authority for implementation and acceptance.',
        '',
        `<!-- beegame-section:${section.sectionId} -->`,
        `## ${section.title}`,
        `<!-- beegame-part:${section.sectionId}:1 -->`,
        `Production authority for ${section.sectionId}, chunk one.`,
        '',
        '<!-- beegame-draft-cursor:0:1 -->',
        '',
      ].join('\n'),
    )
    return
  }
  const current = await readFile(target, 'utf8')
  const cursor = `<!-- beegame-draft-cursor:${groupIndex}:${partIndex} -->`
  let replacement: string
  if (groupIndex === groups.length - 1) {
    const material = contract.productionMaterials[partIndex]!
    replacement = [
      ...(partIndex === 0
        ? ['<!-- beegame-production-materials -->', '## Production Materials', '']
        : []),
      `<!-- beegame-material:${material.materialId} -->`,
      `### ${material.title}`,
      materialBody(material.format),
      '',
      ...(partIndex + 1 < contract.productionMaterials.length
        ? [`<!-- beegame-draft-cursor:${groupIndex}:${partIndex + 1} -->`]
        : []),
    ].join('\n')
  } else {
    const section = group.sections[0]!
    replacement =
      partIndex === 0
        ? [
            `<!-- beegame-section:${section.sectionId} -->`,
            `## ${section.title}`,
            `<!-- beegame-part:${section.sectionId}:1 -->`,
            `Production authority for ${section.sectionId}, chunk one.`,
            '',
            `<!-- beegame-draft-cursor:${groupIndex}:1 -->`,
          ].join('\n')
        : [
            `<!-- beegame-part:${section.sectionId}:2 -->`,
            `Production authority for ${section.sectionId}, chunk two.`,
            '',
            `<!-- beegame-draft-cursor:${groupIndex + 1}:0 -->`,
          ].join('\n')
  }
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
          for (let checkpoint = 0; checkpoint < 2; checkpoint += 1) {
            let markdown: string | undefined
            try {
              markdown = await readFile(join(workspacePath, 'docs/GDD.md'), 'utf8')
            } catch {}
            const progress = inspectFoundationDocumentDraft('docs/GDD.md', markdown)
            if (progress.complete) break
            const group = foundationDocumentDraftGroups('docs/GDD.md')[
              progress.completedGroupCount
            ]!
            if (group.sections.length) {
              for (
                let partIndex = progress.completedPartCount;
                partIndex < foundationDocumentDraftPartCount(group);
                partIndex += 1
              )
                await advanceDraft(
                  workspacePath,
                  progress.completedGroupCount,
                  partIndex,
                )
            } else {
              await advanceDraft(
                workspacePath,
                progress.completedGroupCount,
                progress.completedPartCount,
              )
            }
          }
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

      expect(prompts.length).toBe(
        Math.ceil(
          (getGameDocumentContract('docs/GDD.md').sections.length +
            getGameDocumentContract('docs/GDD.md').productionMaterials.length) /
            2,
        ),
      )
      expect(prompts[0]).toContain('Active bounded document group 1/13')
      expect(prompts[0]).toContain('perform up to two sequential bounded native mutations')
      expect(prompts[0]).toContain('Checkpoint 1/2: perform one bounded native Write')
      expect(prompts[0]).toContain('Checkpoint 2/2: perform one bounded native Edit')
      expect(prompts[0]).toContain('<!-- beegame-part:vision:1 -->')
      expect(prompts[0]).toContain('<!-- beegame-part:vision:2 -->')
      expect(prompts[0]).toContain('<!-- beegame-draft-cursor:1:0 -->')
      expect(prompts[0]).toContain('<!-- beegame-draft-cursor:2:0 -->')
      expect(prompts[0]).toContain('5,200 UTF-8 bytes')
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
