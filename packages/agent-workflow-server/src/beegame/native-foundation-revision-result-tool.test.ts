import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeFoundationRevisionResultTool } from './native-foundation-revision-result-tool'
import {
  createFoundationRevisionStage,
  revisionTaskReceiptTerminalDigest,
  type RevisionTaskReceipt,
} from './delivery-workflow/foundation-revision-stage'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import { createFileStateCacheWithSizeLimit } from '../../../../src/utils/fileStateCache.js'

type Tool = {
  call(input: unknown): Promise<{ data: Record<string, unknown> }>
  prompt(): Promise<string>
  inputSchema: { safeParse(input: unknown): { success: boolean } }
}

const workspaces: string[] = []
const documentPath = 'docs/GDD.md' as const
const revision = 'revision-test'
const taskId = 'revision-task-1'
const issueIds = ['AUD-1'] as const
const changedSectionIds = ['vision'] as const

afterEach(async () =>
  Promise.all(
    workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })),
  ),
)

function canonicalDocumentBody(): string {
  const contract = getGameDocumentContract(documentPath)
  const sections = contract.sections
    .map(
      section =>
        `<!-- beegame-section:${section.sectionId} -->\n## ${section.title}\n\noriginal ${section.sectionId}\n`,
    )
    .join('\n')
  const materials = contract.productionMaterials
    .map(
      material =>
        `<!-- beegame-material:${material.materialId} -->\n### ${material.title}\n\nmaterial ${material.materialId}\n`,
    )
    .join('\n')
  return `# GDD\n\n<!-- beegame-executive-summary -->\n## Executive Summary\n\nsummary authority\n\n${sections}<!-- beegame-production-materials -->\n## Production Materials\n\n${materials}<!-- beegame-audit-appendix -->\n## Audit Appendix\n\naudit metadata\n`
}

function canonicalDocument(
  version = '1.0.0',
  updatedAt = '2026-08-13T01:00:00.000+08:00',
): string {
  return `---\ndocument_id: GDD\nversion: ${version}\nupdated_at: ${updatedAt}\n---\n${canonicalDocumentBody()}`
}

async function workspaceWithStage() {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-native-revision-'))
  workspaces.push(workspace)
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(join(workspace, documentPath), canonicalDocument())
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const staged = (await readFile(join(workspace, stage.stagedPath), 'utf8')).replace(
    'original vision',
    'changed vision',
  )
  await writeFile(join(workspace, stage.stagedPath), staged)
  return { workspace, stage, staged }
}

function createTool(
  workspacePath: string,
  onReceipt?: (receipt: RevisionTaskReceipt) => void,
  expectedSectionIds: readonly string[] = changedSectionIds,
) {
  return createNativeFoundationRevisionResultTool({
    buildTool: definition => definition,
    workspacePath,
    expectedRevision: revision,
    expectedRound: 1,
    expectedTaskId: taskId,
    expectedDocumentPath: documentPath,
    expectedIssueIds: issueIds,
    expectedSectionIds,
    onReceipt,
  }) as Tool
}

const declaration = { status: 'APPLIED' } as const

test('derives the exact changed sections from canonical and final staged bytes', async () => {
  const { workspace, stage } = await workspaceWithStage()
  let received: RevisionTaskReceipt | undefined
  const tool = createTool(workspace, receipt => {
    received = receipt
  })

  expect(tool.inputSchema.safeParse(declaration).success).toBe(true)
  await expect(tool.call(declaration)).resolves.toMatchObject({
    data: { status: 'APPLIED', receipt: expect.any(Object) },
  })
  const finalStaged = await readFile(join(workspace, stage.stagedPath))
  const canonical = await readFile(join(workspace, documentPath))
  const expectedWithoutTerminal = {
    taskId,
    round: 1 as const,
    documentPath,
    issueIds: [...issueIds],
    baseDocumentDigest: createHash('sha256').update(canonical).digest('hex'),
    stagedDocumentDigest: createHash('sha256').update(finalStaged).digest('hex'),
    changedSectionIds: [...changedSectionIds],
    stagedPath: stage.stagedPath,
  }
  expect(received).toEqual({
    ...expectedWithoutTerminal,
    terminalDigest: revisionTaskReceiptTerminalDigest(expectedWithoutTerminal),
  })
  await expect(tool.prompt()).resolves.toEqual(expect.stringContaining('local'))
})

