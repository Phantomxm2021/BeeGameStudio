import { readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { z } from 'zod/v4'

type BuildTool = (definition: Record<string, unknown>) => unknown

const emptyInputSchema = z.object({}).strict()

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
  ) throw new Error('foundation revision path escaped the project workspace')
  return candidate
}

/** Read-only bridge used only when Stage 3 could not establish section authority. */
export function createNativeFoundationRevisionReadTool(options: {
  buildTool: BuildTool
  workspacePath: string
  expectedStagedPath: string
}): unknown {
  let read = false
  return options.buildTool({
    name: 'ReadAssignedFoundationRevision',
    alwaysLoad: true,
    inputSchema: emptyInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => true,
    async description() {
      return 'Read the complete staged Markdown assigned to this document-scoped revision. This tool takes no path and may be called once.'
    },
    async prompt() {
      return 'Call ReadAssignedFoundationRevision once with an empty object, then return the revised complete document as visible raw Markdown.'
    },
    async checkPermissions(input: unknown) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: unknown) {
      emptyInputSchema.parse(input)
      if (read)
        throw new Error('foundation revision staged document was already read in this dispatch')
      read = true
      const markdown = await readFile(
        resolveProjectPath(options.workspacePath, options.expectedStagedPath),
        'utf8',
      )
      if (!markdown.trim())
        throw new Error('foundation revision staged document is empty')
      return { data: { markdown } }
    },
    renderToolUseMessage() {
      return '读取待修订文档'
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
