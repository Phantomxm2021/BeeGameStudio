import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { z } from 'zod/v4'
import { commitFoundationRevisionDocumentMetadata } from './authored-document-receipt'
import { buildFoundationSectionIndex } from './delivery-workflow/foundation-section-index'
import {
  foundationRevisionStagePath,
  revisionTaskReceiptTerminalDigest,
  type RevisionTaskReceipt,
} from './delivery-workflow/foundation-revision-stage'
import { foundationRevisionDeclarationSchema } from './delivery-workflow/worker-contracts'
import type { FoundationDocumentPath, FoundationRevisionRound } from './delivery-workflow/types'

const declarationSchema = foundationRevisionDeclarationSchema

type BuildTool = (definition: Record<string, unknown>) => unknown
type Declaration = z.infer<typeof declarationSchema>

function sha256(value: string | Uint8Array): string {
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

export function createNativeFoundationRevisionResultTool(options: {
  buildTool: BuildTool
  workspacePath: string
  expectedTaskId: string
  expectedRevision: string
  expectedRound: FoundationRevisionRound
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
    isReadOnly: () => false,
    async description() {
      return 'Submit the bounded declaration for an isolated foundation document revision; the service derives the receipt from project-local bytes.'
    },
    async prompt() {
      return 'After completing the assigned document revision, call SubmitFoundationRevisionResult exactly once with status APPLIED. The service injects task identity and derives all evidence from project-local files.'
    },
    async checkPermissions(input: Declaration) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: Declaration) {
      declarationSchema.parse(input)

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
      let documents: [string, string]
      try {
        documents = await Promise.all([
          readFile(canonicalAbsolute, 'utf8'),
          readFile(stagedAbsolute, 'utf8'),
        ])
      } catch {
        throw new Error(
          'foundation revision canonical or staged document could not be read',
        )
      }
      const [baseMarkdown, stagedMarkdown] = documents
      if (options.expectedBaseDocumentDigest && sha256(baseMarkdown) !== options.expectedBaseDocumentDigest)
        throw new Error('foundation revision canonical document has a stale base digest')
      if (stagedMarkdown.length === 0)
        throw new Error('foundation revision staged document is empty')

      await commitFoundationRevisionDocumentMetadata({
        workspacePath: options.workspacePath,
        canonicalPath: options.expectedDocumentPath,
        stagedPath,
        expectedCanonicalDigest: sha256(baseMarkdown),
      })
      const finalStagedMarkdown = await readFile(stagedAbsolute, 'utf8')
      if (finalStagedMarkdown.length === 0)
        throw new Error('foundation revision staged document is empty')
      const changedSectionIds = deriveChangedSectionIds({
        documentPath: options.expectedDocumentPath,
        baseMarkdown,
        stagedMarkdown: finalStagedMarkdown,
        expectedSectionIds: options.expectedSectionIds,
      })

      const receiptWithoutTerminal = {
        taskId: options.expectedTaskId,
        round: options.expectedRound,
        documentPath: options.expectedDocumentPath,
        issueIds: [...options.expectedIssueIds],
        baseDocumentDigest: sha256(baseMarkdown),
        stagedDocumentDigest: sha256(finalStagedMarkdown),
        changedSectionIds,
        stagedPath,
      } satisfies Omit<RevisionTaskReceipt, 'terminalDigest'>
      const receipt: RevisionTaskReceipt = {
        ...receiptWithoutTerminal,
        terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal),
      }

      await options.onReceipt?.(receipt)
      return {
        data: {
          status: 'APPLIED',
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

function deriveChangedSectionIds(input: {
  documentPath: FoundationDocumentPath
  baseMarkdown: string
  stagedMarkdown: string
  expectedSectionIds: readonly string[]
}): string[] {
  const baseIndex = buildFoundationSectionIndex({
    documents: new Map([[input.documentPath, input.baseMarkdown]]),
  })
  const stagedIndex = buildFoundationSectionIndex({
    documents: new Map([[input.documentPath, input.stagedMarkdown]]),
  })
  if (
    baseIndex.length !== stagedIndex.length ||
    baseIndex.some(
      (section, index) =>
        section.documentPath !== stagedIndex[index]?.documentPath ||
        section.sectionId !== stagedIndex[index]?.sectionId,
    )
  )
    throw new Error('foundation revision section markers or order changed')
  const changed = baseIndex.flatMap((section, index) =>
    section.digest === stagedIndex[index]!.digest ? [] : [section.sectionId],
  )
  if (changed.length === 0)
    throw new Error('foundation revision staged document has no changed sections')
  const expected = new Set(input.expectedSectionIds)
  if (changed.some(sectionId => !expected.has(sectionId)))
    throw new Error('foundation revision changed section is outside packet authority')
  return changed
}

export { declarationSchema as foundationRevisionDeclarationSchema }
