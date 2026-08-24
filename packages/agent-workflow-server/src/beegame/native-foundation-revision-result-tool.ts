import { z } from 'zod/v4'
import {
  foundationRevisionStagePath,
  revisionTaskReceiptTerminalDigest,
  type RevisionTaskReceipt,
} from './delivery-workflow/foundation-revision-stage'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const receiptSchema = z
  .object({
    taskId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    round: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    issueIds: z.array(z.string().min(1)).min(1),
    baseDocumentDigest: digest,
    stagedDocumentDigest: digest,
    changedSectionIds: z.array(z.string().min(1)).min(1),
    stagedPath: z.string().min(1),
    terminalDigest: digest,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.issueIds).size !== value.issueIds.length)
      context.addIssue({
        code: 'custom',
        path: ['issueIds'],
        message: 'issueIds must be unique',
      })
    if (
      new Set(value.changedSectionIds).size !== value.changedSectionIds.length
    )
      context.addIssue({
        code: 'custom',
        path: ['changedSectionIds'],
        message: 'changedSectionIds must be unique',
      })
  })

type BuildTool = (definition: Record<string, unknown>) => unknown
type Receipt = z.infer<typeof receiptSchema>

export function createNativeFoundationRevisionResultTool(options: {
  buildTool: BuildTool
  workspacePath?: string
  expectedTaskId?: string
  expectedRevision?: string
  expectedDocumentPath?: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]
  expectedIssueIds?: readonly string[]
  expectedSectionIds?: readonly string[]
  onReceipt?: (receipt: RevisionTaskReceipt) => Promise<void> | void
}): unknown {
  return options.buildTool({
    name: 'SubmitFoundationRevisionResult',
    alwaysLoad: true,
    inputSchema: receiptSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => true,
    async description() {
      return 'Submit the bounded receipt for an isolated foundation document revision.'
    },
    async prompt() {
      return 'Edit only the assigned staged Markdown file, then call SubmitFoundationRevisionResult exactly once with the strict bounded receipt. Submit no Markdown body, content field, JSON patch, or explanation. The service derives operations from canonical and staged bytes.'
    },
    async checkPermissions(input: Receipt) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: Receipt) {
      const parsed = receiptSchema.parse(input)
      if (
        !/^\.beegame\/audit\/foundation\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\/revision\/docs\/[A-Z_]+\.md$/.test(
          parsed.stagedPath,
        )
      )
        throw new Error(
          'foundation revision receipt staged path is not project-local',
        )
      if (
        options.expectedTaskId !== undefined &&
        parsed.taskId !== options.expectedTaskId
      )
        throw new Error('foundation revision receipt taskId mismatch')
      if (
        options.expectedRevision !== undefined &&
        parsed.stagedPath !==
          foundationRevisionStagePath(
            options.expectedRevision,
            parsed.documentPath,
          )
      )
        throw new Error('foundation revision receipt staged path mismatch')
      if (
        options.expectedDocumentPath !== undefined &&
        parsed.documentPath !== options.expectedDocumentPath
      )
        throw new Error('foundation revision receipt document path mismatch')
      if (
        options.expectedIssueIds &&
        !sameArray(parsed.issueIds, options.expectedIssueIds)
      )
        throw new Error('foundation revision receipt issueIds mismatch')
      if (
        options.expectedSectionIds &&
        !sameArray(parsed.changedSectionIds, options.expectedSectionIds)
      )
        throw new Error(
          'foundation revision receipt changedSectionIds mismatch',
        )
      const { terminalDigest: _terminalDigest, ...withoutTerminal } = parsed
      if (
        revisionTaskReceiptTerminalDigest(
          withoutTerminal as Omit<RevisionTaskReceipt, 'terminalDigest'>,
        ) !== parsed.terminalDigest
      )
        throw new Error('foundation revision receipt terminal digest mismatch')
      if (options.workspacePath) {
        if (
          parsed.stagedPath.startsWith('/') ||
          parsed.stagedPath.includes('..') ||
          !parsed.stagedPath.startsWith('.beegame/audit/foundation/')
        )
          throw new Error(
            'foundation revision receipt staged path escaped project staging',
          )
        // The native tool never writes the path; the service-owned staging writer
        // is the only code allowed to resolve it against the project workspace.
      }
      await options.onReceipt?.(parsed as RevisionTaskReceipt)
      return {
        data: {
          accepted: true,
          taskId: parsed.taskId,
          changedSectionCount: parsed.changedSectionIds.length,
          issueCount: parsed.issueIds.length,
        },
      }
    },
    renderToolUseMessage() {
      return '提交文档修订结果'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(output),
      }
    },
  })
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

export { receiptSchema as foundationRevisionReceiptSchema }
