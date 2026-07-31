import { z } from 'zod/v4'

const findingSchema = z.object({
  artifactPaths: z.array(z.string().min(1)).min(1),
  description: z.string().min(1),
  requiredAction: z.string().min(1),
}).strict()

const validationResultInputSchema = z.object({
  status: z.enum(['passed', 'failed', 'blocked']),
  findings: z.array(findingSchema),
}).strict()

type BuildTool = (definition: Record<string, unknown>) => unknown

export function createNativeValidationResultTool(options: {
  buildTool: BuildTool
  workerType: 'implementation-auditor' | 'acceptance-validator'
}): unknown {
  return options.buildTool({
    name: 'SubmitValidationResult',
    alwaysLoad: true,
    inputSchema: validationResultInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => true,
    async description() {
      return 'Submit the independent validation verdict and actionable findings.'
    },
    async prompt() {
      return 'Call this tool exactly once after completing the audit. Submit only status and findings. Each finding contains only artifactPaths, description, and requiredAction. The workflow service derives task and checklist ownership from the active graph and owns revision, complete contract ID coverage, and canonical evidence persistence. passed requires no findings; failed or blocked requires at least one actionable finding.'
    },
    async checkPermissions(input: z.infer<typeof validationResultInputSchema>) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: z.infer<typeof validationResultInputSchema>) {
      return { data: { accepted: true, status: input.status, findingCount: input.findings.length } }
    },
    renderToolUseMessage() {
      return options.workerType === 'implementation-auditor'
        ? '提交实现审计结果'
        : '提交验收结果'
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