test('chains real Read and Edit on the isolated stage before native submission', async () => {
  const { workspace, stage } = await workspaceWithStage()
  const filePath = join(workspace, stage.stagedPath)
  const toolContext = {
    abortController: new AbortController(),
    readFileState: createFileStateCacheWithSizeLimit(8),
    fileReadingLimits: undefined,
    dynamicSkillDirTriggers: new Set<string>(),
    nestedMemoryAttachmentTriggers: new Set<string>(),
  } as any
  const parentMessage = { uuid: 'revision-real-read-edit', message: { id: 'revision-real-read-edit' } } as any
  const rootTools = await import(new URL('../../../../src/tools.ts', import.meta.url).href)
  const tools = rootTools.getAllBaseTools()
  const fileRead = (tools as any[]).find((tool: any) => tool.name === 'Read')!
  const fileEdit = (tools as any[]).find((tool: any) => tool.name === 'Edit')!
  await fileRead.call({ file_path: filePath }, toolContext, undefined, parentMessage)
  await fileEdit.call({ file_path: filePath, old_string: 'changed vision', new_string: 'revised vision' }, toolContext, undefined, parentMessage)
  expect(await readFile(filePath, 'utf8')).toContain('revised vision')
  const tool = createTool(workspace)
  await expect(tool.call(declaration)).resolves.toMatchObject({ data: { status: 'APPLIED' } })
})

test('rejects caller-supplied path and digest evidence before it can enter the receipt', async () => {
  const { workspace } = await workspaceWithStage()
  let received = false
  const tool = createTool(workspace, () => {
    received = true
  })
  const fabricated = { status: 'APPLIED', changedSectionIds: ['vision'] }

  expect(tool.inputSchema.safeParse(fabricated).success).toBe(false)
  await expect(tool.call(fabricated)).rejects.toThrow()
  expect(received).toBe(false)
})

test('rejects model-supplied changed sections', async () => {
  const { workspace } = await workspaceWithStage()
  const tool = createTool(workspace)
  expect(tool.inputSchema.safeParse({ status: 'APPLIED', changedSectionIds: ['vision'] }).success).toBe(false)
  await expect(tool.call({ status: 'APPLIED', changedSectionIds: ['vision'] })).rejects.toThrow()
})

test('rejects missing and empty stages', async () => {
  const { workspace, stage } = await workspaceWithStage()
  const tool = createTool(workspace)

  await rm(join(workspace, stage.stagedPath))
  await expect(tool.call(declaration)).rejects.toThrow(/read|stage|file/i)

  await writeFile(join(workspace, stage.stagedPath), '')
  await expect(tool.call(declaration)).rejects.toThrow(/empty/i)
})

test('accepts five changed sections under six-section authority and receipts exactly five', async () => {
  const { workspace, stage } = await workspaceWithStage()
  const authority = getGameDocumentContract(documentPath).sections.map(
    section => section.sectionId,
  ).slice(0, 6)
  expect(authority).toHaveLength(6)
  const changed = authority.slice(0, 5)
  let received: RevisionTaskReceipt | undefined
  const tool = createNativeFoundationRevisionResultTool({
    buildTool: definition => definition,
    workspacePath: workspace,
    expectedRevision: revision,
    expectedRound: 1,
    expectedTaskId: taskId,
    expectedDocumentPath: documentPath,
    expectedIssueIds: issueIds,
    expectedSectionIds: authority,
    onReceipt: receipt => {
      received = receipt
    },
  }) as Tool
  let revised = canonicalDocument()
  for (const sectionId of changed)
    revised = revised.replace(`original ${sectionId}`, `revised ${sectionId}`)
  await writeFile(join(workspace, stage.stagedPath), revised)

  await expect(tool.call(declaration)).resolves.toMatchObject({
    data: { status: 'APPLIED' },
  })
  expect(received?.changedSectionIds).toEqual(changed)
})

