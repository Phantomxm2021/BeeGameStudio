import { z } from 'zod/v4'

const evidenceSchema = z.object({
  documentPath: z.string().min(1),
  sectionId: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const foundationFactResultToolInputSchema = z.object({
  taskId: z.string().min(1),
  runId: z.string().min(1),
  dispatchId: z.string().min(1),
  revision: z.string().min(1),
  packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
  results: z.array(z.object({
    key: z.string().min(1),
    status: z.enum(['present', 'absent', 'uncertain']),
    value: z.unknown().optional(),
    evidence: evidenceSchema.optional(),
    reason: z.string().min(1).optional(),
  }).strict()),
}).strict()

export function createNativeFoundationFactResultTool(options: {
  buildTool: (definition: Record<string, unknown>) => unknown
  runId: string
  dispatchId: string
  taskId: string
  revision: string
  packetDigest: string
  onSubmit?: (input: z.infer<typeof foundationFactResultToolInputSchema>) => unknown | Promise<unknown>
}): unknown {
  return options.buildTool({
    name: 'SubmitFoundationFactResult',
    alwaysLoad: true,
    inputSchema: foundationFactResultToolInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => true,
    async description() {
      return 'The only scoped foundation fact extraction terminal. Submit every assigned key exactly once with typed facts and exact packet evidence.'
    },
    async prompt() {
      return 'Submit exactly once. The service validates run, dispatch, task, revision, packet digest and every declared key; do not use project Read, Grep, Glob, Write or emit issue output.'
    },
    async checkPermissions(input: unknown) {
      const parsed = foundationFactResultToolInputSchema.parse(input)
      if (parsed.runId !== options.runId || parsed.dispatchId !== options.dispatchId || parsed.taskId !== options.taskId || parsed.revision !== options.revision || parsed.packetDigest !== options.packetDigest)
        return { behavior: 'deny', message: 'foundation fact terminal identity does not match its scoped dispatch' }
      return { behavior: 'allow', updatedInput: parsed }
    },
    async call(input: unknown) {
      const parsed = foundationFactResultToolInputSchema.parse(input)
      if (parsed.runId !== options.runId || parsed.dispatchId !== options.dispatchId || parsed.taskId !== options.taskId || parsed.revision !== options.revision || parsed.packetDigest !== options.packetDigest)
        throw new Error('foundation fact terminal identity does not match its scoped dispatch')
      return options.onSubmit ? options.onSubmit(parsed) : { accepted: true }
    },
    renderToolUseMessage() { return '提交基础事实提取结果' },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
    },
  })
}
