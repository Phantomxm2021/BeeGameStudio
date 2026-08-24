import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { getGameDocumentContract } from './game-document-contracts'
import {
  createFoundationRevisionStage,
  deriveFoundationPatchOperations,
  foundationPatchOperationsDigest,
  publishFoundationRevision,
  recoverFoundationRevision,
  revisionTaskReceiptTerminalDigest,
  type FoundationRevisionStage,
  type RevisionTaskReceipt,
} from './foundation-revision-stage'
import type { AuditIssue } from './foundation-issue-registry'
import type { FoundationDocumentPath } from './types'

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

function canonicalDocument(
  path: FoundationDocumentPath = documentPath,
): string {
  const contract = getGameDocumentContract(path)
  return `# ${path.split('/').pop()?.replace('.md', '')}\n\n${contract.sections.map(section => `<!-- beegame-section:${section.sectionId} -->\n## ${section.title}\n\n${section.sectionId === 'progression' ? '' : `original ${section.sectionId}`}\n`).join('\n')}`
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

function admittedIssue(
  id: string,
  fixSectionId: string,
  fixDocument: FoundationDocumentPath = documentPath,
): AuditIssue {
  return {
    id,
    severity: 'HIGH',
    type: 'rule',
    source: {
      documentPath: fixDocument,
      sectionId: fixSectionId,
      heading: fixSectionId,
      startLine: 1,
      endLine: 1,
      digest: 'a'.repeat(64),
    },
    expected: 'expected',
    actual: 'actual',
    fixDocument,
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

test('publishes two prepared documents and commits only after every canonical digest is staged', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  await mkdirFor(join(workspace, 'docs'))
  await writeFile(
    join(workspace, 'docs/LEVEL_SCENE_DESIGN.md'),
    canonicalDocument('docs/LEVEL_SCENE_DESIGN.md'),
  )
  const first = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath: 'docs/GDD.md',
  })
  const second = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath: 'docs/LEVEL_SCENE_DESIGN.md',
  })
  const prepared = await Promise.all([
    prepareDocument(workspace, first, 'docs/GDD.md', 'issue-gdd'),
    prepareDocument(
      workspace,
      second,
      'docs/LEVEL_SCENE_DESIGN.md',
      'issue-level',
    ),
  ])
  const receipts = prepared.map(value => value.receipt)
  const operations = prepared.flatMap(value => value.operations)
  const result = await publishFoundationRevision({
    workspacePath: workspace,
    revision,
    round: 1,
    receipts,
    patchOperations: operations,
  })
  expect(
    await readFile(
      join(
        workspace,
        '.beegame/audit/foundation',
        revision,
        'revision/PREPARED.json',
      ),
      'utf8',
    ),
  ).toContain('issue-gdd')
  expect(
    await readFile(
      join(
        workspace,
        '.beegame/audit/foundation',
        revision,
        'revision/COMMITTED.json',
      ),
      'utf8',
    ),
  ).toContain('committed')
  expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toContain(
    'published ',
  )
  expect(
    await readFile(join(workspace, 'docs/LEVEL_SCENE_DESIGN.md'), 'utf8'),
  ).toContain('published ')
  expect(result.status).toBe('committed')
})

test('recovers after the first canonical document is rolled forward and never reruns its writer', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  await mkdirFor(join(workspace, 'docs'))
  await writeFile(
    join(workspace, 'docs/LEVEL_SCENE_DESIGN.md'),
    canonicalDocument('docs/LEVEL_SCENE_DESIGN.md'),
  )
  const first = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath: 'docs/GDD.md',
  })
  const second = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath: 'docs/LEVEL_SCENE_DESIGN.md',
  })
  const prepared = await Promise.all([
    prepareDocument(workspace, first, 'docs/GDD.md', 'issue-gdd'),
    prepareDocument(
      workspace,
      second,
      'docs/LEVEL_SCENE_DESIGN.md',
      'issue-level',
    ),
  ])
  const receipts = prepared.map(value => value.receipt)
  const operations = prepared.flatMap(value => value.operations)
  await expect(
    publishFoundationRevision({
      workspacePath: workspace,
      revision,
      round: 1,
      receipts,
      patchOperations: operations,
      onDocumentPublished: async path => {
        if (path === 'docs/GDD.md') throw new Error('simulated crash')
      },
    }),
  ).rejects.toThrow('simulated crash')
  const firstBytes = await readFile(join(workspace, 'docs/GDD.md'), 'utf8')
  expect(firstBytes).toContain('published ')
  await expect(
    readFile(
      join(
        workspace,
        '.beegame/audit/foundation',
        revision,
        'revision/COMMITTED.json',
      ),
      'utf8',
    ),
  ).rejects.toThrow()
  const recovered = await recoverFoundationRevision({
    workspacePath: workspace,
    revision,
  })
  expect(recovered.status).toBe('committed')
  expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(
    firstBytes,
  )
  expect(
    await readFile(join(workspace, 'docs/LEVEL_SCENE_DESIGN.md'), 'utf8'),
  ).toContain('published ')
})

