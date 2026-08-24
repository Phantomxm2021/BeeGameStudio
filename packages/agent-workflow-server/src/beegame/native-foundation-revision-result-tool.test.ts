import { describe, expect, test } from 'bun:test'
import { createNativeFoundationRevisionResultTool } from './native-foundation-revision-result-tool'
import { revisionTaskReceiptTerminalDigest } from './delivery-workflow/foundation-revision-stage'

type Tool = {
  call(input: unknown): Promise<{ data: Record<string, unknown> }>
  prompt(): Promise<string>
  inputSchema: { safeParse(input: unknown): { success: boolean } }
}

const receiptWithoutTerminal = {
  taskId: 'revision-task-1',
  round: 1,
  documentPath: 'docs/GDD.md',
  issueIds: ['AUD-1'],
  baseDocumentDigest: 'a'.repeat(64),
  stagedDocumentDigest: 'b'.repeat(64),
  changedSectionIds: ['vision'],
  stagedPath: '.beegame/audit/foundation/r1/revision/docs/GDD.md',
} as const
const receipt = {
  ...receiptWithoutTerminal,
  terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal),
}

function createTool() {
  return createNativeFoundationRevisionResultTool({
    buildTool: definition => definition,
    expectedTaskId: receipt.taskId,
    expectedRevision: 'r1',
    expectedDocumentPath: receipt.documentPath as 'docs/GDD.md',
    expectedIssueIds: receipt.issueIds,
    expectedSectionIds: receipt.changedSectionIds,
  }) as Tool
}

test('accepts only a strict bounded receipt and returns no document content', async () => {
  const tool = createTool()
  expect(tool.inputSchema.safeParse(receipt).success).toBe(true)
  await expect(tool.call(receipt)).resolves.toEqual({
    data: {
      accepted: true,
      taskId: 'revision-task-1',
      changedSectionCount: 1,
      issueCount: 1,
    },
  })
  await expect(tool.prompt()).resolves.toEqual(
    expect.stringContaining('receipt'),
  )
  await expect(
    tool.call({ ...receipt, content: '# forbidden' }),
  ).rejects.toThrow()
})

test('binds receipt identity and rejects duplicate IDs or mismatched staged path', async () => {
  const tool = createTool()
  await expect(tool.call({ ...receipt, taskId: 'other' })).rejects.toThrow(
    /task/i,
  )
  await expect(
    tool.call({ ...receipt, issueIds: ['AUD-1', 'AUD-1'] }),
  ).rejects.toThrow(/issue/i)
  await expect(
    tool.call({ ...receipt, stagedPath: '../user.md' }),
  ).rejects.toThrow(/path/i)
  await expect(
    tool.call({ ...receipt, changedSectionIds: ['rules_systems'] }),
  ).rejects.toThrow(/section/i)
})
