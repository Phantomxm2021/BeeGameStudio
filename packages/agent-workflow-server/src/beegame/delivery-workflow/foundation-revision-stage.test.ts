import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { getGameDocumentContract } from './game-document-contracts'
import {
  createFoundationRevisionStage,
  deriveFoundationPatchOperations,
  revisionTaskReceiptTerminalDigest,
  type RevisionTaskReceipt,
} from './foundation-revision-stage'

const workspaces: string[] = []
afterEach(async () =>
  Promise.all(
    workspaces
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  ),
)

const documentPath = 'docs/GDD.md' as const
const revision = 'revision-test'

function canonicalDocument(): string {
  const contract = getGameDocumentContract(documentPath)
  return `# GDD\n\n${contract.sections.map(section => `<!-- beegame-section:${section.sectionId} -->\n## ${section.title}\n\n${section.sectionId === 'progression' ? '' : `original ${section.sectionId}`}\n`).join('\n')}`
}

async function workspaceWithCanonicalDocument() {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-revision-stage-'))
  workspaces.push(workspace)
  await mkdirFor(join(workspace, 'docs'))
  await writeFile(join(workspace, documentPath), canonicalDocument())
  return workspace
}

async function mkdirFor(path: string) {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(path, { recursive: true })
}

function receiptFor(
  input: Partial<RevisionTaskReceipt> &
    Pick<
      RevisionTaskReceipt,
      'baseDocumentDigest' | 'stagedDocumentDigest' | 'stagedPath'
    >,
): RevisionTaskReceipt {
  const receiptWithoutTerminal = {
    taskId: input.taskId ?? 'revision-task-1',
    round: input.round ?? 1,
    documentPath,
    issueIds: input.issueIds ?? ['AUD-1'],
    baseDocumentDigest: input.baseDocumentDigest,
    stagedDocumentDigest: input.stagedDocumentDigest,
    changedSectionIds: input.changedSectionIds ?? ['vision'],
    stagedPath: input.stagedPath,
  } satisfies Omit<RevisionTaskReceipt, 'terminalDigest'>
  return {
    ...receiptWithoutTerminal,
    terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal),
  }
}

test('creates an isolated project-local staged copy and leaves canonical bytes unchanged', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const canonical = await readFile(join(workspace, documentPath), 'utf8')
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })

  expect(stage.stagedPath).toBe(
    `.beegame/audit/foundation/${revision}/revision/${documentPath}`,
  )
  expect(await readFile(join(workspace, stage.stagedPath), 'utf8')).toBe(
    canonical,
  )
  expect(await readFile(join(workspace, documentPath), 'utf8')).toBe(canonical)
  expect(stage.baseDocumentDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(stage.stagedDocumentDigest).toBe(stage.baseDocumentDigest)
})

test('derives INSERT, REPLACE and DELETE section operations without content fields', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  let staged = await readFile(join(workspace, stage.stagedPath), 'utf8')
  staged = staged.replace('original vision', 'changed vision')
  staged = staged.replace('original core_loop', '')
  staged = staged.replace(
    '## Progression, Rewards and Economy Boundary\n\n\n',
    '## Progression, Rewards and Economy Boundary\n\ninserted progression\n',
  )
  await writeFile(join(workspace, stage.stagedPath), staged)
  const stagedDocumentDigest = stageDigest(staged)
  const base = receiptFor({
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest,
    stagedPath: stage.stagedPath,
    changedSectionIds: ['vision', 'core_loop', 'progression'],
  })

  const operations = await deriveFoundationPatchOperations({
    workspacePath: workspace,
    revision,
    batch: {
      documentPath,
      sectionIds: ['vision', 'core_loop', 'progression'],
      issueIds: ['AUD-1'],
    },
    receipt: base,
  })
  expect(operations.map(operation => operation.kind)).toEqual([
    'REPLACE',
    'DELETE',
    'INSERT',
  ])
  expect(operations.every(operation => !('content' in operation))).toBe(true)
  expect(operations.flatMap(operation => operation.issueIds)).toEqual(['AUD-1'])
})

test('rejects stale base, traversal paths, user-directory staging and unauthorized sections', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const staged = await readFile(join(workspace, stage.stagedPath), 'utf8')
  const valid = receiptFor({
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stage.stagedDocumentDigest,
    stagedPath: stage.stagedPath,
  })

  await writeFile(join(workspace, documentPath), `${staged} drift`)
  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: { documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
      receipt: valid,
    }),
  ).rejects.toThrow(/stale|base|digest/i)
  await writeFile(join(workspace, documentPath), staged)

  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: {
        documentPath,
        sectionIds: ['rules_systems'],
        issueIds: ['AUD-1'],
      },
      receipt: valid,
    }),
  ).rejects.toThrow(/section|changed/i)
  const { terminalDigest: _terminalDigest, ...traversalWithoutTerminal } = {
    ...valid,
    stagedPath: '../outside.md',
  }
  const traversal = {
    ...traversalWithoutTerminal,
    terminalDigest: revisionTaskReceiptTerminalDigest(traversalWithoutTerminal),
  }
  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: { documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
      receipt: traversal,
    }),
  ).rejects.toThrow(/path|staged/i)
})

test('rejects extra keys, duplicate IDs, marker destruction and whole-document drift', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const valid = receiptFor({
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stage.stagedDocumentDigest,
    stagedPath: stage.stagedPath,
  })
  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: {
        documentPath,
        sectionIds: ['vision'],
        issueIds: ['AUD-1', 'AUD-1'],
      },
      receipt: valid,
    }),
  ).rejects.toThrow(/duplicate|issue/i)
  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: { documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
      receipt: { ...valid, extra: true } as never,
    }),
  ).rejects.toThrow(/shape|key|receipt/i)
  await writeFile(
    join(workspace, stage.stagedPath),
    (await readFile(join(workspace, stage.stagedPath), 'utf8')).replace(
      '<!-- beegame-section:vision -->',
      '<!-- broken -->',
    ),
  )
  const broken = receiptFor({
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(
      await readFile(join(workspace, stage.stagedPath), 'utf8'),
    ),
    stagedPath: stage.stagedPath,
  })
  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: { documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
      receipt: broken,
    }),
  ).rejects.toThrow(/section|marker|contract/i)
})

function stageDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
