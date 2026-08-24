import { z } from 'zod/v4'

const resultSchema = z.object({
  key: z.string().min(1),
  status: z.enum(['present', 'absent', 'uncertain']),
  value: z.unknown().optional(),
  evidence: z.unknown().optional(),
  reason: z.string().min(1).optional(),
}).strict()

const inputSchema = z.object({
  results: z.array(resultSchema),
  terminalDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

type BuildTool = (definition: Record<string, unknown>) => unknown

/** The only native terminal capability exposed to a foundation fact worker. */
export function createNativeFoundationFactResultTool(options: {
  buildTool: BuildTool
  onSubmit?: (input: z.infer<typeof inputSchema>) => void
}): unknown {
  return options.buildTool({
    name: 'SubmitFoundationFactExtraction',
    alwaysLoad: true,
    inputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => true,
    async description() {
      return 'Submit the bounded extraction result for the assigned foundation fact packet.'
    },
    async prompt() {
      return 'Call exactly once with one present, absent, or uncertain result for every assigned key. Do not include issue output or project paths.'
    },
    async checkPermissions(input: z.infer<typeof inputSchema>) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: z.infer<typeof inputSchema>) {
      options.onSubmit?.(input)
      return { data: { accepted: true, resultCount: input.results.length } }
    },
    renderToolUseMessage() {
      return '提交基础事实提取结果'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
    },
  })
}

