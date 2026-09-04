import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import { createFoundationRevisionStage } from './delivery-workflow/foundation-revision-stage'
import {
  createFoundationRevisionMarkdownStreamSink,
  readFoundationRevisionCommitReceipt,
} from './foundation-revision-markdown-stream'

const documentPath = 'docs/GDD.md' as const
const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function canonicalDocument(): string {
  const contract = getGameDocumentContract(documentPath)
  return [
    '---',
    'document_id: GDD',
    'version: 1.0.0',
    'updated_at: 2026-08-13T01:00:00.000+08:00',
    '---',
    '# GDD',
    '',
    '<!-- beegame-executive-summary -->',
    '## Executive Summary',
    '',
    'original summary',
    '',
    ...contract.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      '',
      '### Repeated Heading',
      `original ${section.sectionId}`,
      '',
    ]),
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    '',
    ...contract.productionMaterials.flatMap(material => [
      `<!-- beegame-material:${material.materialId} -->`,
      `### ${material.title}`,
      '',
      `original ${material.materialId}`,
      '',
    ]),
  ].join('\n')
}

async function workspaceWithStage() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'revision-markdown-stream-'))
  workspaces.push(workspacePath)
  await mkdir(join(workspacePath, 'docs'), { recursive: true })
  await writeFile(join(workspacePath, documentPath), canonicalDocument(), 'utf8')
  const stage = await createFoundationRevisionStage({
    workspacePath,
    revision: 'revision-test',
    documentPath,
  })
  return { workspacePath, stage }
}

describe('foundation revision raw Markdown stream', () => {
  test('applies all authorized sections server-side and persists one receipt', async () => {
    const { workspacePath, stage } = await workspaceWithStage()
    const sink = await createFoundationRevisionMarkdownStreamSink({
      workspacePath,
      runId: 'run-1',
      dispatchId: 'dispatch-1',
      taskId: 'revision-task-1',
      revision: 'revision-test',
      round: 1,
      scope: 'section',
      documentPath,
      issueIds: ['AUD-1', 'AUD-2'],
      sectionIds: ['vision', 'core_loop'],
      stagedPath: stage.stagedPath,
      baseDocumentDigest: stage.baseDocumentDigest,
      maxBytes: 2 * 1024 * 1024,
    })
    const output = [
      '## Vision and Product Promise',
      '',
      '### Repeated Heading',
      'corrected vision',
      '',
      '## Core and Session Loops',
      '',
      '### Repeated Heading',
      `corrected core loop ${'detail '.repeat(20_000)}`,
    ].join('\n')
    sink.observe({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: output,
      uuid: 'result-1',
    })

    const receipt = await sink.commit()
    const staged = await readFile(join(workspacePath, stage.stagedPath), 'utf8')
    expect(receipt.changedSectionIds).toEqual(['vision', 'core_loop'])
    expect(staged).toContain('corrected vision')
    expect(staged).toContain('corrected core loop')
    expect(staged).toContain('original progression')
    expect(staged.match(/<!-- beegame-section:/g)?.length).toBe(
      getGameDocumentContract(documentPath).sections.length,
    )
    expect(await readFoundationRevisionCommitReceipt({ workspacePath, dispatchId: 'dispatch-1' })).toEqual(receipt)
  })

  test('rejects prose outside the authorized section response', async () => {
    const { workspacePath, stage } = await workspaceWithStage()
    const sink = await createFoundationRevisionMarkdownStreamSink({
      workspacePath,
      runId: 'run-2',
      dispatchId: 'dispatch-2',
      taskId: 'revision-task-2',
      revision: 'revision-test',
      round: 1,
      scope: 'section',
      documentPath,
      issueIds: ['AUD-1'],
      sectionIds: ['vision'],
      stagedPath: stage.stagedPath,
      baseDocumentDigest: stage.baseDocumentDigest,
      maxBytes: 2 * 1024 * 1024,
    })
    sink.observe({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Done.\n\n## Vision and Product Promise\n\ncorrected vision',
      uuid: 'result-2',
    })
    await expect(sink.commit()).rejects.toThrow('prose outside authorized sections')
  })
})
