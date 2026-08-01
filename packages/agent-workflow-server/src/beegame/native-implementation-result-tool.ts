import { z } from 'zod/v4'

const implementationResultInputSchema = z
  .object({
  status: z.enum(['completed', 'failed', 'blocked']),
  changedPaths: z.array(z.string().min(1)),
  verificationObservations: z.array(z.string().min(1)),
  })
  .strict()

type BuildTool = (definition: Record<string, unknown>) => unknown

export function createNativeImplementationResultTool(options: {
  buildTool: BuildTool
}): unknown {
  return options.buildTool({
    name: 'SubmitImplementationResult',
    alwaysLoad: true,
    inputSchema: implementationResultInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => true,
    async description() {
      return 'Submit the completed atomic implementation task result for deterministic workflow validation and evidence persistence.'
    },
    async prompt() {
      return 'Call exactly once after implementing the active task. Provide one concise verification observation for every task verification in order. Resource files and JSON/YAML content definitions are immutable inputs prepared before implementation; do not submit binding or integration records.'
    },
    async checkPermissions(
      input: z.infer<typeof implementationResultInputSchema>,
    ) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: z.infer<typeof implementationResultInputSchema>) {
      return {
        data: {
          accepted: true,
          status: input.status,
          verificationCount: input.verificationObservations.length,
        },
      }
    },
    renderToolUseMessage() {
      return '提交实现结果'
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
