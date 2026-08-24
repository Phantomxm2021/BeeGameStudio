import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { z } from 'zod/v4'
import {
  foundationRevisionStagePath,
  revisionTaskReceiptTerminalDigest,
  type RevisionTaskReceipt,
} from './delivery-workflow/foundation-revision-stage'
import type { FoundationDocumentPath } from './delivery-workflow/types'

const declarationSchema = z
  .object({
    changedSectionIds: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((value, context) => {
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
  expectedBaseDocumentDigest?: string
  expectedStagedPath?: string
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
      return 'After completing the assigned document revision, call SubmitFoundationRevisionResult exactly once with only changedSectionIds. The service injects task identity and derives all evidence from project-local files.'
    },
    async checkPermissions(input: Declaration) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: Declaration) {
      const parsed = declarationSchema.parse(input)
      if (!sameArray(parsed.changedSectionIds, options.expectedSectionIds))
        throw new Error(
          'foundation revision receipt changedSectionIds mismatch',
        )

      const stagedPath = foundationRevisionStagePath(options.expectedRevision, options.expectedDocumentPath)
      if (options.expectedStagedPath && options.expectedStagedPath !== stagedPath)
        throw new Error('foundation revision staged path authority mismatch')
      const canonicalAbsolute = resolveProjectPath(
        options.workspacePath,
        options.expectedDocumentPath,
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
      if (options.expectedBaseDocumentDigest && sha256(baseBytes) !== options.expectedBaseDocumentDigest)
        throw new Error('foundation revision canonical document has a stale base digest')
      if (stagedBytes.length === 0)
        throw new Error('foundation revision staged document is empty')

      const receiptWithoutTerminal = {
        taskId: options.expectedTaskId,
        round: options.expectedRound,
        documentPath: options.expectedDocumentPath,
        issueIds: [...options.expectedIssueIds],
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
          receipt,
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