test('accepts an already staged canonical document on replay and rejects stale, corrupt, incomplete, duplicate, and escaped authority', async () => {
  const workspace = await workspaceWithCanonicalDocument()
  await mkdirFor(join(workspace, 'docs'))
  await writeFile(
    join(workspace, 'docs/LEVEL_SCENE_DESIGN.md'),
    canonicalDocument('docs/LEVEL_SCENE_DESIGN.md'),
  )
  const first = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath: 'docs/GDD.md',
  })
  const second = await createFoundationRevisionStage({
    workspacePath: workspace,
    revision,
    documentPath: 'docs/LEVEL_SCENE_DESIGN.md',
  })
  const prepared = await Promise.all([
    prepareDocument(workspace, first, 'docs/GDD.md', 'issue-gdd'),
    prepareDocument(
      workspace,
      second,
      'docs/LEVEL_SCENE_DESIGN.md',
      'issue-level',
    ),
  ])
  const receipts = prepared.map(value => value.receipt)
  const operations = prepared.flatMap(value => value.operations)
  await expect(
    publishFoundationRevision({
      workspacePath: workspace,
      revision,
      round: 1,
      receipts,
      patchOperations: operations,
      onDocumentPublished: async path => {
        if (path === 'docs/GDD.md') throw new Error('replay crash')
      },
    }),
  ).rejects.toThrow('replay crash')
  await expect(
    publishFoundationRevision({
      workspacePath: workspace,
      revision,
      round: 1,
      receipts,
      patchOperations: operations,
    }),
  ).resolves.toMatchObject({ status: 'committed' })

  const staleWorkspace = await workspaceWithCanonicalDocument()
  const stale = await createFoundationRevisionStage({
    workspacePath: staleWorkspace,
    revision,
    documentPath,
  })
  const stalePrepared = await prepareDocument(
    staleWorkspace,
    stale,
    documentPath,
    'issue-gdd',
  )
  await writeFile(join(staleWorkspace, documentPath), 'stale canonical')
  await expect(
    publishFoundationRevision({
      workspacePath: staleWorkspace,
      revision,
      round: 1,
      receipts: [stalePrepared.receipt],
      patchOperations: stalePrepared.operations,
    }),
  ).rejects.toThrow(/stale|base|digest/i)

  const corruptWorkspace = await workspaceWithCanonicalDocument()
  const corrupt = await createFoundationRevisionStage({
    workspacePath: corruptWorkspace,
    revision,
    documentPath,
  })
  const corruptPrepared = await prepareDocument(
    corruptWorkspace,
    corrupt,
    documentPath,
    'issue-gdd',
  )
  await writeFile(
    join(corruptWorkspace, corrupt.stagedPath),
    'corrupt staged bytes',
  )
  await expect(
    publishFoundationRevision({
      workspacePath: corruptWorkspace,
      revision,
      round: 1,
      receipts: [corruptPrepared.receipt],
      patchOperations: corruptPrepared.operations,
    }),
  ).rejects.toThrow(/staged|digest/i)

  const missingWorkspace = await workspaceWithCanonicalDocument()
  const missing = await createFoundationRevisionStage({
    workspacePath: missingWorkspace,
    revision,
    documentPath,
  })
  const missingPrepared = await prepareDocument(
    missingWorkspace,
    missing,
    documentPath,
    'issue-gdd',
  )
  await expect(
    publishFoundationRevision({
      workspacePath: missingWorkspace,
      revision,
      round: 1,
      receipts: [missingPrepared.receipt],
      patchOperations: [],
    }),
  ).rejects.toThrow(/coverage|operation|path/i)
  await expect(
    publishFoundationRevision({
      workspacePath: missingWorkspace,
      revision,
      round: 1,
      receipts: [missingPrepared.receipt, missingPrepared.receipt],
      patchOperations: missingPrepared.operations,
    }),
  ).rejects.toThrow(/duplicate|coverage/i)
  const { terminalDigest: _terminalDigest, ...escapedWithoutTerminal } =
    missingPrepared.receipt
  const escapedReceipt = {
    ...escapedWithoutTerminal,
    stagedPath: '../escape.md',
    terminalDigest: revisionTaskReceiptTerminalDigest({
      ...escapedWithoutTerminal,
      stagedPath: '../escape.md',
    }),
  }
  await expect(
    publishFoundationRevision({
      workspacePath: missingWorkspace,
      revision,
      round: 1,
      receipts: [escapedReceipt],
      patchOperations: missingPrepared.operations,
    }),
  ).rejects.toThrow(/path|escape|staged/i)
})

async function prepareDocument(
  workspace: string,
  stage: FoundationRevisionStage,
  path: FoundationDocumentPath,
  issueId: string,
) {
  const stagedPath = join(workspace, stage.stagedPath)
  const sectionId = getGameDocumentContract(path).sections[0]!.sectionId
  const revised = (await readFile(stagedPath, 'utf8')).replace(
    `original ${sectionId}`,
    `published ${sectionId}`,
  )
  await writeFile(stagedPath, revised)
  const withoutTerminal = {
    taskId: `task-${issueId}`,
    round: 1 as const,
    documentPath: path,
    issueIds: [issueId],
    baseDocumentDigest: stage.baseDocumentDigest,
    stagedDocumentDigest: stageDigestForText(revised),
    changedSectionIds: [sectionId],
    stagedPath: stage.stagedPath,
  }
  const receipt = {
    ...withoutTerminal,
    terminalDigest: revisionTaskReceiptTerminalDigest(withoutTerminal),
  }
  const operations = await deriveFoundationPatchOperations({
    workspacePath: workspace,
    revision,
    batch: { documentPath: path, sectionIds: [sectionId], issueIds: [issueId] },
    issues: [admittedIssue(issueId, sectionId, path)],
    receipt,
  })
  return { receipt, operations }
}

function stageDigestForText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stageDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
