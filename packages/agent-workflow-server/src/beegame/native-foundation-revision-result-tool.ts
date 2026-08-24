import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { z } from 'zod/v4'
import {
  foundationRevisionStagePath,
  revisionTaskReceiptTerminalDigest,
  type RevisionTaskReceipt,
} from './delivery-workflow/foundation-revision-stage'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'

const declarationSchema = z
  .object({
    taskId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    round: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    issueIds: z.array(z.string().min(1)).min(1),
    changedSectionIds: z.array(z.string().min(1)).min(1),
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
type Declaration = z.infer<typeof declarationSchema>

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function resolveProjectPath(workspacePath: string, projectPath: string): string {
  const root = resolve(workspacePath)
  const candidate = resolve(root, projectPath)
  const escaped = relative(root, candidate)
  if (
    !escaped ||
    escaped === '..' ||
    escaped.startsWith(`..${sep}`) ||
    escaped.startsWith('/') ||
    escaped.startsWith('\\')
  )
    throw new Error('foundation revision path escaped the project workspace')
  return candidate
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

export function createNativeFoundationRevisionResultTool(options: {
  buildTool: BuildTool
  workspacePath: string
  expectedTaskId: string
  expectedRevision: string
  expectedRound: 1 | 2 | 3
  expectedDocumentPath: FoundationDocumentPath
  expectedIssueIds: readonly string[]
  expectedSectionIds: readonly string[]
  onReceipt?: (receipt: RevisionTaskReceipt) => Promise<void> | void
}): unknown {
  return options.buildTool({
    name: 'SubmitFoundationRevisionResult',
    alwaysLoad: true,
    inputSchema: declarationSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => true,
    async description() {
      return 'Submit the bounded declaration for an isolated foundation document revision; the service derives the receipt from project-local bytes.'
    },
    async prompt() {
      return 'After completing the assigned document revision, call SubmitFoundationRevisionResult exactly once with only taskId, round, documentPath, exact issueIds, and exact changedSectionIds. The service derives all evidence from project-local files; no additional fields are accepted.'
    },
    async checkPermissions(input: Declaration) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: Declaration) {
      const parsed = declarationSchema.parse(input)
      if (parsed.taskId !== options.expectedTaskId)
        throw new Error('foundation revision receipt taskId mismatch')
      if (parsed.round !== options.expectedRound)
        throw new Error('foundation revision receipt round mismatch')
      if (parsed.documentPath !== options.expectedDocumentPath)
        throw new Error('foundation revision receipt document path mismatch')
      if (!sameArray(parsed.issueIds, options.expectedIssueIds))
        throw new Error('foundation revision receipt issueIds mismatch')
      if (!sameArray(parsed.changedSectionIds, options.expectedSectionIds))
        throw new Error(
          'foundation revision receipt changedSectionIds mismatch',
        )

      const stagedPath = foundationRevisionStagePath(
        options.expectedRevision,
        parsed.documentPath,
      )
      const canonicalAbsolute = resolveProjectPath(
        options.workspacePath,
        parsed.documentPath,
      )
      const stagedAbsolute = resolveProjectPath(
        options.workspacePath,
        stagedPath,
      )
      let bytes: [Uint8Array, Uint8Array]
      try {
        bytes = await Promise.all([
          readFile(canonicalAbsolute),
          readFile(stagedAbsolute),
        ])
      } catch {
        throw new Error(
          'foundation revision canonical or staged document could not be read',
        )
      }
      const [baseBytes, stagedBytes] = bytes
      if (stagedBytes.length === 0)
        throw new Error('foundation revision staged document is empty')

      const receiptWithoutTerminal = {
        taskId: parsed.taskId,
        round: parsed.round,
        documentPath: parsed.documentPath,
        issueIds: [...parsed.issueIds],
        baseDocumentDigest: sha256(baseBytes),
        stagedDocumentDigest: sha256(stagedBytes),
        changedSectionIds: [...parsed.changedSectionIds],
        stagedPath,
      } satisfies Omit<RevisionTaskReceipt, 'terminalDigest'>
      const receipt: RevisionTaskReceipt = {
        ...receiptWithoutTerminal,
        terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal),
      }

      await options.onReceipt?.(receipt)
      return {
        data: {
          accepted: true,
          changedSectionCount: receipt.changedSectionIds.length,
          issueCount: receipt.issueIds.length,
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

export { declarationSchema as foundationRevisionDeclarationSchema }
