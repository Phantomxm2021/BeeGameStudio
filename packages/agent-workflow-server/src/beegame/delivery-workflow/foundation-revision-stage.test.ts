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
import type { AuditIssue } from './foundation-issue-registry'

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
    issueIds: ['AUD-1', 'AUD-DELETE', 'AUD-INSERT'],
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
      issueIds: ['AUD-1', 'AUD-DELETE', 'AUD-INSERT'],
    },
    issues: [
      admittedIssue('AUD-1', 'vision'),
      admittedIssue('AUD-DELETE', 'core_loop'),
      admittedIssue('AUD-INSERT', 'progression'),
    ],
    receipt: base,
  })
  expect(operations.map(operation => operation.kind)).toEqual([
    'REPLACE',
    'DELETE',
    'INSERT',
  ])
  expect(operations.every(operation => !('content' in operation))).toBe(true)
  expect(operations.flatMap(operation => operation.issueIds)).toEqual([
    'AUD-1',
    'AUD-DELETE',
    'AUD-INSERT',
  ])
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
      issues: [admittedIssue('AUD-1', 'vision')],
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
      issues: [admittedIssue('AUD-1', 'rules_systems')],
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
      issues: [admittedIssue('AUD-1', 'vision')],
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
      issues: [admittedIssue('AUD-1', 'vision')],
      receipt: valid,
    }),
  ).rejects.toThrow(/duplicate|issue/i)
  await expect(
    deriveFoundationPatchOperations({
      workspacePath: workspace,
      revision,
      batch: { documentPath, sectionIds: ['vision'], issueIds: ['AUD-1'] },
      issues: [admittedIssue('AUD-1', 'vision')],
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
      issues: [admittedIssue('AUD-1', 'vision')],
      receipt: broken,
    }),
  ).rejects.toThrow(/section|marker|contract/i)
})

function admittedIssue(id: string, fixSectionId: string): AuditIssue {
  return {
    id,
    severity: 'HIGH',
    type: 'rule',
    source: {
      documentPath,
      sectionId: fixSectionId,
      heading: fixSectionId,
      startLine: 1,
      endLine: 1,
      digest: 'a'.repeat(64),
    },
    expected: 'expected',
    actual: 'actual',
    fixDocument: documentPath,
    fixSectionId,
  }
}

async function deriveWithIssues(input: Record<string, unknown>) {
  return deriveFoundationPatchOperations(input as never)
}

test('binds distinct section operations to admitted fix targets regardless issue array order', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const staged = (await readFile(join(workspace, stage.stagedPath), 'utf8'))
    .replace('original vision', 'revised vision')
    .replace('original core_loop', 'revised core loop')
  await writeFile(join(workspace, stage.stagedPath), staged)
  const receipt = receiptFor({
    issueIds: ['AUD-CORE', 'AUD-VISION'],
    changedSectionIds: ['vision', 'core_loop'],
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(staged),
    stagedPath: stage.stagedPath,
  })
  const operations = await deriveWithIssues({
    workspacePath: workspace,
    revision,
    batch: {
      documentPath,
      sectionIds: ['vision', 'core_loop'],
      issueIds: ['AUD-CORE', 'AUD-VISION'],
    },
    issues: [
      admittedIssue('AUD-VISION', 'vision'),
      admittedIssue('AUD-CORE', 'core_loop'),
    ],
    receipt,
  })
  expect(operations).toEqual([
    expect.objectContaining({ sectionId: 'vision', issueIds: ['AUD-VISION'] }),
    expect.objectContaining({ sectionId: 'core_loop', issueIds: ['AUD-CORE'] }),
  ])
  const swapped = await deriveWithIssues({
    workspacePath: workspace,
    revision,
    batch: {
      documentPath,
      sectionIds: ['vision', 'core_loop'],
      issueIds: ['AUD-VISION', 'AUD-CORE'],
    },
    issues: [
      admittedIssue('AUD-CORE', 'core_loop'),
      admittedIssue('AUD-VISION', 'vision'),
    ],
    receipt: receiptFor({
      issueIds: ['AUD-VISION', 'AUD-CORE'],
      changedSectionIds: ['vision', 'core_loop'],
      baseDocumentDigest: stage.baseDocumentDigest,
      stagedDocumentDigest: stageDigest(staged),
      stagedPath: stage.stagedPath,
    }),
  })
  expect(
    swapped.map(operation => ({
      sectionId: operation.sectionId,
      issueIds: operation.issueIds,
    })),
  ).toEqual(
    operations.map(operation => ({
      sectionId: operation.sectionId,
      issueIds: operation.issueIds,
    })),
  )
})

test('keeps issues targeting one section together and rejects changed sections without authority', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const staged = (
    await readFile(join(workspace, stage.stagedPath), 'utf8')
  ).replace('original vision', 'revised vision')
  await writeFile(join(workspace, stage.stagedPath), staged)
  const receipt = receiptFor({
    issueIds: ['AUD-2', 'AUD-1'],
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(staged),
    stagedPath: stage.stagedPath,
  })
  await expect(
    deriveWithIssues({
      workspacePath: workspace,
      revision,
      batch: {
        documentPath,
        sectionIds: ['vision'],
        issueIds: ['AUD-2', 'AUD-1'],
      },
      issues: [
        admittedIssue('AUD-2', 'vision'),
        admittedIssue('AUD-1', 'vision'),
      ],
      receipt,
    }),
  ).resolves.toEqual([
    expect.objectContaining({
      sectionId: 'vision',
      issueIds: ['AUD-1', 'AUD-2'],
    }),
  ])

  const unrelatedReceipt = receiptFor({
    issueIds: ['AUD-OTHER'],
    changedSectionIds: ['vision'],
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(staged),
    stagedPath: stage.stagedPath,
  })
  await expect(
    deriveWithIssues({
      workspacePath: workspace,
      revision,
      batch: { documentPath, sectionIds: ['vision'], issueIds: ['AUD-OTHER'] },
      issues: [admittedIssue('AUD-OTHER', 'core_loop')],
      receipt: unrelatedReceipt,
    }),
  ).rejects.toThrow(/target|changed|issue/i)
})

test('rejects an authorized issue target that was not changed and any changed section with no issue', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  const stage = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath,
  })
  const staged = (
    await readFile(join(workspace, stage.stagedPath), 'utf8')
  ).replace('original vision', 'revised vision')
  await writeFile(join(workspace, stage.stagedPath), staged)
  const receipt = receiptFor({
    issueIds: ['AUD-CORE'],
    changedSectionIds: ['vision'],
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigest(staged),
    stagedPath: stage.stagedPath,
  })
  await expect(
    deriveWithIssues({
      workspacePath: workspace,
      revision,
      batch: {
        documentPath,
        sectionIds: ['vision', 'core_loop'],
        issueIds: ['AUD-CORE'],
      },
      issues: [admittedIssue('AUD-CORE', 'core_loop')],
      receipt,
    }),
  ).rejects.toThrow(/target|changed|issue/i)
})

function stageDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
