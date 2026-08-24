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

function canonicalDocument(): string {
  const contract = getGameDocumentContract(documentPath)
  return `# GDD\n\n${contract.sections.map(section => `<!-- beegame-section:${section.sectionId} -->\n## ${section.title}\n\noriginal ${section.sectionId}\n`).join('\n')}`
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

function createTool(workspacePath: string, onReceipt?: (receipt: RevisionTaskReceipt) => void) {
  return createNativeFoundationRevisionResultTool({
    buildTool: definition => definition,
    workspacePath,
    expectedRevision: revision,
    expectedRound: 1,
    expectedTaskId: taskId,
    expectedDocumentPath: documentPath,
    expectedIssueIds: issueIds,
    expectedSectionIds: changedSectionIds,
    onReceipt,
  }) as Tool
}

const declaration = {
  changedSectionIds: [...changedSectionIds],
} as const

test('accepts only the bounded declaration and derives the full receipt from local bytes', async () => {
  const { workspace, stage, staged } = await workspaceWithStage()
  let received: RevisionTaskReceipt | undefined
  const tool = createTool(workspace, receipt => {
    received = receipt
  })

  expect(tool.inputSchema.safeParse(declaration).success).toBe(true)
  await expect(tool.call(declaration)).resolves.toMatchObject({
    data: { accepted: true, changedSectionCount: 1, issueCount: 1, receipt: expect.any(Object) },
  })
  const canonical = await readFile(join(workspace, documentPath))
  const expectedWithoutTerminal = {
    taskId,
    round: 1 as const,
    documentPath,
    issueIds: [...issueIds],
    baseDocumentDigest: createHash('sha256').update(canonical).digest('hex'),
    stagedDocumentDigest: createHash('sha256').update(staged).digest('hex'),
    changedSectionIds: [...declaration.changedSectionIds],
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
  await expect(tool.call(declaration)).resolves.toMatchObject({ data: { accepted: true, changedSectionCount: 1 } })
})

test('rejects caller-supplied path and digest evidence before it can enter the receipt', async () => {
  const { workspace } = await workspaceWithStage()
  let received = false
  const tool = createTool(workspace, () => {
    received = true
  })
  const fabricated = { ...declaration, stagedPath: '../outside.md', baseDocumentDigest: 'a'.repeat(64), stagedDocumentDigest: 'b'.repeat(64), terminalDigest: 'c'.repeat(64) }

  expect(tool.inputSchema.safeParse(fabricated).success).toBe(false)
  await expect(tool.call(fabricated)).rejects.toThrow()
  expect(received).toBe(false)
})

test('rejects stale identity, missing stage, and empty stage bytes', async () => {
  const { workspace, stage } = await workspaceWithStage()
  const tool = createTool(workspace)
  await expect(tool.call({ ...declaration, changedSectionIds: ['rules_systems'] })).rejects.toThrow(/section/i)

  await rm(join(workspace, stage.stagedPath))
  await expect(tool.call(declaration)).rejects.toThrow(/read|stage|file/i)

  await writeFile(join(workspace, stage.stagedPath), '')
  await expect(tool.call(declaration)).rejects.toThrow(/empty/i)
})