test('fails closed when the staged document has no changed section', async () => {
  const authority = getGameDocumentContract(documentPath).sections.map(
    section => section.sectionId,
  )
  const { workspace, stage } = await workspaceWithStage()
  await writeFile(
    join(workspace, stage.stagedPath),
    await readFile(join(workspace, documentPath)),
  )
  const tool = createTool(workspace, undefined, authority)
  await expect(tool.call(declaration)).rejects.toThrow(/change|section/i)
})

test('fails closed when a changed section exceeds packet authority', async () => {
  const { workspace, stage } = await workspaceWithStage()
  const tool = createTool(workspace, undefined, ['vision'])
  const stagedPath = join(workspace, stage.stagedPath)
  await writeFile(
    stagedPath,
    (await readFile(stagedPath, 'utf8')).replace(
      'original rules_systems',
      'revised rules_systems',
    ),
  )
  await expect(tool.call(declaration)).rejects.toThrow(/outside|authority/i)
})

test('fails closed when a section marker changes', async () => {
  const { workspace, stage } = await workspaceWithStage()
  const tool = createTool(workspace, undefined, [
    ...getGameDocumentContract(documentPath).sections.map(
      section => section.sectionId,
    ),
  ])
  const stagedPath = join(workspace, stage.stagedPath)
  await writeFile(
    stagedPath,
    (await readFile(stagedPath, 'utf8')).replace(
      '<!-- beegame-section:vision -->',
      '<!-- broken -->',
    ),
  )
  await expect(tool.call(declaration)).rejects.toThrow(/section|marker|contract/i)
})

test('fails closed when section marker order changes', async () => {
  const { workspace, stage } = await workspaceWithStage()
  const tool = createTool(workspace, undefined, [
    ...getGameDocumentContract(documentPath).sections.map(
      section => section.sectionId,
    ),
  ])
  const stagedPath = join(workspace, stage.stagedPath)
  const staged = await readFile(stagedPath, 'utf8')
  await writeFile(
    stagedPath,
    staged
      .replace('<!-- beegame-section:vision -->', '<!-- beegame-section:swap -->')
      .replace('<!-- beegame-section:core_loop -->', '<!-- beegame-section:vision -->')
      .replace('<!-- beegame-section:swap -->', '<!-- beegame-section:core_loop -->'),
  )
  await expect(tool.call(declaration)).rejects.toThrow(/section|marker|contract/i)
})

test('commits service-owned metadata once and keeps replay idempotent', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-native-revision-metadata-'))
  workspaces.push(workspace)
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(join(workspace, documentPath), canonicalDocument())
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const stageAbsolute = join(workspace, stage.stagedPath)
  await writeFile(
    stageAbsolute,
    (await readFile(stageAbsolute, 'utf8')).replace('original vision', 'changed vision'),
  )
  const tool = createTool(workspace)

  await expect(tool.call(declaration)).resolves.toMatchObject({ data: { status: 'APPLIED' } })
  const first = await readFile(stageAbsolute, 'utf8')
  expect(first).toContain('version: 1.0.1')
  expect(first).toContain('updated_at: 2026-08-12T17:00:00.001Z')

  await expect(tool.call(declaration)).resolves.toMatchObject({ data: { status: 'APPLIED' } })
  await expect(readFile(stageAbsolute, 'utf8')).resolves.toBe(first)
})

test('fails closed for worker-tampered service metadata', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-native-revision-metadata-invalid-'))
  workspaces.push(workspace)
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(join(workspace, documentPath), canonicalDocument())
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const stageAbsolute = join(workspace, stage.stagedPath)
  await writeFile(
    stageAbsolute,
    (await readFile(stageAbsolute, 'utf8'))
      .replace('original vision', 'changed vision')
      .replace('version: 1.0.0', 'version: 9.0.0'),
  )
  await expect(createTool(workspace).call(declaration)).rejects.toThrow(/metadata|version/i)

  await writeFile(
    stageAbsolute,
    (await readFile(stageAbsolute, 'utf8'))
      .replace('version: 9.0.0', 'version: 1.0.1')
      .replace('updated_at: 2026-08-13T01:00:00.000+08:00', 'updated_at: 2099-01-01T00:00:00.000Z'),
  )
  await expect(createTool(workspace).call(declaration)).rejects.toThrow(/metadata|updated_at/i)
})
